import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from '../dialogs/ModalBackdrop.jsx';
import webhookScript from '../../../electron/google-docs-webhook.gs?raw';

export default function GoogleDocsSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [endpoint, setEndpoint] = useState('');
  const [secret, setSecret] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [createdDocument, setCreatedDocument] = useState(null);

  useEffect(() => {
    let active = true;
    window.api.googleDocs.status().then((value) => {
      if (active) { setStatus(value); setEndpoint(value.endpoint); }
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);

  const run = async (action) => {
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const saveScript = () => run(async () => {
    const result = await window.api.googleDocs.saveScript();
    if (!result.canceled) setMessage(t('Script saved to {path}', { path: result.path }));
  });

  return <section className="google-docs-settings">
    <h4>{t('Google Docs / Drive')}</h4>
    <p>{t('Send a note or a DOCX/HTML file to your own Apps Script webhook to create a new Google Doc. Nothing is uploaded automatically.')}</p>
    <button onClick={() => setShowSetup(true)}>{t('Set up Google Docs transfer')}</button>
    <label className="setting-row"><span>{t('Apps Script web app URL')}</span>
      <input type="url" value={endpoint} spellCheck={false} autoComplete="off" data-setting="googleDocsEndpoint"
        placeholder="https://script.google.com/macros/s/…/exec"
        disabled={busy} onChange={(event) => setEndpoint(event.target.value)} />
    </label>
    <label className="setting-row"><span>{t('Webhook secret')}</span>
      <input type="password" value={secret} spellCheck={false} autoComplete="off" data-setting="googleDocsSecret"
        placeholder={t(status?.configured ? 'Leave blank to keep the saved secret' : '32-256 non-space ASCII characters')}
        disabled={busy} onChange={(event) => setSecret(event.target.value)} />
    </label>
    <p>{t('Use the same WEBHOOK_SECRET in Apps Script. The saved secret is protected with OS encryption, not stored in note settings.')}</p>
    {status && !status.encryptionAvailable && <p className="error-text" role="alert">{t('OS credential encryption is unavailable.')}</p>}
    <div className="integration-buttons">
      <button disabled={busy} onClick={() => run(async () => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        setSecret(Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
        setMessage(t('A new secret is in the password field. Copy it into WEBHOOK_SECRET before saving.'));
      })}>{t('Generate secret')}</button>
      <button disabled={busy || !secret} onClick={() => run(async () => {
        await navigator.clipboard.writeText(secret);
        setMessage(t('Secret copied. Paste it into the WEBHOOK_SECRET script property.'));
      })}>{t('Copy secret')}</button>
      <button disabled={busy || !status?.encryptionAvailable || !endpoint.trim() || (!status?.configured && !secret)}
        onClick={() => run(async () => {
          const next = await window.api.googleDocs.save(endpoint, secret);
          setStatus(next);
          setEndpoint(next.endpoint);
          setSecret('');
          setMessage(t('Google Docs configuration saved.'));
        })}>{t('Save Google Docs connection')}</button>
      <button disabled={busy} onClick={() => run(async () => {
        const next = await window.api.googleDocs.disconnect();
        setStatus(next);
        setEndpoint('');
        setSecret('');
        setCreatedDocument(null);
        setMessage(t('Google Docs connection removed. Existing Drive documents are unchanged.'));
      })}>{t('Disconnect Google Docs')}</button>
      <button disabled={busy || !status?.configured} onClick={() => run(async () => {
        setCreatedDocument(null);
        const result = await window.api.googleDocs.uploadFile();
        if (!result.canceled) setCreatedDocument(result.document);
      })}>{t('Upload DOCX or HTML...')}</button>
    </div>
    <p>{t('For the current note, choose Export > Google Docs. Each upload asks for confirmation. Conversion can change formatting; vault files stay unchanged.')}</p>
    {createdDocument && <div role="status">
      <p>{t('Google Doc created (code 201): {title}', { title: createdDocument.title })}</p>
      <button disabled={busy} onClick={() => run(() => window.api.googleDocs.openDocument(createdDocument.url))}>{t('Open Google Doc')}</button>
    </div>}
    {!showSetup && error && <p className="error-text" role="alert">{error}</p>}
    {!showSetup && message && <p role="status">{message}</p>}
    {showSetup && createPortal(<ModalBackdrop className="modal-backdrop google-docs-backdrop"
      onMouseDown={() => !busy && setShowSetup(false)}>
      <div className="modal dialog google-docs-setup" role="dialog" aria-modal="true"
        aria-labelledby="google-docs-setup-title" onMouseDown={(event) => event.stopPropagation()}>
        <h3 id="google-docs-setup-title">{t('Set up Google Docs transfer')}</h3>
        <ol>
          <li>{t('Save or copy the script below. Open Google Apps Script, create a new project, and replace Code.gs with this script.')}</li>
          <li>{t('In Services, click + and add Drive API (v3). If using a standard Cloud project, also enable Google Drive API in its Cloud console.')}</li>
          <li>{t('In Project Settings > Script properties, add WEBHOOK_SECRET with a random 32-256 character secret. Use Generate secret in Tagline, or your password manager. Copy the same value into Tagline before saving.')}</li>
          <li>{t('Optionally add TARGET_FOLDER_ID with a Drive folder ID (not its URL). Otherwise documents go to My Drive. Folder sharing permissions can be inherited by new documents.')}</li>
          <li>{t('Select authorizeGoogleDocs in the script editor, click Run, and grant your own script Drive access. Only authorize code you have reviewed.')}</li>
          <li>{t('Choose Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Deploy, then copy the /exec URL into Tagline with the same secret and save. If your administrator forbids anonymous web apps, this webhook cannot be used.')}</li>
          <li>{t('Choose Export > Google Docs on a note, or Upload DOCX or HTML here. For script changes, deploy a new version through Manage deployments.')}</li>
        </ol>
        <p>{t('Keep the URL and secret private. Anyone with both can create documents in your Drive and consume your quotas. Rotate WEBHOOK_SECRET to revoke access; disconnecting Tagline only removes local credentials.')}</p>
        <p>{t('The webhook returns JSON with ok, code, message, and document. Code 201 means success; 400/401/405/413/415/422/500/502/503 identify errors. Apps Script uses HTTP 200 for these JSON responses; deployment failures and quota limits may return Google error pages instead.')}</p>
        <label className="google-docs-script">{t('Google Apps Script (.gs)')}
          <textarea readOnly value={webhookScript} spellCheck={false} />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <div className="dialog-buttons">
          <button disabled={busy} onClick={saveScript}>{t('Save script...')}</button>
          <button disabled={busy} onClick={() => run(async () => {
            await navigator.clipboard.writeText(webhookScript);
            setMessage(t('Script copied.'));
          })}>{t('Copy script')}</button>
          <button disabled={busy} onClick={() => run(() => window.api.googleDocs.openSetup())}>{t('Open Google Apps Script')}</button>
          <button className="primary" disabled={busy} onClick={() => setShowSetup(false)}>{t('Close')}</button>
        </div>
      </div>
    </ModalBackdrop>, document.body)}
  </section>;
}
