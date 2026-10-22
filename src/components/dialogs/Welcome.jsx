import logo from '../../../build/icon.svg';
import { useI18n } from '../../lib/i18n.js';

export default function Welcome({ onOpen, onSample, error }) {
  const { t } = useI18n();
  return (
    <div className="welcome">
      <div className="welcome-card">
        <img src={logo} alt="" width={72} height={72} />
        <h1>Tagline</h1>
        <p>{t('A linked-notes workspace for policy debate: cards, blocks, flows and speech docs, stored as plain markdown.')}</p>
        <div className="welcome-actions">
          <button className="primary" onClick={onOpen}>
            {t('Open folder as vault')}
          </button>
          <button onClick={onSample}>{t('Create sample vault')}</button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </div>
    </div>
  );
}
