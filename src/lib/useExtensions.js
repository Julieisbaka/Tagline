import { useCallback, useEffect, useRef, useState } from 'react';
import { ExtensionHost, extensionCommandId, usableDefaultKey } from './extensionHost.js';
import { getExtensionSetting, resetExtensionSettings, setExtensionSettings } from './extensionSettings.js';
import { registerExtensionThemes, validateTheme } from './themes.js';

/** 
 * Manage extension hosts, contributions, and their application bridge lifecycle.
 * @param {object} options - The options object containing bridgeRef and notify callback.
 * @returns {object} - An object containing the current extensions, commands, and surfaces.
 */
export function useExtensions({ bridgeRef, notify }) {
  const [extensions, setExtensions] = useState([]);
  const [commands, setCommands] = useState([]);
  const [surfaces, setSurfaces] = useState([]);
  const hosts = useRef(new Map());
  const generation = useRef(0);
  const [settingsRevision, settingsChanged] = useState(0);
  useEffect(() => {
    /** 
     * Trigger a render when extension settings are edited.
     * @returns {void} 
     */
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
      removeSurfaces: (host) => {
        setSurfaces((previous) => previous.filter((item) => item.host !== host));
        setExtensions((previous) => previous.map((item) => item.id === host.manifest.id
          ? { ...item, error: 'Extension stopped. Reload to restore its contributions.' } : item));
      },
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
        const { source, themes: files, limits, firstInstall, installToken } = await window.api.loadExtension(item.id);
        if (current !== generation.current) return item;
        files.forEach((theme, index) => themes.push({
          ...validateTheme(theme, limits), id: `ext:${item.id}:${index}`, extension: item.name,
        }));
        if (source) {
          const host = new ExtensionHost(item, source, bridge, limits, firstInstall);
          await host.start();
          if (current !== generation.current) { host.dispose(); return item; }
          if (installToken) {
            try { await window.api.completeExtensionInstall(item.id, installToken); }
            catch (error) { host.dispose(); throw error; }
          }
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
    try {
      const host = hosts.current.get(item.extensionId);
      if (!host) throw new Error('Extension is not running. Reload it in Settings > Extensions.');
      host.run(item.command);
    }
    catch (error) { notify(error.message); }
  }, [notify]);

  const setEnabled = useCallback(async (id, enabled) => {
    const item = extensions.find((extension) => extension.id === id);
    await window.api.setExtensionEnabled(id, enabled, item?.reviewToken);
    await reload();
  }, [reload, extensions]);

  /** 
   * Close one extension-contributed panel or webview.
   * @param {object} surface - The surface object representing the panel or webview to close.
   * @returns {*} - The result of the close operation.
   */
  const closeSurface = (surface) => surface.host.bridge.closeSurface(surface.host, surface.kind, surface.id);
  const ribbonItems = extensions.filter((item) => item.enabled && !item.error).flatMap((item) =>
    (item.contributes.ribbonItems || []).map((declaration) => ({
      id: extensionCommandId(item.id, declaration.id), title: `${item.name}: ${declaration.title}`,
      icon: declaration.icon, run: () => run({ extensionId: item.id, command: declaration.command }),
    })));
  return {
    extensions, commands, ribbonItems, surfaces, closeSurface, run, reload, setEnabled,
    settingsRevision, getSetting: getExtensionSetting, setSettings: setExtensionSettings, resetSettings: resetExtensionSettings
  };
}
