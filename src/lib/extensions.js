import { useCallback, useEffect, useRef, useState } from 'react';
import { registerExtensionThemes, validateTheme } from './themes.js';
import { KEYBINDINGS, reservedBinding, validBinding } from './keybindings.js';
import { getExtensionSetting, setExtensionSettings, resetExtensionSettings } from './extensionSettings.js';
import { getRuntimeLimits, validateLimits } from '../../electron/customization.mjs';
import {
  APPLICATION_EVENTS, EDITOR_COMMANDS, applicationEvents, requireEventName,
  requirePayload, requireSelection, pathHelper, markdownToText
} from './extensionCapabilities.js';

// A worker runs extension code inside an opaque-origin supervisor iframe:
// it cannot reach window.api, the DOM, app storage or the network (CSP connect-src 'none').
// Everything it can do goes through the permission-checked message bridge below. The bootstrap that
// defines the `tagline` global lives in public/extension-sandbox.html.
const SANDBOX_URL = 'extension-sandbox.html';

const MAX_TEXT = 5_000_000;

export const extensionCommandId = (extensionId, commandId) => `ext:${extensionId}.${commandId}`;

function requireText(value, label, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be text up to ${max} characters.`);
  return value;
}

export class ExtensionHost {
  constructor(manifest, source, bridge, limits = getRuntimeLimits()) {
    this.manifest = manifest;
    this.source = source;
    this.bridge = bridge;
    this.limits = Object.freeze(validateLimits(limits));
    this.registered = new Set();
    this.watches = new Map();
    this.activeNoteWatches = new Map();
    this.eventWatches = new Map();
    this.surfaces = new Map();
    this.surfaceTransports = new Map();
    this.nextWatch = 0;
    this.pendingCalls = 0;
    this.messageWindow = 0;
    this.messageCount = 0;
    this.onMessage = this.onMessage.bind(this);
  }

  start(timeout = this.limits.extensionStartupMs) {
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.dataset.extension = this.manifest.id;
    this.frame.style.display = 'none';
    this.frame.src = new URL(SANDBOX_URL, document.baseURI).href;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.dispose(); reject(new Error(`Extension did not start within ${timeout / 1000} seconds.`)); }, timeout);
      this.settle = (error) => {
        clearTimeout(timer);
        this.settle = null;
        if (error) { this.dispose(); reject(error); } else resolve();
      };
      window.addEventListener('message', this.onMessage);
      this.frame.addEventListener('load', () => this.frame?.contentWindow.postMessage({ type: 'start', source: this.source, limits: this.limits }, '*'), { once: true });
      document.body.append(this.frame);
    });
  }

  require(permission) {
    if (!this.manifest.permissions.includes(permission)) {
      throw new Error(`Permission "${permission}" is not declared in the manifest.`);
    }
  }

  async handle(method, args) {
    const b = this.bridge;
    switch (method) {
      case 'commands.register': {
        const [id] = args;
        if (!this.manifest.contributes.commands.some((c) => c.id === id)) {
          throw new Error(`Command "${id}" is not declared in contributes.commands.`);
        }
        this.registered.add(id);
        return true;
      }
      case 'notify':
        b.notify(`${this.manifest.name}: ${requireText(args[0], 'Message', 500)}`);
        return true;
      case 'editor.getActiveNote': this.require('editor'); return b.getActiveNote();
      case 'editor.insertText': this.require('editor'); await b.insertText(requireText(args[0], 'Text')); return true;
      case 'editor.setSelection':
        this.require('editor');
        return b.setSelection(requireSelection(args[0]));
      case 'editor.getTiptapSnapshot':
        this.require('editor');
        return b.getTiptapSnapshot();
      case 'editor.runTiptapCommand': {
        this.require('editor');
        const [command, options] = args;
        if (!EDITOR_COMMANDS.includes(command)) throw new Error('Unsupported Tiptap command.');
        if (command === 'toggleHeading') {
          if (!options || !Number.isInteger(options.level) || options.level < 1 || options.level > 6) {
            throw new Error('Heading level must be an integer from 1 to 6.');
          }
        } else if (options !== undefined) throw new Error('This command does not accept options.');
        return b.runTiptapCommand(command, command === 'toggleHeading' ? { level: options.level } : undefined);
      }
      case 'events.subscribe': {
        this.require('events');
        const name = requireEventName(args[0]);
        if (APPLICATION_EVENTS[name]) this.require(APPLICATION_EVENTS[name]);
        else if (!/^ext\.[a-z0-9][a-z0-9-]{1,63}\.[a-z][a-zA-Z0-9.-]*$/.test(name)) {
          throw new Error('Unknown application event. Custom events must use ext.extension-id.name.');
        }
        if (this.eventWatches.size >= this.limits.extensionWatches) throw new Error('Too many event listeners.');
        const id = ++this.nextWatch;
        this.eventWatches.set(id, applicationEvents.on(name, (payload) => this.sendEvent('application-event', id, payload)));
        return id;
      }
      case 'events.unsubscribe': {
        this.eventWatches.get(args[0])?.();
        return this.eventWatches.delete(args[0]);
      }
      case 'events.emit': {
        this.require('events');
        const name = requireEventName(args[0]);
        if (!name.startsWith(`ext.${this.manifest.id}.`) ||
          !/^ext\.[a-z0-9][a-z0-9-]{1,63}\.[a-z][a-zA-Z0-9.-]*$/.test(name)) {
          throw new Error('Extensions can emit only their own namespaced events.');
        }
        applicationEvents.emit(name, requirePayload(args[1]));
        return true;
      }
      case 'helpers.path': return pathHelper(args[0], args.slice(1));
      case 'helpers.markdownToText': return markdownToText(requireText(args[0], 'Markdown', 100000));
      case 'ui.setHtml':
      case 'ui.show':
      case 'ui.close':
      case 'ui.postMessage': {
        this.require('ui');
        const [kind, id, value] = args;
        if (!['panels', 'webviews'].includes(kind) ||
          !this.manifest.contributes[kind]?.some((item) => item.id === id)) throw new Error('Undeclared UI contribution.');
        const key = `${kind}:${id}`;
        if (method === 'ui.setHtml') {
          const html = requireText(value, 'HTML', 200000);
          this.surfaces.set(key, html);
          b.updateSurface(this, kind, id, html, false);
        } else if (method === 'ui.show') {
          if (!this.surfaces.has(key)) throw new Error('Set contribution HTML before showing it.');
          b.updateSurface(this, kind, id, this.surfaces.get(key), true);
        } else if (method === 'ui.close') b.closeSurface(this, kind, id);
        else b.postSurfaceMessage(this, kind, id, requirePayload(value));
        return true;
      }
      case 'settings.get':
        this.require('settings');
        return getExtensionSetting(this.manifest, requireText(args[0], 'Setting id', 64));
      case 'settings.set':
        this.require('settings');
        return setExtensionSettings(this.manifest, { [requireText(args[0], 'Setting id', 64)]: args[1] });
      case 'editor.watchActiveNote': {
        this.require('editor:active-note');
        if (this.activeNoteWatches.size >= this.limits.extensionWatches) throw new Error(`Extension is limited to ${this.limits.extensionWatches} active-note listeners.`);
        const id = ++this.nextWatch;
        this.activeNoteWatches.set(id, b.watchActiveNote((event) => this.frame?.contentWindow?.postMessage({
          type: 'active-note-event', id, event: { path: event.path },
        }, '*')));
        return id;
      }
      case 'editor.unwatchActiveNote': {
        this.activeNoteWatches.get(args[0])?.();
        return this.activeNoteWatches.delete(args[0]);
      }
      case 'vault.list': this.require('vault:read'); return b.list();
      case 'vault.read': this.require('vault:read'); return b.read(requireText(args[0], 'Path', 1000));
      case 'vault.write':
        this.require('vault:write');
        return b.write(requireText(args[0], 'Path', 1000), requireText(args[1], 'Content'));
      case 'vault.append':
        this.require('vault:read');
        this.require('vault:write');
        return b.append(requireText(args[0], 'Path', 1000), requireText(args[1], 'Content'));
      case 'vault.delete':
        this.require('vault:write');
        return b.delete(requireText(args[0], 'Path', 1000));
      case 'vault.rename':
        this.require('vault:write');
        return b.rename(requireText(args[0], 'Path', 1000), requireText(args[1], 'New path', 1000));
      case 'vault.flush':
        this.require('vault:write');
        return b.flush();
      case 'vault.compareAndSwap':
        this.require('vault:read');
        this.require('vault:write');
        return b.compareAndSwap(requireText(args[0], 'Path', 1000),
          requireText(args[1], 'Expected content'), requireText(args[2], 'Content'));
      case 'vault.watch': {
        this.require('vault:read');
        if (this.watches.size >= this.limits.extensionWatches) throw new Error(`Extension is limited to ${this.limits.extensionWatches} vault watches.`);
        const id = ++this.nextWatch;
        this.watches.set(id, b.watch((event) => this.frame?.contentWindow?.postMessage({
          type: 'vault-event', id, event,
        }, '*')));
        return id;
      }
      case 'vault.unwatch': {
        this.watches.get(args[0])?.();
        return this.watches.delete(args[0]);
      }
      case 'storage.get': return this.storage()[requireText(args[0], 'Key', 200)] ?? null;
      case 'storage.set': {
        const data = { ...this.storage(), [requireText(args[0], 'Key', 200)]: args[1] };
        if (args[1] === undefined || args[1] === null) delete data[args[0]];
        const text = JSON.stringify(data);
        if (text.length > this.limits.extensionStorageCharacters) throw new Error('Extension storage exceeds the configured limit.');
        localStorage.setItem(`tagline-extension:${this.manifest.id}`, text);
        return true;
      }
      default: throw new Error(`Unknown API method: ${method}`);
    }
  }

  storage() {
    try { return JSON.parse(localStorage.getItem(`tagline-extension:${this.manifest.id}`) || '{}'); } catch { return {}; }
  }

  sendEvent(type, id, event) {
    this.frame?.contentWindow?.postMessage({ type, id, event }, '*');
  }

  async onMessage(event) {
    if (!this.frame || event.source !== this.frame.contentWindow || !event.data) return;
    const data = event.data;
    const now = performance.now();
    if (now - this.messageWindow >= 1000) { this.messageWindow = now; this.messageCount = 0; }
    if (++this.messageCount > this.limits.extensionMessagesPerSecond) {
      const error = new Error(`Extension exceeded ${this.limits.extensionMessagesPerSecond} messages per second and was stopped.`);
      if (this.settle) this.settle(error);
      else { this.dispose(); this.bridge.notify(`${this.manifest.name}: ${error.message}`); }
      return;
    }
    if (data.type === 'ready') this.settle?.();
    else if (data.type === 'failed') {
      const error = new Error(String(data.message));
      if (this.settle) this.settle(error);
      else { this.dispose(); this.bridge.notify(`${this.manifest.name}: ${error.message}`); }
    } else if (data.type === 'error') this.bridge.notify(`${this.manifest.name}: ${String(data.message).slice(0, 500)}`);
    else if (data.type === 'call') {
      if (this.pendingCalls >= this.limits.extensionPendingCalls) {
        this.frame.contentWindow.postMessage({ type: 'result', id: data.id, error: `Extension is limited to ${this.limits.extensionPendingCalls} pending API calls.` }, '*');
        return;
      }
      this.pendingCalls++;
      let reply;
      try {
        reply = { type: 'result', id: data.id, value: await this.handle(data.method, Array.isArray(data.args) ? data.args : []) };
      } catch (error) { reply = { type: 'result', id: data.id, error: error.message }; }
      finally { this.pendingCalls--; }
      this.frame?.contentWindow?.postMessage(reply, '*');
    }
  }

  run(commandId) {
    if (!this.frame) throw new Error(`${this.manifest.name} was stopped. Reload or disable it in Settings > Extensions.`);
    if (!this.registered.has(commandId)) throw new Error(`${this.manifest.name} has not registered "${commandId}".`);
    this.frame.contentWindow.postMessage({ type: 'command', command: commandId }, '*');
  }

  dispose() {
    this.watches.forEach((unsubscribe) => unsubscribe());
    this.watches.clear();
    this.activeNoteWatches.forEach((unsubscribe) => unsubscribe());
    this.activeNoteWatches.clear();
    this.eventWatches.forEach((unsubscribe) => unsubscribe());
    this.eventWatches.clear();
    this.surfaces.clear();
    this.surfaceTransports.clear();
    this.bridge.removeSurfaces?.(this);
    window.removeEventListener('message', this.onMessage);
    this.frame?.remove();
    this.frame = null;
    this.registered.clear();
  }
}

// Default keys that are malformed, reserved, or already used by a built-in or earlier extension are dropped;
// users can still assign them explicitly in Settings > Keyboard shortcuts.
export function usableDefaultKey(key, taken = []) {
  if (!key || !validBinding(key) || reservedBinding(key)) return '';
  const used = [...KEYBINDINGS, ...taken].map((item) => item.key);
  return used.includes(key) ? '' : key;
}

// Loads enabled extensions, exposes their commands/themes, and tears hosts down on reload/unmount.
export function useExtensions({ bridgeRef, notify }) {
  const [extensions, setExtensions] = useState([]);
  const [commands, setCommands] = useState([]);
  const [surfaces, setSurfaces] = useState([]);
  const hosts = useRef(new Map());
  const generation = useRef(0);
  const [settingsRevision, settingsChanged] = useState(0);
  useEffect(() => {
    const changed = () => settingsChanged((value) => value + 1);
    window.addEventListener('extension-settings-changed', changed);
    return () => window.removeEventListener('extension-settings-changed', changed);
  }, []);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    hosts.current.forEach((host) => host.dispose());
    hosts.current = new Map();
    const bridge = {
      notify: (message) => notify(message),
      getActiveNote: () => bridgeRef.current.getActiveNote(),
      insertText: (text) => bridgeRef.current.insertText(text),
      setSelection: (selection) => bridgeRef.current.setSelection(selection),
      getTiptapSnapshot: () => bridgeRef.current.getTiptapSnapshot(),
      runTiptapCommand: (command, options) => bridgeRef.current.runTiptapCommand(command, options),
      updateSurface: (host, kind, id, html, show) => {
        const declaration = host.manifest.contributes[kind].find((item) => item.id === id);
        setSurfaces((previous) => {
          const existing = previous.find((item) => item.host === host && item.kind === kind && item.id === id);
          const next = {
            host, kind, id, html, title: `${host.manifest.name}: ${declaration.title}`,
            visible: show || existing?.visible || false
          };
          return [...previous.filter((item) => !(item.host === host && item.kind === kind && item.id === id)), next];
        });
      },
      closeSurface: (host, kind, id) => setSurfaces((previous) => previous.map((item) =>
        item.host === host && item.kind === kind && item.id === id ? { ...item, visible: false } : item)),
      removeSurfaces: (host) => setSurfaces((previous) => previous.filter((item) => item.host !== host)),
      postSurfaceMessage: (host, kind, id, payload) => {
        const send = host.surfaceTransports.get(`${kind}:${id}`);
        if (!send) throw new Error('Contribution is not mounted. Wait for its ready message before sending.');
        send(payload);
      },
      list: () => bridgeRef.current.list(),
      read: (path) => bridgeRef.current.read(path),
      write: (path, content) => bridgeRef.current.write(path, content),
      append: (path, content) => bridgeRef.current.append(path, content),
      delete: (path) => bridgeRef.current.delete(path),
      rename: (from, to) => bridgeRef.current.rename(from, to),
      flush: () => bridgeRef.current.flush(),
      compareAndSwap: (path, expected, content) => bridgeRef.current.compareAndSwap(path, expected, content),
      watch: (listener) => bridgeRef.current.watch(listener),
      watchActiveNote: (listener) => bridgeRef.current.watchActiveNote(listener),
    };
    let list;
    try { list = await window.api.listExtensions(); }
    catch (error) { notify(error.message); return; }
    const themes = [];
    const nextCommands = [];
    const loaded = await Promise.all(list.map(async (item) => {
      if (item.error || !item.enabled) return item;
      try {
        const { source, themes: files, limits } = await window.api.loadExtension(item.id);
        files.forEach((theme, index) => themes.push({
          ...validateTheme(theme, limits), id: `ext:${item.id}:${index}`, extension: item.name,
        }));
        if (source) {
          const host = new ExtensionHost(item, source, bridge, limits);
          await host.start();
          if (current !== generation.current) { host.dispose(); return item; }
          hosts.current.set(item.id, host);
          for (const command of item.contributes.commands) {
            nextCommands.push({
              id: extensionCommandId(item.id, command.id), label: `${item.name}: ${command.title}`,
              action: null, scope: 'app', key: usableDefaultKey(command.key, nextCommands), extensionId: item.id, command: command.id,
            });
          }
        }
        return item;
      } catch (error) {
        return { ...item, error: error.message };
      }
    }));
    if (current !== generation.current) return;
    registerExtensionThemes(themes);
    setExtensions(loaded);
    setCommands(nextCommands);
  }, [bridgeRef, notify]);

  useEffect(() => {
    reload();
    const active = hosts;
    return () => { generation.current++; active.current.forEach((host) => host.dispose()); };
  }, [reload]);
  useEffect(() => {
    window.addEventListener('customizationlimits', reload);
    return () => window.removeEventListener('customizationlimits', reload);
  }, [reload]);

  const run = useCallback((item) => {
    try { hosts.current.get(item.extensionId)?.run(item.command); }
    catch (error) { notify(error.message); }
  }, [notify]);

  const setEnabled = useCallback(async (id, enabled) => {
    const item = extensions.find((extension) => extension.id === id);
    await window.api.setExtensionEnabled(id, enabled, item?.reviewToken);
    await reload();
  }, [reload, extensions]);

  const closeSurface = (surface) => surface.host.bridge.closeSurface(surface.host, surface.kind, surface.id);
  return {
    extensions, commands, surfaces, closeSurface, run, reload, setEnabled,
    settingsRevision, getSetting: getExtensionSetting, setSettings: setExtensionSettings, resetSettings: resetExtensionSettings
  };
}
