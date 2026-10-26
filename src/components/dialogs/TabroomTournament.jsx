import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

const views = [
  ['overview', 'Overview'], ['judges', 'Judges'], ['teams', 'Teams'],
  ['schools', 'Schools'], ['events', 'Events'], ['raw', 'Raw JSON'],
];
const columns = {
  judges: [['name', 'Name'], ['code', 'Code'], ['school', 'School'], ['categories', 'Categories'], ['id', 'Judge ID'], ['personId', 'Person ID']],
  teams: [['name', 'Team'], ['code', 'Team code'], ['school', 'School'], ['schoolCode', 'School code'], ['event', 'Event'], ['students', 'Competitor history'], ['caselist', 'OpenCaselist']],
  schools: [['name', 'School'], ['code', 'School code'], ['state', 'State'], ['chapter', 'Chapter ID']],
  events: [['name', 'Event'], ['code', 'Code'], ['type', 'Type']],
};

export default function TabroomTournament({ tournament, busy, raw }) {
  const { t } = useI18n();
  const [view, setView] = useState('overview');
  const [caselist, setCaselist] = useState('');
  return <>
    {tournament.warnings.length > 0 && <p role="status" className="error-text">
      {t('Some snapshot fields could not be read. Use Raw JSON to inspect the original data.')} ({tournament.warnings.join(', ')})
    </p>}
    <nav className="tabroom-views" aria-label={t('Tournament views')}>
      {views.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} disabled={busy}
        onClick={() => setView(id)}>{t(label)}</button>)}
    </nav>
    <div hidden={view !== 'teams'}>
      <CaselistSeason value={caselist} onChange={setCaselist} disabled={busy} />
    </div>
    {view === 'overview' ? <section aria-label={t('Overview')}>
      <dl className="tabroom-metadata">
        {[
          ['Location', tournament.metadata.location], ['Time zone', tournament.metadata.timezone],
          ['Start', tournament.start], ['End', tournament.end], ['Backup created', tournament.metadata.backupCreated],
        ].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value || t('Not provided')}</dd></div>)}
      </dl>
      <div className="tabroom-summary">
        {views.filter(([id]) => Object.hasOwn(tournament.collections, id)).map(([id, label]) => {
          const collection = tournament.collections[id];
          return <button key={id} type="button" disabled={busy} onClick={() => setView(id)}>
            <span>{t(label)}</span>
            <strong>{collection.available ? collection.count : t('Not provided')}</strong>
          </button>;
        })}
      </div>
    </section> : view === 'raw' ? raw : <>
      <TournamentTable key={`${view}:${caselist}`} id={tournament.id} kind={view} disabled={busy} caselist={caselist} />
    </>}
  </>;
}

function CaselistSeason({ value, onChange, disabled }) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const load = async (login = false) => {
    setLoading(true); setError(''); onChange(''); setItems([]); setLoaded(false);
    try {
      if (login) await window.api.openCaselist.login();
      const status = await window.api.openCaselist.status();
      if (!active.current) return;
      setSignedIn(status.signedIn);
      if (!status.signedIn) throw new Error(t('Sign in to OpenCaselist to load supported seasons.'));
      const seasons = await window.api.openCaselist.list('caselists');
      if (active.current) { setItems(seasons); setLoaded(true); }
    } catch (error) {
      if (active.current) setError(error.message);
    } finally { if (active.current) setLoading(false); }
  };
  return <div className="tabroom-caselist">
    <p>{t('Choose an OpenCaselist season and circuit, then look up a team. Codes alone are not verified matches.')}</p>
    <div className="integration-buttons">
      <button disabled={disabled || loading} onClick={() => load()}>{t('Load supported seasons')}</button>
      {!signedIn && <button disabled={disabled || loading} onClick={() => load(true)}>{t('Sign in to OpenCaselist')}</button>}
    </div>
    <label className="tabroom-field tabroom-filter"><span>{t('OpenCaselist season and circuit')}</span>
      <select value={value} disabled={disabled || loading || !items.length} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('Select a season and circuit')}</option>
        {items.map((item) => <option key={item.name} value={item.name}>
          {item.display_name || item.name}{item.archived ? ` (${t('Archived')})` : ''}
        </option>)}
      </select>
    </label>
    {loading && <p role="status">{t('Loading…')}</p>}
    {loaded && !items.length && <p role="status">{t('No supported seasons returned.')}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <p>{t('Tabroom record pages may require a separate browser login. History is linked only when student IDs are available.')}</p>
  </div>;
}

function RecordLink({ url, children, onError }) {
  return <a href={url} target="_blank" rel="noreferrer" onClick={(event) => {
    event.preventDefault();
    window.api.websiteAction('external', url).catch((error) => onError(error.message));
  }}>{children}</a>;
}

function TeamMatch({ row, caselist, disabled, onError }) {
  const { t } = useI18n();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const lookup = async () => {
    setLoading(true); setResult(null); onError('');
    try {
      const match = await window.api.openCaselist.resolveTabroomTeam(caselist, row);
      if (active.current) setResult(match);
    } catch (error) { if (active.current) onError(error.message); }
    finally { if (active.current) setLoading(false); }
  };
  const labels = {
    matched: 'Verified match', candidate: 'Possible match — verify identity',
    ambiguous: 'Multiple possible matches — verify identity', unmatched: 'No matching team found',
    'insufficient-data': 'Not enough data to match this team',
  };
  return <>
    <button disabled={disabled || loading || !caselist} onClick={lookup}>
      {t(loading ? 'Loading…' : 'Find on OpenCaselist')}
    </button>
    {result && <div className="tabroom-match" role="status">
      <p>{t(labels[result.status])}</p>
      {result.candidates.map((candidate) => <div key={candidate.url}>
        {candidate.evidence === 'generated-code' && <p>{t('Lower confidence: school and generated name code only. Verify the team before using this link.')}</p>}
        <RecordLink url={candidate.url} onError={onError}>
          {candidate.selection.school} / {candidate.selection.team}
        </RecordLink>
      </div>)}
    </div>}
  </>;
}

function TournamentTable({ id, kind, disabled, caselist }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setResult(null);
    window.api.tabroom.records(id, kind, page, query).then((data) => {
      if (active) setResult(data);
    }).catch((error) => {
      if (active) setError(error.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, kind, page, query]);
  return <section aria-label={t(views.find(([id]) => id === kind)[1])} aria-busy={loading}>
    <label className="tabroom-field tabroom-filter"><span>{t('Filter tournament records')}</span>
      <input type="search" maxLength={200} value={query} disabled={disabled}
        onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
    </label>
    {loading && <p role="status">{t('Loading…')}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {result && (!result.available ? <p>{t('Not provided in this snapshot. Data may be private or unavailable.')}</p>
      : !result.total ? <p role="status">{t(query ? 'No matching records.' : 'No records in the provided data.')}</p>
        : <>
          <p role="status">{t('{count} records', { count: result.total })}</p>
          <div className="tabroom-table-scroll" tabIndex={0} role="region" aria-label={t('Tournament records')}>
            <table className="tabroom-table">
              <thead><tr>{columns[kind].map(([key, label]) => <th key={key} scope="col">{t(label)}</th>)}</tr></thead>
              <tbody>{result.rows.map((row, index) => <tr key={row.id || index}>
                {columns[kind].map(([key]) => <td key={key}>{
                  key === 'caselist' ? <TeamMatch row={row} caselist={caselist} disabled={disabled} onError={setError} />
                    : key === 'students' ? row.students.length ? row.students.map((student, index) => <div key={index}>
                      {student.recordUrl ? <RecordLink url={student.recordUrl} onError={setError}>
                        {[student.first, student.last].filter(Boolean).join(' ') || t('Student {id}', { id: student.id })}
                      </RecordLink> : [student.first, student.last].filter(Boolean).join(' ') || t('Not provided')}
                    </div>) : t('Not provided')
                      : key === 'name' && kind === 'teams' && row.recordUrl
                        ? <RecordLink url={row.recordUrl} onError={setError}>{row.name || row.code || t('Tournament record')}</RecordLink>
                        : (Array.isArray(row[key]) ? row[key].join(', ') : row[key]) || t('Not provided')
                }</td>)}
              </tr>)}</tbody>
            </table>
          </div>
          <div className="integration-buttons tabroom-pagination">
            <button disabled={disabled || loading || page === 0} onClick={() => setPage(page - 1)}>{t('Previous')}</button>
            <span role="status">{t('Page {page} of {pages}', { page: page + 1, pages: result.pages })}</span>
            <button disabled={disabled || loading || page + 1 >= result.pages} onClick={() => setPage(page + 1)}>{t('Next')}</button>
          </div>
        </>)}
  </section>;
}
