import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import JsonEditor from './JsonEditor.jsx';
import TabroomTournamentView from './TabroomTournamentView.jsx';

const RAW_PAGE_SIZE = 20000;

export default function TabroomJsonView({ path, content, onOpenHistory }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const token = useRef(null);

  useEffect(() => {
    let active = true;
    token.current = null;
    setSnapshot(null);
    setLoading(true);
    setError('');
    window.api.tabroom.openJson(content).then((result) => {
      if (active) {
        token.current = result.token;
        setSnapshot(result);
      }
    }).catch((failure) => {
      if (active) setError(failure.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [content]);

  const getRecords = useCallback((kind, page, query) => {
    if (!token.current) return Promise.reject(new Error(t('Tournament JSON data is not ready.')));
    return window.api.tabroom.snapshotRecordsForJson(token.current, kind, page, query);
  }, [t]);

  return <div className="tabroom-file-view">
    <header className="tabroom-file-header">
      <h2>{path.split('/').pop()}</h2>
      <button onClick={onOpenHistory}>{t('History')}</button>
    </header>
    {loading ? <p role="status">{t('Loading tournament JSON…')}</p>
      : snapshot ? <TabroomTournamentView tournament={snapshot} busy={false} getRecords={getRecords}
        enableCaselist={false} raw={<RawJson content={content} />} />
        : <section className="tabroom-json-source">
          <p role="alert" className="error-text">{t('Could not open tournament tables: {error}', { error })}</p>
          <JsonEditor value={content} readOnly label={t('JSON source')} />
        </section>}
  </div>;
}

function RawJson({ content }) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(content.length / RAW_PAGE_SIZE));

  useEffect(() => setPage(0), [content]);

  return <>
    <div className="integration-buttons tabroom-pagination">
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>{t('Previous')}</button>
      <span role="status">{t('Page {page} of {pages}', { page: page + 1, pages })}</span>
      <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('Next')}</button>
    </div>
    <pre className="tabroom-json" tabIndex={0} aria-label={t('Tournament JSON')}>
      {content.slice(page * RAW_PAGE_SIZE, (page + 1) * RAW_PAGE_SIZE)}
    </pre>
  </>;
}
