import { useState } from 'react';
import { useConfirm } from '../dialogs/ConfirmProvider.jsx';
import { useI18n } from '../../lib/i18n.js';
import SettingsGroup from './SettingsGroup.jsx';

export default function ExtensionBrowser({ extensions, permissionLabels }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [registry, setRegistry] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const installed = new Map(
    extensions.extensions.filter((item) => item.id).map((item) => [item.id, item])
  );
  const load = async (refresh) => {
    setBusy('list');
    setError('');
    try {
      setRegistry(await window.api.listExtensionRegistry(refresh));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };
  const install = async (entry, update) => {
    const permissions = entry.permissions.length
      ? entry.permissions.map((permission) => t(permissionLabels[permission] || permission))
      : [t('No special permissions')];
    const hosts = entry.networkHosts?.length
      ? ` ${t('Requested HTTPS hosts: {hosts}', { hosts: entry.networkHosts.join(', ') })}`
      : '';
    if (
      !(await confirm(
        `${t(update ? 'Update "{name}" to v{version}?' : 'Install "{name}" v{version}?', {
          name: entry.name,
          version: entry.version,
        })} ${t('It requests: {permissions}.', { permissions: permissions.join('; ') })}${hosts} ${t(
          'Community extensions are not reviewed by Tagline. Install only extensions you trust.'
        )}`
      ))
    ) {
      return;
    }
    setBusy(entry.url);
    setError('');
    setNotice('');
    try {
      const result = await window.api.installRegistryExtension(entry.url, entry.id);
      await extensions.reload();
      setNotice(
        result.reviewRequired
          ? t('Installed {name}. Review its permissions below, then enable it.', {
              name: result.name,
            })
          : t('Installed and enabled {name} v{version}.', {
              name: result.name,
              version: result.version,
            })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };
  const needle = query.trim().toLowerCase();
  const entries = (registry?.entries || []).filter(
    (entry) =>
      !needle ||
      [entry.name, entry.description, entry.id, entry.url, ...(entry.authors || [])].some((value) =>
        value?.toLowerCase().includes(needle)
      )
  );
  return (
    <SettingsGroup title={t('Browse extensions')} className='extension-browser'>
      <p>
        {t(
          'Find community extensions listed in the Tagline extension registry. Tagline contacts GitHub only when you browse or install.'
        )}
      </p>
      <div className='settings-actions'>
        <button disabled={!!busy} onClick={() => load(!!registry)}>
          {registry ? t('Refresh registry') : t('Browse registry')}
        </button>
        {registry && (
          <button
            disabled={!!busy}
            onClick={() =>
              window.api
                .websiteAction('external', registry.registryUrl)
                .catch((err) => setError(err.message))
            }
          >
            {t('Submit an extension')}
          </button>
        )}
      </div>
      {busy === 'list' && <p role='status'>{t('Loading extension registry…')}</p>}
      {notice && <p role='status'>{notice}</p>}
      {error && (
        <p role='alert' className='error-text'>
          {error}
        </p>
      )}
      {registry && (
        <>
          <input
            type='search'
            className='extension-browser-search'
            placeholder={t('Search extensions')}
            aria-label={t('Search extensions')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {!entries.length && (
            <p className='settings-empty'>
              {registry.entries.length
                ? t('No registry extensions match your search.')
                : t('The registry has no extensions yet.')}
            </p>
          )}
          <ul className='extension-list'>
            {entries.map((entry) => {
              const current = entry.id && installed.get(entry.id);
              const update = !!current && current.version !== entry.version;
              return (
                <li key={entry.url} className='extension-card' data-registry-extension={entry.url}>
                  <div className='extension-head'>
                    <div>
                      <strong>{entry.name}</strong>
                      {entry.version && <span className='extension-version'>v{entry.version}</span>}
                      {entry.authors?.length > 0 && (
                        <span className='extension-author'>
                          {t('by {author}', { author: entry.authors.join(', ') })}
                        </span>
                      )}
                    </div>
                    {current && !update && (
                      <span className='extension-installed'>{t('Installed')}</span>
                    )}
                  </div>
                  {entry.description && <p>{entry.description}</p>}
                  {entry.permissions?.length > 0 && (
                    <p>
                      {t('Permissions: {permissions}', {
                        permissions: entry.permissions
                          .map((permission) => t(permissionLabels[permission] || permission))
                          .join('; '),
                      })}
                    </p>
                  )}
                  {entry.networkHosts?.length > 0 && (
                    <p>
                      {t('Requested HTTPS hosts: {hosts}', {
                        hosts: entry.networkHosts.join(', '),
                      })}
                    </p>
                  )}
                  {entry.error && (
                    <p role='alert' className='error-text'>
                      {entry.error}
                    </p>
                  )}
                  <div className='settings-actions'>
                    {!entry.error && (!current || update) && (
                      <button disabled={!!busy} onClick={() => install(entry, update)}>
                        {busy === entry.url
                          ? t('Installing…')
                          : update
                            ? t('Update to v{version}', { version: entry.version })
                            : t('Install')}
                      </button>
                    )}
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        window.api
                          .websiteAction('external', entry.sourceUrl || entry.url)
                          .catch((err) => setError(err.message))
                      }
                    >
                      {t('View source')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SettingsGroup>
  );
}
