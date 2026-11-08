import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import SettingsGroup from './SettingsGroup.jsx';

function snippets(status) {
  const headers = { Authorization: `Bearer ${status.token}` };
  return [
    [
      'VS Code (.vscode/mcp.json)',
      JSON.stringify({ servers: { tagline: { type: 'http', url: status.url, headers } } }, null, 2),
    ],
    [
      'Copilot CLI (~/.copilot/mcp-config.json)',
      JSON.stringify(
        { mcpServers: { tagline: { type: 'http', url: status.url, headers, tools: ['*'] } } },
        null,
        2
      ),
    ],
    [
      'Claude Code',
      `claude mcp add --transport http tagline ${status.url} --header "Authorization: Bearer ${status.token}"`,
    ],
  ];
}

export default function McpSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [port, setPort] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    window.api.mcp
      .status()
      .then((value) => {
        if (!disposed) {
          setStatus(value);
          setPort(String(value.port));
        }
      })
      .catch((err) => !disposed && setError(err.message));
    return () => {
      disposed = true;
    };
  }, []);

  const run = async (action) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await action();
      if (next) {
        setStatus(next);
        setPort(String(next.port));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const copy = (text) =>
    run(async () => {
      await navigator.clipboard.writeText(text);
      setMessage(t('Copied to the clipboard.'));
    });

  return (
    <section className='mcp-settings' data-mcp-settings>
      <SettingsGroup title={t('Agent access (MCP)')}>
        <p>
          {t(
            'Lets AI agents and other MCP clients on this computer read, search, and edit the open vault. The server listens only on 127.0.0.1 and requires the access token below.'
          )}
        </p>
        <label className='setting-row'>
          <span>{t('Enable the MCP server')}</span>
          <input
            type='checkbox'
            data-mcp='enabled'
            checked={!!status?.enabled}
            disabled={!status || busy}
            onChange={(e) => run(() => window.api.mcp.configure({ enabled: e.target.checked }))}
          />
        </label>
        <label className='setting-row'>
          <span>{t('Keep MCP running after closing the window')}</span>
          <input
            type='checkbox'
            data-mcp='keepRunning'
            checked={!!status?.keepRunning}
            disabled={!status || busy}
            onChange={(e) => run(() => window.api.mcp.configure({ keepRunning: e.target.checked }))}
          />
        </label>
        <p>
          {t(
            'The server retains access to the open vault and its configured permissions while Tagline runs in the background. Reopen Tagline to manage or stop it. Quitting the app or restarting the computer stops it; it does not start automatically.'
          )}
        </p>
        {status?.vaultRoot && <p>{t('Background vault: {path}', { path: status.vaultRoot })}</p>}
        <button
          data-mcp='background'
          disabled={!status?.running || !status?.keepRunning || !status?.vaultRoot || busy}
          onClick={() =>
            run(async () => {
              await window.api.mcp.background();
            })
          }
        >
          {t('Close window and keep server running')}
        </button>
        <label className='setting-row'>
          <span>{t('Allow agents to change notes')}</span>
          <input
            type='checkbox'
            data-mcp='allowWrites'
            checked={status?.allowWrites ?? true}
            disabled={!status || busy}
            onChange={(e) => run(() => window.api.mcp.configure({ allowWrites: e.target.checked }))}
          />
        </label>
        <label className='setting-row'>
          <span>{t('Allow agents to use local models')}</span>
          <input
            type='checkbox'
            data-mcp='allowModels'
            checked={!!status?.allowModels}
            disabled={!status || busy}
            onChange={(e) => run(() => window.api.mcp.configure({ allowModels: e.target.checked }))}
          />
        </label>
        <p>
          {t(
            'Token holders can run already-loaded models, including in the background. Load models in Tagline first; agent requests never download them. Inference uses CPU and memory.'
          )}
        </p>
        <label className='setting-row'>
          <span>{t('Port')}</span>
          <input
            type='number'
            min={1024}
            max={65535}
            value={port}
            aria-label={t('MCP port')}
            disabled={!status || busy}
            onChange={(e) => setPort(e.target.value)}
            onBlur={() => {
              if (status && Number(port) !== status.port) {
                run(() => window.api.mcp.configure({ port: Number(port) }));
              }
            }}
          />
        </label>
        {status && (
          <p role='status' data-mcp='status'>
            {status.running
              ? t('Running at {url}', { url: status.url })
              : t(status.enabled ? 'Not running' : 'Stopped')}
          </p>
        )}
        {status?.error && (
          <p className='error-text' role='alert'>
            {status.error}
          </p>
        )}
        {status && (
          <>
            <label className='setting-row'>
              <span>{t('Access token')}</span>
              <input
                readOnly
                type={reveal ? 'text' : 'password'}
                value={status.token}
                aria-label={t('MCP access token')}
              />
            </label>
            <div className='integration-buttons'>
              <button disabled={busy} onClick={() => setReveal(!reveal)}>
                {t(reveal ? 'Hide token' : 'Show token')}
              </button>
              <button disabled={busy} onClick={() => copy(status.token)}>
                {t('Copy token')}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const next = await window.api.mcp.regenerateToken();
                    setMessage(t('New token created. Update your MCP clients.'));
                    return next;
                  })
                }
              >
                {t('Regenerate token')}
              </button>
            </div>
            {snippets(status).map(([label, text]) => (
              <div key={label}>
                <div className='integration-buttons'>
                  <strong>{label}</strong>
                  <button disabled={busy} onClick={() => copy(text)}>
                    {t('Copy configuration')}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
        {error && (
          <p className='error-text' role='alert'>
            {error}
          </p>
        )}
        {message && <p role='status'>{message}</p>}
      </SettingsGroup>
    </section>
  );
}
