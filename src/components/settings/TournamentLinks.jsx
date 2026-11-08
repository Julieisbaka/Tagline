import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import SettingsGroup from './SettingsGroup.jsx';

// These are manual browser links, not automated access to provider data.
const providers = [
  {
    name: 'SpeechWire',
    links: [
      ['Tournament calendar', 'https://postings.speechwire.com/p-calendar.php'],
      ['Tournament results', 'https://postings.speechwire.com/r-tournamentlist.php'],
      ['Account login', 'https://www.speechwire.com/c-login.php'],
      ['SpeechWire LIVE! (students and judges)', 'https://live.speechwire.com/'],
    ],
  },
];

export default function TournamentLinks() {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const open = async (url) => {
    setError('');
    try {
      await window.api.websiteAction('external', url);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      {providers.map((provider) => (
        <SettingsGroup title={provider.name} key={provider.name}>
          <div className='settings-integration-entry' data-tournament-provider={provider.name}>
            <div>
              <p>
                {t(
                  'Open the official website in your browser. Sign in there if needed; Tagline does not import or sync this data.'
                )}
              </p>
            </div>
            <div className='integration-buttons'>
              {provider.links.map(([label, url]) => (
                <button key={url} onClick={() => open(url)}>
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
        </SettingsGroup>
      ))}
      {error && <p role='alert'>{error}</p>}
    </>
  );
}
