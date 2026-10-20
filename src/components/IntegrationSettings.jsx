import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.js';

export default function IntegrationSettings() {
  const { t } = useI18n();
  const [pandoc, setPandoc] = useState(null);
  const [embedding, setEmbedding] = useState(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    Promise.all([window.api.pandocStatus(), window.api.embeddingStatus()])
      .then(([p, e]) => { if (!disposed) { setPandoc(p); setEmbedding(e); } })
      .catch((e) => { if (!disposed) setError(e.message); });
    const interval = setInterval(() => {
      window.api.embeddingStatus().then((e) => { if (!disposed) setEmbedding(e); })
        .catch((e) => { if (!disposed) setError(e.message); });
    }, 1000);
    return () => { disposed = true; clearInterval(interval); };
  }, []);

  const run = async (action) => {
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="integration-settings">
      <h4>{t('Document import / export')}</h4>
      <p>{pandoc ? pandoc.available ? `${pandoc.version} (${pandoc.executable})`
        : t('Pandoc was not found. Install it or choose its executable in Settings.') : t('Checking Pandoc...')}</p>
      <div className="integration-buttons">
        <button disabled={busy} onClick={() => run(async () => {
          const info = await window.api.choosePandoc();
          if (info) setPandoc(info);
        })}>{t('Locate Pandoc')}</button>
        <button disabled={busy} onClick={() => run(async () => setPandoc(await window.api.pandocStatus()))}>{t('Check again')}</button>
      </div>
      <h4>{t('Semantic search (local embeddings)')}</h4>
      <label className="setting-row">
        <span>{t('Automatically load downloaded model at startup')}</span>
        <input type="checkbox" checked={embedding?.autoload ?? true} disabled={!embedding || busy || embedding.busy}
          onChange={(e) => {
            const enabled = e.target.checked;
            run(async () => {
              await window.api.setModelAutoload(enabled);
              setEmbedding(await window.api.embeddingStatus());
            });
          }} />
      </label>
      <p>{t('Downloads Xenova/all-MiniLM-L6-v2 from Hugging Face (about 23 MB). Model files are cached; note contents and search queries stay on this computer. No API key is required for this public model.')}</p>
      <label className="setting-row">
        <span>{t('Hugging Face token (optional)')}</span>
        <input type="password" autoComplete="off" spellCheck={false} value={token}
          placeholder={t(embedding?.tokenConfigured ? 'Token saved securely' : 'hf_... (optional)')}
          onChange={(e) => setToken(e.target.value)} />
      </label>
      <div className="integration-buttons">
        <button disabled={busy || !token.trim() || !embedding?.encryptionAvailable}
          onClick={() => run(async () => {
            await window.api.saveHfToken(token);
            setToken('');
            setEmbedding(await window.api.embeddingStatus());
            setMessage(t('Token saved with OS encryption.'));
          })}>{t('Save token')}</button>
        <button disabled={busy || !embedding?.tokenConfigured}
          onClick={() => run(async () => {
            await window.api.saveHfToken('');
            setToken('');
            setEmbedding(await window.api.embeddingStatus());
            setMessage(t('Token removed. Future downloads will use keyless access.'));
          })}>{t('Remove token')}</button>
        {embedding && !embedding.ready && (
          <button disabled={busy || embedding.busy} onClick={() => run(async () => {
            await window.api.downloadEmbeddingModel();
            setEmbedding(await window.api.embeddingStatus());
            setMessage(t('Model ready for local semantic search.'));
          })}>{t(embedding.downloaded ? 'Load model' : 'Download model')}</button>
        )}
      </div>
      <p role="status">{embedding && t(embedding.detail)}</p>
      {embedding?.error && <p className="error-text" role="alert">{embedding.error}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
