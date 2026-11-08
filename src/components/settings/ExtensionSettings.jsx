import { useEffect, useState } from 'react';
import { getRuntimeLimits } from '../../../electron/customization.mjs';
import { useConfirm } from '../dialogs/ConfirmProvider.jsx';
import { useI18n } from '../../lib/i18n.js';
import SettingControl from './SettingControl.jsx';
import SettingsGroup from './SettingsGroup.jsx';

const PERMISSION_LABELS = {
  editor: 'Read and edit the active note, selection, and visual editor',
  'vault:read': 'Read notes in the open vault',
  'vault:write': 'Create and change notes in the open vault',
  settings: "Read and change only this extension's declared settings",
  'editor:active-note': 'Watch active-note paths without reading note content',
  events: 'Subscribe to application events and exchange custom extension events',
  ui: 'Display sandboxed panels, webviews and ribbon shortcuts',
  network: 'Make host-mediated HTTPS requests to reviewed hosts',
  secrets: 'Store and read OS-encrypted secrets such as API keys',
};

function ExtensionSettingsForm({ item, extensions }) {
  const { t } = useI18n();
  const { settingsRevision, getSetting } = extensions;
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const importSettings = async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      if (file.size > getRuntimeLimits().extensionStorageCharacters * 4 + 1000) {
        throw new Error(t('Extension settings file is too large.'));
      }
      const data = JSON.parse(await file.text());
      if (
        !data ||
        data.version !== 1 ||
        data.extensionId !== item.id ||
        !data.values ||
        typeof data.values !== 'object' ||
        Array.isArray(data.values)
      ) {
        throw new Error(t('Invalid extension settings file.'));
      }
      extensions.setSettings(item, data.values);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };
  const exportSettings = async () => {
    try {
      await window.api.exportExtensionSettings(
        item.id,
        Object.fromEntries(
          item.contributes.settings.map((setting) => [
            setting.id,
            extensions.getSetting(item, setting.id),
          ])
        )
      );
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => {
    try {
      setValues(
        Object.fromEntries(
          item.contributes.settings.map((setting) => [setting.id, getSetting(item, setting.id)])
        )
      );
      setLoaded(true);
      setError('');
    } catch (err) {
      setError(err.message);
      setLoaded(false);
    }
  }, [item, settingsRevision, getSetting]);
  const apply = (reset = false) => {
    try {
      if (reset) {
        extensions.resetSettings(item);
      } else {
        const next = Object.fromEntries(
          item.contributes.settings.map((setting) => {
            const value = values[setting.id];
            if (setting.type === 'number' && String(value).trim() === '') {
              throw new Error(t('Number settings cannot be empty.'));
            }
            return [setting.id, setting.type === 'number' ? Number(value) : value];
          })
        );
        extensions.setSettings(item, next);
      }
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <fieldset className='extension-settings-form'>
      <legend>{t('Extension settings')}</legend>
      {loaded &&
        item.contributes.settings.map((setting) => (
          <SettingControl
            key={setting.id}
            setting={setting}
            data-extension-setting={setting.id}
            value={values[setting.id]}
            onChange={(value) => setValues({ ...values, [setting.id]: value })}
          />
        ))}
      {error && (
        <p role='alert' className='error-text'>
          {error}
        </p>
      )}
      <div className='settings-actions'>
        <button disabled={!loaded} onClick={() => apply()}>
          {t('Save extension settings')}
        </button>
        <button onClick={() => apply(true)}>{t('Reset extension settings')}</button>
        <button disabled={!loaded} onClick={exportSettings}>
          {t('Export extension settings')}
        </button>
      </div>
      <label>
        {t('Import extension settings')}
        <input
          className='theme-file-input'
          type='file'
          accept='.json,application/json'
          aria-label={t('Import extension settings')}
          onChange={importSettings}
        />
      </label>
    </fieldset>
  );
}

export default function ExtensionSettings({ extensions }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const act = async (task) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const install = (task) =>
    act(async () => {
      setNotice('');
      const results = [];
      const failures = [];
      for (const source of await task()) {
        try {
          const result = await window.api.installExtensionFolder(source);
          if (result) {
            results.push(result);
          }
        } catch (err) {
          failures.push(err.message);
        }
      }
      await extensions.reload();
      setNotice(
        results
          .map((item) =>
            item.reviewRequired
              ? t('Installed {name}. Review its permissions below, then enable it.', {
                  name: item.name,
                })
              : t('Installed and enabled {name} v{version}.', {
                  name: item.name,
                  version: item.version,
                })
          )
          .join(' ')
      );
      if (failures.length) {
        throw new Error(failures.join(' '));
      }
    });
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  return (
    <div
      className={`extension-dropzone${dragging ? ' dragging' : ''}`}
      data-extension-dropzone
      onDragEnter={(event) => {
        if (hasFiles(event)) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) {
          return;
        }
        event.preventDefault();
        setDragging(false);
        const files = [...event.dataTransfer.files];
        install(async () => files.map((file) => window.api.pathForFile(file)).filter(Boolean));
      }}
    >
      <SettingsGroup title={t('Installed extensions')}>
        <p>
          {t(
            'Extensions run in a sandbox without direct network, Node.js, or page access. The network permission can contact only the HTTPS hosts listed on the extension card. Enable only extensions you trust.'
          )}
        </p>
        <p className='extension-drop-hint'>
          {t('Drag an extension folder here to install it. The folder must contain manifest.json.')}
        </p>
        <div className='settings-actions'>
          <button
            disabled={busy}
            onClick={() =>
              install(async () => {
                const result = await window.api.chooseExtensionFolder();
                return result ? [result] : [];
              })
            }
          >
            {t('Install from folder…')}
          </button>
          <button onClick={() => act(() => window.api.openExtensionsFolder())}>
            {t('Open extensions folder')}
          </button>
          <button disabled={busy} onClick={() => act(extensions.reload)}>
            {t('Reload extensions')}
          </button>
        </div>
        {notice && <p role='status'>{notice}</p>}
        {error && (
          <p role='alert' className='error-text'>
            {error}
          </p>
        )}
        {!extensions.extensions.length && (
          <p className='settings-empty'>
            {t('No extensions installed. Drag a folder containing manifest.json onto this page.')}
          </p>
        )}
        <ul className='extension-list'>
          {extensions.extensions.map((item) => (
            <li key={item.folder || item.id} className='extension-card' data-extension={item.id}>
              <div className='extension-head'>
                <div>
                  <strong>{item.name || item.folder}</strong>
                  {item.version && <span className='extension-version'>v{item.version}</span>}
                  {item.author && (
                    <span className='extension-author'>
                      {t('by {author}', { author: item.author })}
                    </span>
                  )}
                </div>
                {item.id && (
                  <label className='extension-toggle'>
                    <span>{t('Enabled')}</span>
                    <input
                      type='checkbox'
                      checked={!!item.enabled}
                      disabled={busy}
                      onChange={(e) => act(() => extensions.setEnabled(item.id, e.target.checked))}
                    />
                  </label>
                )}
              </div>
              {item.description && <p>{item.description}</p>}
              {item.reviewRequired && (
                <p role='alert'>
                  {t(
                    'Review changed permissions, network hosts, and settings before enabling this extension.'
                  )}
                </p>
              )}
              {item.permissions?.length > 0 && (
                <fieldset className='extension-permissions'>
                  <legend>{t('Permissions')}</legend>
                  {item.permissions.map((permission) => (
                    <label className='extension-permission' key={permission}>
                      <span>{t(PERMISSION_LABELS[permission] || permission)}</span>
                      <span className='extension-permission-control'>
                        {t('Allow')}
                        <input
                          type='checkbox'
                          aria-label={t('Allow {permission}', {
                            permission: t(PERMISSION_LABELS[permission] || permission),
                          })}
                          checked={item.allowedPermissions.includes(permission)}
                          disabled={busy || item.error}
                          onChange={(event) =>
                            act(() =>
                              extensions.setPermission(item.id, permission, event.target.checked)
                            )
                          }
                        />
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {item.networkHosts?.length > 0 && (
                <p>
                  {t('Requested HTTPS hosts: {hosts}', { hosts: item.networkHosts.join(', ') })}
                </p>
              )}
              {item.permissions?.includes('secrets') && (
                <div className='settings-actions'>
                  <button
                    disabled={busy}
                    onClick={() => act(() => window.api.clearExtensionSecrets(item.id))}
                  >
                    {t('Clear stored secrets')}
                  </button>
                </div>
              )}
              {item.contributes?.settings?.length > 0 && (
                <ExtensionSettingsForm item={item} extensions={extensions} />
              )}
              {item.error && (
                <p role='alert' className='error-text'>
                  {item.error}
                </p>
              )}
              {item.folder && (
                <div className='settings-actions'>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        if (
                          await confirm(
                            t('Uninstall "{name}" and delete its saved settings?', {
                              name: item.name || item.folder,
                            })
                          )
                        ) {
                          await extensions.uninstall(item.folder);
                        }
                      })
                    }
                  >
                    {t('Uninstall extension')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </SettingsGroup>
    </div>
  );
}
