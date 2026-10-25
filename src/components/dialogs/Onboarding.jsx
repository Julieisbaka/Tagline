import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from './ModalBackdrop.jsx';
import logo from '../../../build/icon.svg';

const STEPS = [
  ['Welcome to Tagline', 'Keep your debate workspace on your computer.',
    'A vault is a folder you choose. Notes, flows, canvases, and revision history stay there; settings and extensions stay in your app profile.'],
  ['Build your workspace', 'Write evidence, follow a round, and connect ideas.',
    'Use notes for cards and speech documents, flows for speech-by-speech arguments, and canvases for visual maps. Files autosave, and History lets you restore earlier versions.'],
  ['Make Tagline yours', 'Your tools, your layout.',
    'Right-click sidebar actions and status items to customize them. Settings contains themes, keyboard shortcuts, integrations, and extensions. Use the command palette to find actions.'],
];

export default function Onboarding({ onFinish }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [title, subtitle, text] = STEPS[step];
  return <ModalBackdrop onMouseDown={onFinish}>
    <div className="modal dialog onboarding-dialog" role="dialog" aria-modal="true"
      aria-labelledby="onboarding-title" aria-describedby="onboarding-description"
      onMouseDown={(event) => event.stopPropagation()}>
      <img src={logo} alt="" width={56} height={56} />
      <p className="onboarding-progress" role="status">{t('Step {step} of {count}', { step: step + 1, count: STEPS.length })}</p>
      <h2 id="onboarding-title">{t(title)}</h2>
      <p><strong>{t(subtitle)}</strong></p>
      <p id="onboarding-description">{t(text)}</p>
      {step === 0 && <p>{t('After this tour, open an existing folder as a vault or create a sample vault to try Tagline. No account is required.')}</p>}
      <div className="dialog-buttons">
        <button className="onboarding-skip" onClick={onFinish}>{t('Skip tour')}</button>
        {step > 0 && <button onClick={() => setStep(step - 1)}>{t('Back')}</button>}
        <button className="primary" onClick={() => step === STEPS.length - 1 ? onFinish() : setStep(step + 1)}>
          {t(step === STEPS.length - 1 ? 'Get started' : 'Next')}
        </button>
      </div>
    </div>
  </ModalBackdrop>;
}
