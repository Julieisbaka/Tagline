import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from './ModalBackdrop.jsx';

const api = window.api.tabroom;

export default function TabroomDialog({ onClose }) {
  const { t } = useI18n();
  const [session, setSession] = useState(null);
  const [input, setInput] = useState('');
  const [tournament, setTournament] = useState(null);
  const [preview, setPreview] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const run = async (action) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (error) { if (active.current) setError(error.message); }
    finally { if (active.current) setBusy(false); }
  };
  useEffect(() => {
    active.current = true;
    run(async () => {
      const status = await api.status();
      if (active.current) setSession(status);
    });
    return () => { active.current = false; };
  }, []);
  const clear = () => { setTournament(null); setPreview(''); setPage(0); };
  const close = () => { if (!busy) onClose(); };
  const changePage = (index) => run(async () => {
    const text = await api.page(tournament.id, index);
    if (active.current) { setPreview(text); setPage(index); }
  });
  return <ModalBackdrop onMouseDown={close}>
    <div className="modal dialog tabroom-dialog" role="dialog" aria-modal="true" aria-labelledby="tabroom-title"
      onMouseDown={(event) => event.stopPropagation()}>
      <header className="integration-buttons">
        <h3 id="tabroom-title">Tabroom</h3>
        <button disabled={busy} onClick={close}>{t('Close')}</button>
      </header>
      <p>{t('Load public tournament data without signing in. Sign in on Tabroom for additional data your account is allowed to access.')}</p>
      <p>{t('Your password and cookies stay in the isolated Tabroom browser session. Close the sign-in window when finished. A saved session does not confirm login or tournament permissions.')}</p>
      <div className="integration-buttons">
        <span role="status">{session ? t(session.hasSession ? 'Tabroom browser session saved' : 'No Tabroom browser session saved') : t('Loading…')}</span>
        <button disabled={busy} onClick={() => run(async () => {
          clear();
          const status = await api.login();
          if (active.current) setSession(status);
        })}>{t('Sign in on Tabroom')}</button>
        <button disabled={busy || !session?.hasSession} onClick={() => run(async () => {
          clear();
          const status = await api.logout();
          if (active.current) setSession(status);
        })}>{t('Clear Tabroom session')}</button>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          clear();
          const result = await api.load(input);
          if (active.current) { setTournament(result); setPreview(result.preview); }
        });
      }}>
        <label className="tabroom-field"><span>{t('Tournament ID or Tabroom URL')}</span>
          <input required maxLength={2048} value={input} disabled={busy} autoComplete="off" spellCheck={false}
            placeholder="https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=12345"
            onChange={(event) => setInput(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || !input.trim()}>{t('Load tournament')}</button>
      </form>
      {busy && <p role="status">{t('Working…')}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {tournament && <section aria-label={t('Tournament data')}>
        <h4>{tournament.name || t('Tournament {id}', { id: tournament.id })}</h4>
        {(tournament.start || tournament.end) && <p>{tournament.start} - {tournament.end}</p>}
        <p>{t('Only data returned by Tabroom is shown. Missing information may be private or unavailable.')}</p>
        <ul>{tournament.sections.map(({ name, count }) => <li key={name}>{name}: {count}</li>)}</ul>
        <button disabled={busy} onClick={() => run(async () => {
          const result = await api.download(tournament.id);
          if (!result.cancelled && active.current) setMessage(t('Saved tournament JSON: {path}', { path: result.path }));
        })}>{t('Save tournament JSON')}</button>
        <p>{t('Backups can contain personal or private tournament data. Store and share them carefully.')}</p>
        <div className="integration-buttons">
          <button disabled={busy || page === 0} onClick={() => changePage(page - 1)}>{t('Previous')}</button>
          <span role="status">{t('Page {page} of {pages}', { page: page + 1, pages: tournament.pages })}</span>
          <button disabled={busy || page + 1 >= tournament.pages} onClick={() => changePage(page + 1)}>{t('Next')}</button>
        </div>
        <pre className="tabroom-json" tabIndex={0} aria-label={t('Tournament JSON')}>{preview}</pre>
      </section>}
    </div>
  </ModalBackdrop>;
}
