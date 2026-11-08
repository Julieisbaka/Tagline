import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import SettingRow from './SettingRow.jsx';
import SettingsGroup from './SettingsGroup.jsx';

export default function DictionarySettings() {
  const { t } = useI18n();
  const spellcheck = window.api.spellcheck;
  const [words, setWords] = useState([]);
  const [word, setWord] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setWords([...(await spellcheck.listWords())].sort((a, b) => a.localeCompare(b)));
    } catch (e) {
      setError(e.message);
    }
  }, [spellcheck]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (!spellcheck) {
    return null;
  }
  const change = async (action) => {
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <section className='dictionary-settings'>
      <SettingsGroup title={t('Custom dictionary')}>
        <SettingRow
          label={t('Add word')}
          description={t('Words in your dictionary are not marked as misspelled.')}
        >
          {(inputProps) => (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = word.trim();
                if (value) {
                  change(async () => {
                    await spellcheck.addWord(value);
                    setWord('');
                  });
                }
              }}
            >
              <input
                {...inputProps}
                type='text'
                value={word}
                onChange={(event) => setWord(event.target.value)}
              />{' '}
              <button type='submit' disabled={!word.trim()}>
                {t('Add')}
              </button>
            </form>
          )}
        </SettingRow>
        {error && <p role='alert'>{error}</p>}
        {words.length ? (
          <ul className='dictionary-words'>
            {words.map((entry) => (
              <li key={entry}>
                <span>{entry}</span>{' '}
                <button
                  type='button'
                  aria-label={`${t('Remove')} ${entry}`}
                  onClick={() => change(() => spellcheck.removeWord(entry))}
                >
                  {t('Remove')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t('No custom words yet.')}</p>
        )}
      </SettingsGroup>
    </section>
  );
}
