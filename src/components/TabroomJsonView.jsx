import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import JsonEditor from './JsonEditor.jsx';
import TabroomTournamentView from './TabroomTournamentView.jsx';

export default function TabroomJsonView({ path, content, settings }) {
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
    window.api.tabroom
      .openJson(content)
      .then((result) => {
        if (active) {
          token.current = result.token;
          setSnapshot(result);
        }
      })
      .catch((failure) => {
        if (active) {
          setError(failure.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [content]);

  const getRecords = useCallback(
    (kind, page, query) => {
      if (!token.current) {
        return Promise.reject(new Error(t('Tournament JSON data is not ready.')));
      }
      return window.api.tabroom.snapshotRecordsForJson(token.current, kind, page, query);
    },
    [t]
  );

  return (
    <div className='tabroom-file-view'>
      <header className='tabroom-file-header'>
        <h2>{path.split('/').pop()}</h2>
      </header>
      {loading ? (
        <p role='status'>{t('Loading tournament JSON…')}</p>
      ) : snapshot ? (
        <TabroomTournamentView
          tournament={snapshot}
          busy={false}
          getRecords={getRecords}
          enableCaselist={false}
          raw={
            <section className='tabroom-json-source'>
              <JsonEditor
                value={content}
                settings={settings}
                readOnly
                editable={false}
                label={t('Tournament JSON')}
                height='100%'
              />
            </section>
          }
        />
      ) : (
        <section className='tabroom-json-source'>
          <p role='alert' className='error-text'>
            {t('Could not open tournament tables: {error}', { error })}
          </p>
          <JsonEditor
            value={content}
            settings={settings}
            readOnly
            editable={false}
            label={t('JSON source')}
            height='100%'
          />
        </section>
      )}
    </div>
  );
}
