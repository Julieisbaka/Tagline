import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from './ModalBackdrop.jsx';

const api = window.api.openCaselist;
const nameOf = (item) => item.display_name || item.displayName || item.name || item.slug;
const blankRound = { tournament: '', side: 'A', round: '', opponent: '', judge: '', report: '' };

export default function OpenCaselistDialog({ hasVault, onDownload, onClose }) {
  const { t, locale } = useI18n();
  const [session, setSession] = useState(null);
  const [caselists, setCaselists] = useState([]);
  const [schools, setSchools] = useState([]);
  const [teams, setTeams] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [cites, setCites] = useState([]);
  const [selection, setSelection] = useState({ caselist: '', school: '', team: '' });
  const [results, setResults] = useState(null);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [downloaded, setDownloaded] = useState('');
  const active = useRef(true);
  const run = async (action) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (error) {
      if (active.current) {
        setError(error.message);
        try { setSession(await api.status()); }
        catch (statusError) { setError(`${error.message} ${statusError.message}`); }
      }
    } finally { if (active.current) setBusy(false); }
  };
  useEffect(() => {
    active.current = true;
    run(async () => {
      const status = await api.status();
      if (!active.current) return;
      setSession(status);
      if (status.signedIn) {
        const items = await api.list('caselists');
        if (active.current) setCaselists(items);
      }
    });
    return () => { active.current = false; };
  }, []);
  const refreshTeam = async (current = selection) => {
    const [rounds, cites] = await Promise.all([api.list('rounds', current), api.list('cites', current)]);
    if (active.current) { setRounds(rounds); setCites(cites); }
  };
  const select = (kind, value) => run(async () => {
    const current = { ...selection, [kind]: value };
    setRounds([]); setCites([]); setResults(null);
    if (kind === 'caselist') { current.school = ''; current.team = ''; setSchools([]); setTeams([]); }
    if (kind === 'school') { current.team = ''; setTeams([]); }
    setSelection(current);
    if (!value) return;
    if (kind === 'caselist') setSchools(await api.list('schools', current));
    if (kind === 'school') setTeams(await api.list('teams', current));
    if (kind === 'team') await refreshTeam(current);
  });
  const selectedCase = caselists.find((item) => item.slug === selection.caselist);
  const canWrite = selection.team && !selectedCase?.archived;
  const download = (path) => run(async () => {
    const result = await api.download(path);
    if (result.cancelled) return;
    await onDownload();
    setDownloaded(result.path);
    setMessage(t('Saved disclosure: {path}', { path: result.path }));
  });
  const save = () => run(async () => {
    let result;
    if (form.kind === 'cite') result = await api.write('create-cite', selection, form.data);
    else if (form.kind === 'upload') result = await api.upload(selection, form.data);
    else result = await api.write(form.id ? 'update-round' : 'create-round', { ...selection, round: form.id }, form.data);
    if (result.cancelled) return;
    setForm(null);
    setMessage(t('Change published to OpenCaselist.'));
    await refreshTeam();
  });
  const remove = (kind, itemId) => run(async () => {
    const result = await api.write(`delete-${kind}`, { ...selection, [kind]: itemId });
    if (result.cancelled) return;
    setMessage(t('Change published to OpenCaselist.'));
    await refreshTeam();
  });
  const close = () => { if (!busy) onClose(); };
  const field = (key, label, multiline = false) => <label className="opencaselist-field" key={key}>
    <span>{t(label)}</span>
    {multiline ? <textarea value={form.data[key] || ''} maxLength={100000} rows={6} required={key === 'cites'}
      onChange={(event) => setForm({ ...form, data: { ...form.data, [key]: event.target.value } })} />
      : <input value={form.data[key] || ''} maxLength={255} required={['tournament', 'round', 'title'].includes(key)}
        onChange={(event) => setForm({ ...form, data: { ...form.data, [key]: event.target.value } })} />}
  </label>;
  return <ModalBackdrop onMouseDown={close}>
    <div className="modal dialog opencaselist-dialog" role="dialog" aria-modal="true" aria-labelledby="opencaselist-title"
      onMouseDown={(event) => event.stopPropagation()}>
      <header className="opencaselist-actions"><h3 id="opencaselist-title">OpenCaselist</h3>
        <button disabled={busy} onClick={close}>{t('Close')}</button></header>
      <p>{t('Sign in on the official website. Your password and session cookies are never exposed to extensions.')}</p>
      <div className="opencaselist-actions">
        <span role="status">{session ? t(session.signedIn ? 'Signed in' : 'Not signed in') : t('Loading…')}</span>
        {session?.signedIn && session.expiresAt && <span>{t('Session expires: {date}', {
          date: new Date(session.expiresAt).toLocaleString(locale),
        })}</span>}
        <button disabled={busy} onClick={() => run(async () => {
          const status = await api.login();
          setSession(status);
          if (status.signedIn) setCaselists(await api.list('caselists'));
          else setMessage(t('Sign-in cancelled.'));
        })}>{t(session?.signedIn ? 'Sign in again' : 'Sign in')}</button>
        {session?.signedIn && <button disabled={busy || !!form} onClick={() => run(async () => {
          setSession(await api.logout()); setCaselists([]); setSchools([]); setTeams([]);
          setRounds([]); setCites([]); setResults(null);
          setSelection({ caselist: '', school: '', team: '' });
        })}>{t('Sign out')}</button>}
      </div>
      {!hasVault && <p>{t('Open a vault to save downloaded files. Browsing and publishing are still available.')}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {downloaded && <button disabled={busy} onClick={() => run(() => window.api.reveal(downloaded))}>
        {t('Show downloaded file')}</button>}
      {busy && <p role="status">{t('Working…')}</p>}
      {session?.signedIn && <>
        <fieldset disabled={busy || !!form} className="opencaselist-selectors">
          <legend>{t('Browse disclosures')}</legend>
          {[
            ['caselist', 'Caselist', caselists, (item) => item.slug],
            ['school', 'School', schools, (item) => item.name],
            ['team', 'Team', teams, (item) => item.name],
          ].map(([key, label, items, valueOf]) => <label key={key} className="opencaselist-field">
            <span>{t(label)}</span>
            <select data-caselist-select={key} value={selection[key]} onChange={(event) => select(key, event.target.value)}>
              <option value="">{t('Select…')}</option>
              {items.map((item) => <option key={valueOf(item)} value={valueOf(item)}>
                {nameOf(item)}{item.archived ? ` (${t('Archived')})` : ''}
              </option>)}
            </select>
          </label>)}
        </fieldset>
        {selectedCase?.archived && <p>{t('Archived caselists are read-only.')}</p>}
        <form className="opencaselist-actions" onSubmit={(event) => {
          event.preventDefault();
          run(async () => setResults(await api.search(selection.caselist, query)));
        }}>
          <label className="opencaselist-field"><span>{t('Search disclosures')}</span>
            <input required maxLength={500} value={query} onChange={(event) => setQuery(event.target.value)}
              disabled={busy || !selection.caselist || !!form} /></label>
          <button disabled={busy || !selection.caselist || !!form}>{t('Search')}</button>
          {results && <button type="button" disabled={busy || !!form} onClick={() => setResults(null)}>{t('Clear search')}</button>}
        </form>
        {results && <section aria-label={t('Search results')}>
          <h4>{t('Search results')} ({results.length})</h4>
          {!results.length && <p>{t('No results found.')}</p>}
          {results.map((item, index) => <article className="opencaselist-card" key={`${item.id || item.path}:${index}`}>
            <strong>{item.title || item.team_display_name || item.path}</strong>
            <p>{item.path}</p>
            <p>{(item.snippet || item.content || '').replace(/<[^>]*>/g, '')}</p>
            {item.download_path && <button disabled={busy || !hasVault} onClick={() => download(item.download_path)}>
              {t('Download to vault')}</button>}
            {item.path && <button disabled={busy || !!form} onClick={() => run(async () => {
              const parts = item.path.replace(/^\/+|\/+$/g, '').split('/');
              if (parts.length < 3 || parts[0] !== selection.caselist) throw new Error(t('Select a team using the browse controls.'));
              const current = { caselist: parts[0], school: parts[1], team: parts[2] };
              setSelection(current);
              setTeams(await api.list('teams', current));
              await refreshTeam(current);
              setResults(null);
            })}>{t('Browse team')}</button>}
          </article>)}
        </section>}
        {selection.team && !results && <>
          <div className="opencaselist-actions">
            <h4>{t('Rounds and disclosures')}</h4>
            <button disabled={busy || !!form} onClick={() => run(() => refreshTeam())}>{t('Refresh')}</button>
            <button disabled={busy || !canWrite || !!form} onClick={() => setForm({ kind: 'round', data: { ...blankRound } })}>
              {t('Add round')}</button>
            <button disabled={busy || !canWrite || !!form} onClick={() => setForm({ kind: 'upload', data: { ...blankRound } })}>
              {t('Upload disclosure')}</button>
          </div>
          {form && <form className="opencaselist-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
            <h4>{t(form.kind === 'cite' ? 'Add citations' : form.kind === 'upload' ? 'Upload disclosure' : form.id ? 'Edit round' : 'Add round')}</h4>
            <fieldset disabled={busy}>
              {form.kind === 'cite' ? <>
                {field('title', 'Title')}
                {field('cites', 'Citations', true)}
              </> : <>
                {field('tournament', 'Tournament')}
                <label className="opencaselist-field"><span>{t('Side')}</span>
                  <select value={form.data.side} onChange={(event) => setForm({ ...form, data: { ...form.data, side: event.target.value } })}>
                    <option value="A">{t('Affirmative')}</option><option value="N">{t('Negative')}</option>
                    {!['A', 'N'].includes(form.data.side) && <option value={form.data.side}>{form.data.side}</option>}
                  </select></label>
                {field('round', 'Round')}
                {field('opponent', 'Opponent')}
                {field('judge', 'Judge')}
                {field('report', 'Report', true)}
                {form.kind === 'upload' && <p>{t('Choose a DOCX file up to 50 MB. The file is published only after confirmation.')}</p>}
                {form.kind === 'round' && <p>{t('Editing round details leaves existing disclosure files unchanged.')}</p>}
              </>}
              <div className="opencaselist-actions">
                <button type="button" onClick={() => setForm(null)}>{t('Cancel')}</button>
                <button className="primary">{t(form.kind === 'upload' ? 'Choose file and publish…' : 'Review and publish…')}</button>
              </div>
            </fieldset>
          </form>}
          {!rounds.length && <p>{t('No rounds yet.')}</p>}
          {rounds.map((round) => <article className="opencaselist-card" key={round.round_id}>
            <h4>{round.tournament} — {round.round} — {round.side}</h4>
            <p>{round.opponent}{round.judge ? ` / ${round.judge}` : ''}</p>
            {round.report && <p className="opencaselist-report">{round.report}</p>}
            <div className="opencaselist-actions">
              {round.opensource && <button disabled={busy || !hasVault} onClick={() => download(round.opensource)}>{t('Download to vault')}</button>}
              <button disabled={busy || !canWrite || !!form} onClick={() => setForm({
                kind: 'round', id: round.round_id,
                data: { ...blankRound, ...round }
              })}>{t('Edit round')}</button>
              <button disabled={busy || !canWrite || !!form} onClick={() => setForm({
                kind: 'cite',
                data: { round_id: round.round_id, title: '', cites: '' }
              })}>{t('Add citations')}</button>
              <button disabled={busy || !canWrite || !!form} onClick={() => remove('round', round.round_id)}>{t('Delete round')}</button>
            </div>
            {cites.filter((cite) => cite.round_id === round.round_id).map((cite) => <div key={cite.cite_id}>
              <strong>{cite.title}</strong><p className="opencaselist-report">{cite.cites}</p>
              <button disabled={busy || !canWrite || !!form} onClick={() => remove('cite', cite.cite_id)}>{t('Delete citations')}</button>
            </div>)}
          </article>)}
        </>}
      </>}
    </div>
  </ModalBackdrop>;
}
