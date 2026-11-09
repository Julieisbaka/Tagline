import { getRuntimeLimits, validateLimits } from '../../electron/customization.mjs';
import { parseFlow, serializeFlow } from '../../electron/flow.mjs';
import { parseCanvas, serializeCanvas } from './canvas.js';
import {
  APPLICATION_EVENTS,
  EDITOR_COMMANDS,
  applicationEvents,
  extensionHelper,
  pathHelper,
  requireEventName,
  requirePayload,
  requireSelection,
} from './extensionCapabilities.js';
import { getExtensionSetting, setExtensionSettings } from './extensionSettings.js';
import { KEYBINDINGS, reservedBinding, validBinding } from './keybindings.js';

const SANDBOX_URL = 'extension-sandbox.html';
const MAX_TEXT = 5_000_000;
const API_METHOD = /^[a-z][a-zA-Z0-9]{0,63}$/;
const API_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

function requireApiPayload(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Extension API payload must be JSON-serializable.');
  }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 65536) {
    throw new Error('Extension API payload must be JSON up to 65,536 bytes.');
  }
  return JSON.parse(serialized);
}

function requireApiVersion(value, optional = false) {
  if (optional && value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('Extension API version must be an integer from 1 to 65,535.');
  }
  return value;
}

function requireApiMethods(value) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 64 ||
    value.some((method) => typeof method !== 'string' || !API_METHOD.test(method)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('Extension API must export 1–64 unique lowercase method names.');
  }
  return value;
}

/**
 * Build the fully qualified internal command ID for an extension contribution.
 * @param {string} extensionId The ID of the extension.
 * @param {string} commandId The ID of the command within the extension.
 * @returns {string} The fully qualified internal command ID.
 */
export const extensionCommandId = (extensionId, commandId) => `ext:${extensionId}.${commandId}`;

/**
 * Validate text received across the extension worker bridge.
 * @param {*} value The value to validate as text.
 * @param {string} label A descriptive label for the value, used in error messages.
 * @param {number} [max] The maximum allowed length of the text.
 * @returns {string} The validated text.
 */
function requireText(value, label, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`${label} must be text up to ${max} characters.`);
  }
  return value;
}

function requireUiContext(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('UI command context must be an object.');
  }
  const path = value.path == null ? null : requireText(value.path, 'Context path', 1000);
  const uri = value.uri == null ? null : requireText(value.uri, 'Context URI', 1500);
  const selection = value.selection == null ? null : requirePayload(value.selection);
  const context = { path, selection, uri };
  if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 8192) {
    throw new Error('UI command context exceeds 8,192 bytes.');
  }
  return context;
}

export class ExtensionHost {
  constructor(
    manifest,
    source,
    bridge,
    limits = getRuntimeLimits(),
    firstInstall = false,
    allowedPermissions
  ) {
    this.manifest = manifest;
    this.allowedPermissions = allowedPermissions;
    this.source = source;
    this.bridge = bridge;
    this.limits = Object.freeze(validateLimits(limits));
    this.firstInstall = firstInstall;
    this.registered = new Set();
    this.watches = new Map();
    this.activeNoteWatches = new Map();
    this.eventWatches = new Map();
    this.surfaces = new Map();
    this.surfaceTransports = new Map();
    this.statusBar = new Map(
      (manifest.contributes?.statusBarItems || []).map((item) => [
        item.id,
        { text: item.title, icon: item.icon, tooltip: item.title, command: item.command },
      ])
    );
    this.nextWatch = 0;
    this.pendingCalls = 0;
    this.messageTimes = [];
    this.networkRequestTimes = [];
    this.exportedApi = null;
    this.apiStarted = false;
    this.apiWaiters = [];
    this.apiCalls = new Map();
    this.nextApiCall = 0;
    this.storageWrites = Promise.resolve();
    this.onMessage = this.onMessage.bind(this);
  }

  start(timeout = this.limits.extensionStartupMs) {
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.dataset.extension = this.manifest.id;
    this.frame.style.display = 'none';
    this.frame.src = new URL(SANDBOX_URL, document.baseURI).href;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onMessage;
    this.port.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose();
        reject(new Error(`Extension did not start within ${timeout / 1000} seconds.`));
      }, timeout);
      this.settle = (error) => {
        clearTimeout(timer);
        this.settle = null;
        if (error) {
          this.dispose();
          reject(error);
        } else {
          resolve();
        }
      };
      this.frame.addEventListener(
        'load',
        () =>
          this.frame?.contentWindow.postMessage(
            {
              type: 'start',
              source: this.source,
              limits: this.limits,
              firstInstall: this.firstInstall,
            },
            '*',
            [channel.port2]
          ),
        { once: true }
      );
      document.body.append(this.frame);
    });
  }

  require(permission) {
    if (!this.manifest.permissions.includes(permission)) {
      throw new Error(`Permission "${permission}" is not declared in the manifest.`);
    }
    if (!(this.allowedPermissions || this.manifest.permissions).includes(permission)) {
      throw new Error(`Permission "${permission}" is not allowed for this extension.`);
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
      case 'editor.getActiveNote':
        this.require('editor');
        return b.getActiveNote();
      case 'canvas.read':
      case 'flow.read': {
        this.require('vault:read');
        const kind = method.split('.')[0];
        const path = requireText(args[0], 'Path', 1000);
        if (!path.toLowerCase().endsWith(`.${kind}`)) {
          throw new Error(`Expected a .${kind} path.`);
        }
        const content = await b.read(path);
        return kind === 'canvas' ? parseCanvas(content) : parseFlow(content);
      }
      case 'canvas.write':
      case 'flow.write': {
        this.require('vault:write');
        const kind = method.split('.')[0];
        const path = requireText(args[0], 'Path', 1000);
        if (!path.toLowerCase().endsWith(`.${kind}`)) {
          throw new Error(`Expected a .${kind} path.`);
        }
        const content = kind === 'canvas' ? serializeCanvas(args[1]) : serializeFlow(args[1]);
        return b.write(path, requireText(content, 'Content'));
      }
      case 'editor.insertText':
        this.require('editor');
        await b.insertText(requireText(args[0], 'Text'));
        return true;
      case 'editor.setSelection':
        this.require('editor');
        return b.setSelection(requireSelection(args[0]));
      case 'editor.setDiagnostics': {
        this.require('editor');
        const diagnostics = args[0];
        if (!Array.isArray(diagnostics) || diagnostics.length > 200)
          throw new Error('Diagnostics must be a list of at most 200 ranges.');
        const commands = new Set((this.manifest.contributes?.commands || []).map(({ id }) => id));
        const checked = diagnostics.map((item) => {
          if (
            !item ||
            !Number.isInteger(item.from) ||
            !Number.isInteger(item.to) ||
            item.from < 0 ||
            item.to <= item.from ||
            item.to > 5_000_000 ||
            typeof item.message !== 'string' ||
            item.message.length > 500 ||
            !['error', 'warning', 'info'].includes(item.severity || 'info')
          )
            throw new Error('Invalid editor diagnostic.');
          if (JSON.stringify(item).length > 4096)
            throw new Error('Editor diagnostic exceeds the size limit.');
          if (
            item.quickFix &&
            (typeof item.quickFix.title !== 'string' ||
              item.quickFix.title.length > 80 ||
              !commands.has(item.quickFix.command))
          )
            throw new Error('Quick fixes must reference a declared command.');
          return {
            from: item.from,
            to: item.to,
            message: item.message,
            severity: item.severity || 'info',
            ...(item.quickFix ? { quickFix: item.quickFix } : {}),
          };
        });
        return b.setEditorDiagnostics?.(this.manifest.id, checked) ?? false;
      }
      case 'editor.getTiptapSnapshot':
        this.require('editor');
        return b.getTiptapSnapshot();
      case 'editor.runTiptapCommand': {
        this.require('editor');
        const [command, options] = args;
        if (!EDITOR_COMMANDS.includes(command)) {
          throw new Error('Unsupported Tiptap command.');
        }
        if (command === 'toggleHeading') {
          if (
            !options ||
            !Number.isInteger(options.level) ||
            options.level < 1 ||
            options.level > 6
          ) {
            throw new Error('Heading level must be an integer from 1 to 6.');
          }
        } else if (options !== undefined) {
          throw new Error('This command does not accept options.');
        }
        return b.runTiptapCommand(
          command,
          command === 'toggleHeading' ? { level: options.level } : undefined
        );
      }
      case 'events.subscribe': {
        this.require('events');
        const name = requireEventName(args[0]);
        if (APPLICATION_EVENTS[name]) {
          this.require(APPLICATION_EVENTS[name]);
        } else if (!/^ext\.[a-z0-9][a-z0-9-]{1,63}\.[a-z][a-zA-Z0-9.-]*$/.test(name)) {
          throw new Error(
            'Unknown application event. Custom events must use ext.extension-id.name.'
          );
        }
        if (this.eventWatches.size >= this.limits.extensionWatches) {
          throw new Error('Too many event listeners.');
        }
        const id = ++this.nextWatch;
        this.eventWatches.set(
          id,
          applicationEvents.on(name, (payload) => this.sendEvent('application-event', id, payload))
        );
        return id;
      }
      case 'events.unsubscribe': {
        this.eventWatches.get(args[0])?.();
        return this.eventWatches.delete(args[0]);
      }
      case 'events.emit': {
        this.require('events');
        const name = requireEventName(args[0]);
        if (
          !name.startsWith(`ext.${this.manifest.id}.`) ||
          !/^ext\.[a-z0-9][a-z0-9-]{1,63}\.[a-z][a-zA-Z0-9.-]*$/.test(name)
        ) {
          throw new Error('Extensions can emit only their own namespaced events.');
        }
        applicationEvents.emit(name, requirePayload(args[1]));
        return true;
      }
      case 'extensions.export': {
        this.require('api');
        if (this.exportedApi || this.apiStarted) {
          throw new Error('Export one extension API during initialization.');
        }
        const version = requireApiVersion(args[0]);
        const methods = requireApiMethods(args[1]);
        this.exportedApi = { version, methods };
        this.resolveApiWaiters();
        return true;
      }
      case 'extensions.getApi': {
        this.require('api');
        const id = requireText(args[0], 'Extension ID', 64);
        if (!API_ID.test(id)) {
          throw new Error('Invalid extension ID.');
        }
        return b.getExtensionApi(this, id, requireApiVersion(args[1], true));
      }
      case 'extensions.call': {
        this.require('api');
        const id = requireText(args[0], 'Extension ID', 64);
        const version = requireApiVersion(args[1]);
        const method = args[2];
        if (!API_ID.test(id) || typeof method !== 'string' || !API_METHOD.test(method)) {
          throw new Error('Invalid extension API target.');
        }
        return b.callExtensionApi(this, id, version, method, requireApiPayload(args[3]));
      }
      case 'helpers.path':
        return pathHelper(args[0], args.slice(1));
      case 'helpers.countdown.remainingAt':
      case 'helpers.language.system':
      case 'helpers.language.initial':
      case 'helpers.keybindings.valid':
      case 'helpers.keybindings.display':
      case 'helpers.layout.normalizeRibbon':
      case 'helpers.layout.moveRibbon':
      case 'helpers.layout.normalizeWorkspace':
      case 'helpers.layout.moveWorkspace':
      case 'helpers.calendar.dateValue':
      case 'helpers.calendar.parseDate':
      case 'helpers.calendar.moveMonth':
      case 'helpers.calendar.monthDays':
      case 'helpers.flowCells.bounds':
      case 'helpers.flowCells.copy':
      case 'helpers.flowCells.parse':
      case 'helpers.flowCells.paste':
      case 'helpers.folders.paths':
      case 'helpers.folders.normalize':
      case 'helpers.frontmatter.split':
      case 'helpers.frontmatter.markSpeech':
      case 'helpers.frontmatter.speechPaths':
      case 'helpers.vault.isFlow':
      case 'helpers.vault.isMarkdown':
      case 'helpers.vault.isCanvas':
      case 'helpers.vault.baseName':
      case 'helpers.vault.displayName':
      case 'helpers.vault.dirName':
      case 'helpers.vault.joinPath':
      case 'helpers.vault.index':
      case 'helpers.vault.extractLinks':
      case 'helpers.vault.extractTags':
      case 'helpers.vault.resolveLink':
      case 'helpers.vault.outline':
      case 'helpers.vault.flattenTree':
      case 'helpers.vault.rewriteLinks':
      case 'helpers.vault.fuzzyScore':
      case 'helpers.citations.spoken':
      case 'helpers.citations.extract':
      case 'helpers.citations.isValidIsbn':
      case 'helpers.citations.expandTwoDigitYear':
      case 'helpers.speech.text':
      case 'helpers.speech.readingSeconds':
      case 'helpers.speech.validateSample':
      case 'helpers.speech.calibrate':
      case 'helpers.speech.assess':
      case 'helpers.nli.premise':
      case 'helpers.nli.hypotheses':
      case 'helpers.nli.label':
      case 'helpers.markdown.toText':
      case 'helpers.markdown.frontmatter':
      case 'helpers.markdown.slugify':
      case 'helpers.markdown.toHtml':
      case 'helpers.markdown.outline':
      case 'helpers.markdown.extractLinks':
      case 'helpers.markdown.extractTags':
      case 'helpers.markdown.resolveLink':
      case 'helpers.cards.getAt':
      case 'helpers.cards.stats':
      case 'helpers.cards.spokenEvidence':
      case 'helpers.cards.formatDuration':
      case 'helpers.search.fuzzyScore':
      case 'helpers.templates.fill':
      case 'helpers.citations.create':
      case 'helpers.speech.analyze':
      case 'helpers.speech.estimate':
      case 'helpers.canvas.parse':
      case 'helpers.canvas.serialize':
      case 'helpers.canvas.createNode':
      case 'helpers.canvas.createArgumentEdge':
      case 'helpers.canvas.groupMembers':
      case 'helpers.canvas.resolveLink':
      case 'helpers.canvas.suggestFiles':
      case 'helpers.canvas.createId':
      case 'helpers.canvas.moveNodes':
      case 'helpers.cards.detect':
      case 'helpers.cards.containsEvidence':
      case 'helpers.checkup.fields':
      case 'helpers.checkup.defaults':
      case 'helpers.checkup.normalize':
      case 'helpers.checkup.scan':
      case 'helpers.checkup.citedUrls':
      case 'helpers.checkup.audit':
      case 'helpers.checkup.linkIssues':
      case 'helpers.checkup.sourceIssues':
      case 'helpers.frontmatter.read':
      case 'helpers.keybindings.all':
      case 'helpers.keybindings.binding':
      case 'helpers.keybindings.reserved':
      case 'helpers.keybindings.event':
      case 'helpers.keybindings.matches':
      case 'helpers.keybindings.conflict':
      case 'helpers.keybindings.editor':
      case 'helpers.language.languages':
      case 'helpers.nli.templates':
      case 'helpers.layout.ribbonItems':
      case 'helpers.layout.defaultRibbonItems':
      case 'helpers.layout.fileActions':
      case 'helpers.layout.statusItems':
      case 'helpers.search.parse':
      case 'helpers.search.filter':
      case 'helpers.search.vault':
      case 'helpers.search.excerpt':
      case 'helpers.search.mergeHybrid':
      case 'helpers.search.candidateLimit':
      case 'helpers.themes.builtin':
      case 'helpers.themes.colorTokens':
      case 'helpers.themes.validate':
      case 'helpers.themes.resolveSettings':
      case 'helpers.themes.get':
      case 'helpers.themes.extensionThemes':
      case 'helpers.themes.contrast':
      case 'helpers.vault.isJson':
      case 'helpers.canvas.empty':
      case 'helpers.flow.parse':
      case 'helpers.flow.serialize':
      case 'helpers.flow.create':
      case 'helpers.flow.setCell':
        return extensionHelper(method, args);
      case 'ui.setHtml':
      case 'ui.show':
      case 'ui.close':
      case 'ui.postMessage': {
        this.require('ui');
        const [kind, id, value] = args;
        if (
          !['panels', 'webviews'].includes(kind) ||
          !this.manifest.contributes[kind]?.some((item) => item.id === id)
        ) {
          throw new Error('Undeclared UI contribution.');
        }
        const key = `${kind}:${id}`;
        if (method === 'ui.setHtml') {
          const html = requireText(value, 'HTML', 200000);
          this.surfaces.set(key, html);
          b.updateSurface(this, kind, id, html, false);
        } else if (method === 'ui.show') {
          if (!this.surfaces.has(key)) {
            throw new Error('Set contribution HTML before showing it.');
          }
          b.updateSurface(this, kind, id, this.surfaces.get(key), true);
        } else if (method === 'ui.close') {
          b.closeSurface(this, kind, id);
        } else {
          b.postSurfaceMessage(this, kind, id, requirePayload(value));
        }
        return true;
      }
      case 'ui.statusBar.setText':
      case 'ui.statusBar.setIcon':
      case 'ui.statusBar.setTooltip':
      case 'ui.statusBar.setCommand': {
        this.require('ui');
        const [id, value] = args;
        const item = this.manifest.contributes.statusBarItems?.find((entry) => entry.id === id);
        if (!item) {
          throw new Error('Undeclared status bar item.');
        }
        const state = this.statusBar.get(id);
        if (method.endsWith('setText')) {
          state.text = requireText(value, 'Status bar text', 160);
        } else if (method.endsWith('setIcon')) {
          state.icon = requireText(value, 'Status bar icon', 40);
          if (!/^[a-z-]{1,40}$/.test(state.icon)) {
            throw new Error('Invalid status bar icon.');
          }
        } else if (method.endsWith('setTooltip')) {
          state.tooltip = requireText(value, 'Status bar tooltip', 250);
        } else {
          state.command = requireText(value, 'Status bar command', 64);
          if (!this.manifest.contributes.commands.some((command) => command.id === state.command)) {
            throw new Error('Status bar command must reference a declared command.');
          }
        }
        b.updateStatusBar?.(
          this,
          [...this.statusBar].map(([itemId, status]) => ({
            id: itemId,
            ...status,
          }))
        );
        return true;
      }
      case 'settings.get':
        this.require('settings');
        return getExtensionSetting(this.manifest, requireText(args[0], 'Setting id', 64));
      case 'settings.set':
        this.require('settings');
        return setExtensionSettings(this.manifest, {
          [requireText(args[0], 'Setting id', 64)]: args[1],
        });
      case 'network.fetch':
      case 'network.fetchToFile': {
        this.require('network');
        if (method === 'network.fetchToFile') {
          this.require('vault:write');
        }
        const now = Date.now();
        this.networkRequestTimes = this.networkRequestTimes.filter((time) => now - time < 1000);
        if (this.networkRequestTimes.length >= 10) {
          throw new Error('Extensions are limited to 10 network requests per second.');
        }
        this.networkRequestTimes.push(now);
        return method === 'network.fetch'
          ? b.networkFetch(this.manifest.id, args[0], args[1])
          : b.networkFetchToFile(this.manifest.id, args[0], args[1], args[2]);
      }
      case 'editor.watchActiveNote': {
        this.require('editor:active-note');
        if (this.activeNoteWatches.size >= this.limits.extensionWatches) {
          throw new Error(
            `Extension is limited to ${this.limits.extensionWatches} active-note listeners.`
          );
        }
        const id = ++this.nextWatch;
        this.activeNoteWatches.set(
          id,
          b.watchActiveNote((event) =>
            this.port?.postMessage({
              type: 'active-note-event',
              id,
              event: { path: event.path },
            })
          )
        );
        return id;
      }
      case 'editor.unwatchActiveNote': {
        this.activeNoteWatches.get(args[0])?.();
        return this.activeNoteWatches.delete(args[0]);
      }
      case 'vault.list':
        this.require('vault:read');
        return b.list();
      case 'vault.read':
        this.require('vault:read');
        return b.read(requireText(args[0], 'Path', 1000));
      case 'vault.choosePath': {
        this.require('vault:read');
        const kind = args[0] === 'folder' ? 'folder' : 'file';
        return b.chooseVaultPath(this.manifest.id, kind);
      }
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
        return b.compareAndSwap(
          requireText(args[0], 'Path', 1000),
          requireText(args[1], 'Expected content'),
          requireText(args[2], 'Content')
        );
      case 'vault.watch': {
        this.require('vault:read');
        if (this.watches.size >= this.limits.extensionWatches) {
          throw new Error(`Extension is limited to ${this.limits.extensionWatches} vault watches.`);
        }
        const id = ++this.nextWatch;
        this.watches.set(
          id,
          b.watch((event) =>
            this.port?.postMessage({
              type: 'vault-event',
              id,
              event,
            })
          )
        );
        return id;
      }
      case 'vault.unwatch': {
        this.watches.get(args[0])?.();
        return this.watches.delete(args[0]);
      }
      case 'secrets.get':
      case 'secrets.has': {
        this.require('secrets');
        return b.secret(this.manifest.id, method.slice(8), requireText(args[0], 'Key', 200));
      }
      case 'secrets.set':
        this.require('secrets');
        return b.secret(this.manifest.id, 'set', requireText(args[0], 'Key', 200), args[1]);
      case 'storage.get':
        await this.storageWrites.catch(() => {});
        {
          const data = await this.storage();
          const key = requireText(args[0], 'Key', 200);
          return Object.hasOwn(data, key) ? data[key] : null;
        }
      case 'storage.set': {
        const key = requireText(args[0], 'Key', 200);
        const valueText = JSON.stringify(args[1]);
        if (valueText !== undefined && valueText.length > this.limits.extensionStorageCharacters) {
          throw new Error('Extension storage exceeds the configured limit.');
        }
        return (this.storageWrites = this.storageWrites
          .catch(() => {})
          .then(async () => {
            const data = await this.storage();
            const next = { ...data, [key]: args[1] };
            if (args[1] === undefined || args[1] === null) {
              delete next[key];
            }
            const text = JSON.stringify(next);
            if (text.length > this.limits.extensionStorageCharacters) {
              throw new Error('Extension storage exceeds the configured limit.');
            }
            await this.bridge.extensionStorage(this.manifest.id, 'set', key, args[1]);
            if (args[1] === undefined || args[1] === null) {
              delete data[key];
            } else {
              data[key] = args[1];
            }
            return true;
          }));
      }
      default:
        throw new Error(`Unknown API method: ${method}`);
    }
  }

  async storage() {
    if (!this.storagePromise) {
      this.storagePromise = (async () => {
        const key = `tagline-extension:${this.manifest.id}`;
        const legacy = localStorage.getItem(key);
        let data = await this.bridge.extensionStorage(this.manifest.id, 'get');
        if (data === null && legacy) {
          try {
            const parsed = JSON.parse(legacy);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const text = JSON.stringify(parsed);
              if (text.length <= this.limits.extensionStorageCharacters) {
                await this.bridge.extensionStorage(this.manifest.id, 'replace', null, parsed);
                data = parsed;
              }
            }
          } catch {
            data = null;
          }
        }
        if (legacy !== null) {
          localStorage.removeItem(key);
        }
        this.storageCache = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        return this.storageCache;
      })();
    }
    return this.storagePromise;
  }

  sendEvent(type, id, event) {
    this.port?.postMessage({ type, id, event });
  }

  waitForApi() {
    if (this.exportedApi) {
      return Promise.resolve(this.exportedApi);
    }
    if (this.apiStarted || !this.frame) {
      return Promise.reject(new Error(`${this.manifest.name} did not export an API.`));
    }
    return new Promise((resolve, reject) => this.apiWaiters.push({ resolve, reject }));
  }

  resolveApiWaiters(error) {
    for (const waiter of this.apiWaiters.splice(0)) {
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve(this.exportedApi);
      }
    }
  }

  async getApiDescriptor(version) {
    this.require('api');
    const api = await this.waitForApi();
    if (version !== undefined && version !== api.version) {
      throw new Error(
        `Extension API version ${version} is unavailable; provider exports ${api.version}.`
      );
    }
    return { version: api.version, methods: [...api.methods] };
  }

  async invokeApi(requester, version, method, payload) {
    this.require('api');
    requester.require('api');
    const api = await this.getApiDescriptor(version);
    if (!api.methods.includes(method)) {
      throw new Error(`Unknown extension API method: ${method}.`);
    }
    if (!this.port || this.apiCalls.size >= this.limits.extensionPendingCalls) {
      throw new Error('Extension API provider is stopped or busy.');
    }
    const id = ++this.nextApiCall;
    return new Promise((resolve, reject) => {
      this.apiCalls.set(id, { resolve, reject });
      try {
        this.port.postMessage({
          type: 'api-call',
          id,
          method,
          payload: requireApiPayload(payload),
        });
      } catch (error) {
        this.apiCalls.delete(id);
        reject(error);
      }
    });
  }

  acceptMessage(now) {
    while (this.messageTimes.length && this.messageTimes[0] <= now - 1000) {
      this.messageTimes.shift();
    }
    if (this.messageTimes.length >= this.limits.extensionMessagesPerSecond) {
      return false;
    }
    this.messageTimes.push(now);
    return true;
  }

  async onMessage(event) {
    if (!this.frame || !event.data) {
      return;
    }
    const data = event.data;
    const now = performance.now();
    if (!this.acceptMessage(now)) {
      const error = new Error(
        `Extension exceeded ${this.limits.extensionMessagesPerSecond} messages per second and was stopped.`
      );
      if (this.settle) {
        this.settle(error);
      } else {
        this.dispose();
        this.bridge.notify(`${this.manifest.name}: ${error.message}`);
      }
      return;
    }
    if (data.type === 'ready') {
      this.apiStarted = true;
      if (!this.exportedApi) {
        this.resolveApiWaiters(new Error(`${this.manifest.name} did not export an API.`));
      }
      this.settle?.();
    } else if (data.type === 'failed') {
      const error = new Error(String(data.message));
      if (this.settle) {
        this.settle(error);
      } else {
        this.dispose();
        this.bridge.notify(`${this.manifest.name}: ${error.message}`);
      }
    } else if (data.type === 'error') {
      this.bridge.notify(`${this.manifest.name}: ${String(data.message).slice(0, 500)}`);
    } else if (data.type === 'call') {
      if (this.pendingCalls >= this.limits.extensionPendingCalls) {
        this.port.postMessage({
          type: 'result',
          id: data.id,
          error: `Extension is limited to ${this.limits.extensionPendingCalls} pending API calls.`,
        });
        return;
      }
      this.pendingCalls++;
      let reply;
      try {
        reply = {
          type: 'result',
          id: data.id,
          value: await this.handle(data.method, Array.isArray(data.args) ? data.args : []),
        };
      } catch (error) {
        reply = { type: 'result', id: data.id, error: error.message };
      } finally {
        this.pendingCalls--;
      }
      this.port?.postMessage(reply);
    } else if (data.type === 'api-result') {
      const pending = this.apiCalls.get(data.id);
      if (!pending) {
        return;
      }
      this.apiCalls.delete(data.id);
      if (data.error) {
        pending.reject(new Error(String(data.error).slice(0, 500)));
      } else {
        try {
          pending.resolve(requireApiPayload(data.value));
        } catch (error) {
          pending.reject(error);
        }
      }
    }
  }

  run(commandId, context) {
    if (!this.frame) {
      throw new Error(
        `${this.manifest.name} was stopped. Reload or disable it in Settings > Extensions.`
      );
    }
    if (!this.registered.has(commandId)) {
      throw new Error(`${this.manifest.name} has not registered "${commandId}".`);
    }
    this.port.postMessage({
      type: 'command',
      command: commandId,
      ...(context === undefined ? {} : { context: requireUiContext(context) }),
    });
  }

  dispose() {
    this.apiStarted = true;
    this.resolveApiWaiters(new Error(`${this.manifest.name} was stopped.`));
    this.apiCalls.forEach(({ reject }) => reject(new Error(`${this.manifest.name} was stopped.`)));
    this.apiCalls.clear();
    this.watches.forEach((unsubscribe) => unsubscribe());
    this.watches.clear();
    this.activeNoteWatches.forEach((unsubscribe) => unsubscribe());
    this.activeNoteWatches.clear();
    this.eventWatches.forEach((unsubscribe) => unsubscribe());
    this.eventWatches.clear();
    this.surfaces.clear();
    this.surfaceTransports.clear();
    this.bridge.removeSurfaces?.(this);
    this.port?.close();
    this.port = null;
    this.frame?.remove();
    this.frame = null;
    this.registered.clear();
    this.messageTimes = [];
    this.networkRequestTimes = [];
  }
}

/**
 * Return a valid, unclaimed default extension shortcut, or an empty string.
 * @param {string} key
 * @param {string[]} [taken]
 * @returns {string}
 */
export function usableDefaultKey(key, taken = []) {
  if (!key || !validBinding(key) || reservedBinding(key)) {
    return '';
  }
  const used = [...KEYBINDINGS, ...taken].map((item) => item.key);
  return used.includes(key) ? '' : key;
}
