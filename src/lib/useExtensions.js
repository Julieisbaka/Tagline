import { useCallback, useEffect, useRef, useState } from 'react';
import { ExtensionHost, extensionCommandId, usableDefaultKey } from './extensionHost.js';
import {
  clearExtensionData,
  getExtensionSetting,
  resetExtensionSettings,
  setExtensionSettings,
} from './extensionSettings.js';
import { registerExtensionThemes, validateTheme } from './themes.js';

const readSurfaceVisibility = (key) => {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
};
const writeSurfaceVisibility = (key, visible) => {
  try {
    localStorage.setItem(key, String(visible));
  } catch {
    // Surface state remains usable for this session when storage is unavailable.
  }
};

/**
 * Manage extension hosts, contributions, and their application bridge lifecycle.
 * @param {object} options - The options object containing bridgeRef and notify callback.
 * @returns {object} - An object containing the current extensions, commands, and surfaces.
 */
export function useExtensions({ bridgeRef, notify }) {
  const [extensions, setExtensions] = useState([]);
  const [commands, setCommands] = useState([]);
  const [surfaces, setSurfaces] = useState([]);
  const [statusBarItems, setStatusBarItems] = useState([]);
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
  useEffect(() => {
    const activateQuickFix = (event) => {
      const target = event.target.closest?.('[data-extension-command][data-extension-id]');
      if (!target) return;
      const host = hosts.current.get(target.dataset.extensionId);
      if (!host) return;
      event.preventDefault();
      try {
        host.require('editor');
        const note = bridgeRef.current.getActiveNote();
        host.run(target.dataset.extensionCommand, {
          path: note?.path || null,
          selection: {
            from: Number(target.dataset.diagnosticFrom) || 0,
            to: Number(target.dataset.diagnosticTo) || 0,
          },
          uri: null,
        });
      } catch (error) {
        notify(error.message);
      }
    };
    document.addEventListener('click', activateQuickFix);
    return () => document.removeEventListener('click', activateQuickFix);
  }, [bridgeRef, notify]);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    hosts.current.forEach((host) => host.dispose());
    hosts.current = new Map();
    setStatusBarItems([]);
    const bridge = {
      notify: (message) => notify(message),
      getActiveNote: () => bridgeRef.current.getActiveNote(),
      setEditorDiagnostics: (extensionId, diagnostics) => {
        window.dispatchEvent(
          new CustomEvent('tagline-extension-diagnostics', { detail: { extensionId, diagnostics } })
        );
        return true;
      },
      insertText: (text) => bridgeRef.current.insertText(text),
      setSelection: (selection) => bridgeRef.current.setSelection(selection),
      getTiptapSnapshot: () => bridgeRef.current.getTiptapSnapshot(),
      runTiptapCommand: (command, options) => bridgeRef.current.runTiptapCommand(command, options),
      updateSurface: (host, kind, id, html, show) => {
        const declaration = host.manifest.contributes[kind].find((item) => item.id === id);
        const storageKey = `tagline-extension-surface:${host.manifest.id}:${kind}:${id}`;
        setSurfaces((previous) => {
          const existing = previous.find(
            (item) => item.host === host && item.kind === kind && item.id === id
          );
          const next = {
            host,
            kind,
            id,
            html,
            title: `${host.manifest.name}: ${declaration.title}`,
            placement: declaration.placement || 'right-panel',
            when: declaration.when,
            visible:
              show ||
              existing?.visible ||
              (!existing && declaration.persistVisibility && readSurfaceVisibility(storageKey)),
          };
          if (declaration.persistVisibility && show) {
            writeSurfaceVisibility(storageKey, true);
          }
          return [
            ...previous.filter(
              (item) => !(item.host === host && item.kind === kind && item.id === id)
            ),
            next,
          ];
        });
      },
      closeSurface: (host, kind, id) => {
        const declaration = host.manifest.contributes[kind].find((item) => item.id === id);
        if (declaration?.persistVisibility) {
          writeSurfaceVisibility(
            `tagline-extension-surface:${host.manifest.id}:${kind}:${id}`,
            false
          );
        }
        setSurfaces((previous) =>
          previous.map((item) =>
            item.host === host && item.kind === kind && item.id === id
              ? { ...item, visible: false }
              : item
          )
        );
      },
      updateStatusBar: (host, items) =>
        setStatusBarItems((previous) => [
          ...previous.filter((item) => item.host !== host),
          ...items.map((item) => ({ ...item, host })),
        ]),
      removeSurfaces: (host) => {
        setSurfaces((previous) => previous.filter((item) => item.host !== host));
        setStatusBarItems((previous) => previous.filter((item) => item.host !== host));
        setExtensions((previous) =>
          previous.map((item) =>
            item.id === host.manifest.id
              ? { ...item, error: 'Extension stopped. Reload to restore its contributions.' }
              : item
          )
        );
      },
      postSurfaceMessage: (host, kind, id, payload) => {
        const send = host.surfaceTransports.get(`${kind}:${id}`);
        if (!send) {
          throw new Error(
            'Contribution is not mounted. Wait for its ready message before sending.'
          );
        }
        send(payload);
      },
      list: () => bridgeRef.current.list(),
      read: (path) => bridgeRef.current.read(path),
      chooseVaultPath: (id, kind) => window.api.extensionChooseVaultPath(id, kind),
      write: (path, content) => bridgeRef.current.write(path, content),
      networkFetch: (id, url, options) => window.api.extensionNetworkFetch(id, url, options),
      networkFetchToFile: async (id, url, destination, options) => {
        const root = bridgeRef.current.root;
        const result = await window.api.extensionNetworkFetchToFile(id, url, destination, options);
        if (bridgeRef.current.root === root) {
          await bridgeRef.current.reloadVault();
        }
        return result;
      },
      getExtensionApi: (requester, id, version) => {
        const provider = hosts.current.get(id);
        if (!provider) {
          throw new Error(`Extension "${id}" is not running.`);
        }
        requester.require('api');
        return provider.getApiDescriptor(version);
      },
      callExtensionApi: (requester, id, version, method, payload) => {
        const provider = hosts.current.get(id);
        if (!provider) {
          throw new Error(`Extension "${id}" is not running.`);
        }
        return provider.invokeApi(requester, version, method, payload);
      },
      secret: (id, action, key, value) => window.api.extensionSecret(id, action, key, value),
      extensionStorage: (id, action, key, value) =>
        window.api.extensionStorage(id, action, key, value),
      append: (path, content) => bridgeRef.current.append(path, content),
      delete: (path) => bridgeRef.current.delete(path),
      rename: (from, to) => bridgeRef.current.rename(from, to),
      flush: () => bridgeRef.current.flush(),
      compareAndSwap: (path, expected, content) =>
        bridgeRef.current.compareAndSwap(path, expected, content),
      watch: (listener) => bridgeRef.current.watch(listener),
      watchActiveNote: (listener) => bridgeRef.current.watchActiveNote(listener),
    };
    let list;
    try {
      list = await window.api.listExtensions();
    } catch (error) {
      notify(error.message);
      return;
    }
    const themes = [];
    const nextCommands = [];
    const loaded = await Promise.all(
      list.map(async (item) => {
        if (item.error || !item.enabled) {
          return item;
        }
        let extensionHost = null;
        try {
          const {
            source,
            themes: files,
            themeGroups = [],
            limits,
            firstInstall,
            installToken,
          } = await window.api.loadExtension(item.id);
          if (current !== generation.current) {
            return item;
          }
          files.forEach((theme, index) =>
            themes.push({
              ...validateTheme(theme, limits),
              id: `ext:${item.id}:${index}`,
              extension: item.name,
            })
          );
          themeGroups.forEach((group) =>
            ['light', 'dark'].forEach((mode) =>
              themes.push({
                ...validateTheme(group[mode], limits),
                mode,
                id: `ext:${item.id}:${group.id}:${mode}`,
                name: group[mode]?.name || `${group.title} (${mode})`,
                extension: item.name,
                group: { id: `ext:${item.id}:${group.id}`, title: group.title },
              })
            )
          );
          if (source) {
            const host = new ExtensionHost(
              item,
              source,
              bridge,
              limits,
              firstInstall,
              item.allowedPermissions
            );
            extensionHost = host;
            hosts.current.set(item.id, host);
            await host.start();
            if (current !== generation.current) {
              host.dispose();
              if (hosts.current.get(item.id) === host) {
                hosts.current.delete(item.id);
              }
              return item;
            }
            if (installToken) {
              try {
                await window.api.completeExtensionInstall(item.id, installToken);
              } catch (error) {
                host.dispose();
                throw error;
              }
            }
            if (current !== generation.current) {
              host.dispose();
              if (hosts.current.get(item.id) === host) {
                hosts.current.delete(item.id);
              }
              return item;
            }
            for (const command of item.contributes.commands) {
              nextCommands.push({
                id: extensionCommandId(item.id, command.id),
                label: `${item.name}: ${command.title}`,
                action: null,
                scope: 'app',
                key: usableDefaultKey(command.key, nextCommands),
                extensionId: item.id,
                command: command.id,
              });
            }
            if (
              host.manifest.permissions.includes('ui') &&
              (host.allowedPermissions || host.manifest.permissions).includes('ui')
            ) {
              setStatusBarItems((previous) => [
                ...previous.filter((status) => status.host !== host),
                ...[...host.statusBar].map(([id, status]) => ({ ...status, id, host })),
              ]);
            }
          }
          return item;
        } catch (error) {
          extensionHost?.dispose();
          if (hosts.current.get(item.id) === extensionHost) {
            hosts.current.delete(item.id);
          }
          return { ...item, error: error.message };
        }
      })
    );
    if (current !== generation.current) {
      return;
    }
    registerExtensionThemes(themes);
    setExtensions(loaded);
    setCommands(nextCommands);
  }, [bridgeRef, notify]);

  useEffect(() => {
    reload();
    const active = hosts;
    const gen = generation;
    return () => {
      gen.current += 1;
      active.current.forEach((host) => host.dispose());
    };
  }, [reload]);
  useEffect(() => {
    window.addEventListener('customizationlimits', reload);
    return () => window.removeEventListener('customizationlimits', reload);
  }, [reload]);

  const run = useCallback(
    (item) => {
      try {
        const host = hosts.current.get(item.extensionId);
        if (!host) {
          throw new Error('Extension is not running. Reload it in Settings > Extensions.');
        }
        host.run(item.command);
      } catch (error) {
        notify(error.message);
      }
    },
    [notify]
  );

  const setEnabled = useCallback(
    async (id, enabled) => {
      const item = extensions.find((extension) => extension.id === id);
      await window.api.setExtensionEnabled(id, enabled, item?.reviewToken);
      await reload();
    },
    [reload, extensions]
  );
  const setPermission = useCallback(
    async (id, permission, allowed) => {
      const item = extensions.find((extension) => extension.id === id);
      if (!item) {
        throw new Error('Extension not found.');
      }
      const permissions = new Set(item.allowedPermissions);
      if (allowed) {
        permissions.add(permission);
      } else {
        permissions.delete(permission);
      }
      hosts.current.get(id)?.dispose();
      hosts.current.delete(id);
      try {
        await window.api.setExtensionPermissions(id, [...permissions], item.reviewToken);
      } catch (error) {
        await reload();
        throw error;
      }
      await reload();
    },
    [reload, extensions]
  );
  const uninstall = useCallback(
    async (folder) => {
      const item = extensions.find((extension) => extension.folder === folder);
      if (!item) {
        throw new Error('Extension not found.');
      }
      hosts.current.get(item.id)?.dispose();
      hosts.current.delete(item.id);
      try {
        await window.api.uninstallExtension(folder);
      } catch (error) {
        await reload();
        throw error;
      }
      if (item.id) {
        clearExtensionData(item);
      }
      await reload();
    },
    [reload, extensions]
  );

  /**
   * Close one extension-contributed panel or webview.
   * @param {object} surface - The surface object representing the panel or webview to close.
   * @returns {*} - The result of the close operation.
   */
  const closeSurface = (surface) =>
    surface.host.bridge.closeSurface(surface.host, surface.kind, surface.id);
  const ribbonItems = extensions
    .filter((item) => item.enabled && !item.error && item.allowedPermissions.includes('ui'))
    .flatMap((item) =>
      (item.contributes.ribbonItems || []).map((declaration) => ({
        id: extensionCommandId(item.id, declaration.id),
        title: `${item.name}: ${declaration.title}`,
        icon: declaration.icon,
        run: () => run({ extensionId: item.id, command: declaration.command }),
      }))
    );
  const contextMenuItems = (context, payload) => {
    const items = [];
    const handlers = [];
    for (const host of hosts.current.values()) {
      if (
        !host.manifest.permissions.includes('ui') ||
        !(host.allowedPermissions || host.manifest.permissions).includes('ui')
      ) {
        continue;
      }
      for (const declaration of host.manifest.contributes.contextMenus || []) {
        if (declaration.context === context && host.registered.has(declaration.command)) {
          items.push({
            label: `${host.manifest.name}: ${declaration.title}`,
            extensionId: host.manifest.id,
            command: declaration.command,
            priority: 0,
            run: () => {
              try {
                host.run(declaration.command, payload);
              } catch (error) {
                notify(error.message);
              }
            },
          });
        }
      }
      if (context === 'file-explorer' || context === 'tab') {
        const extension = payload?.path?.match(/\.[^.\/]+$/)?.[0]?.toLowerCase();
        for (const declaration of host.manifest.contributes.fileHandlers || []) {
          if (
            extension &&
            declaration.extensions.includes(extension) &&
            host.registered.has(declaration.command)
          ) {
            handlers.push({
              label: `Open with ${host.manifest.name}: ${declaration.title}`,
              extensionId: host.manifest.id,
              command: declaration.command,
              priority: declaration.priority,
              run: () => {
                try {
                  host.run(declaration.command, payload);
                } catch (error) {
                  notify(error.message);
                }
              },
            });
          }
        }
      }
    }
    return [
      ...items.sort((a, b) => a.label.localeCompare(b.label)),
      ...handlers.sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label)),
    ];
  };
  return {
    extensions,
    commands,
    ribbonItems,
    statusBarItems: statusBarItems.filter(
      (item) => hosts.current.get(item.host.manifest.id) === item.host
    ),
    contextMenuItems,
    surfaces,
    closeSurface,
    run,
    reload,
    setEnabled,
    setPermission,
    uninstall,
    settingsRevision,
    getSetting: getExtensionSetting,
    setSettings: setExtensionSettings,
    resetSettings: resetExtensionSettings,
  };
}
