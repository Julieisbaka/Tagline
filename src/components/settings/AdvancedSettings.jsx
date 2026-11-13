import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import AutoSetting from './AutoSetting.jsx';
import { SETTING_GROUPS } from './settingsSchema.js';
import SettingsGroup from './SettingsGroup.jsx';

export default function AdvancedSettings({ settings, update, section = 'all' }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const fontActions = (
    <>
      <div className='integration-buttons'>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const font = await window.api.importFont();
              if (!font) {
                return;
              }
              const face = new FontFace('Tagline Font Validation', `url("${font.data}")`);
              await face.load();
              await window.api.activateFont();
              update({ importedFont: Date.now() });
            })
          }
        >
          {t('Import font file')}
        </button>
        <button onClick={() => update({ fontFamily: '', importedFont: false })}>
          {t('Reset font')}
        </button>
      </div>
    </>
  );
  return (
    <section className='advanced-settings'>
      {SETTING_GROUPS.filter((group) => section === 'all' || group.section === section).map(
        (group) => (
          <SettingsGroup
            key={group.title}
            title={t(group.title)}
            collapsible={group.collapsibleWhenAll ? section === 'all' : true}
          >
            {group.items
              .filter((def) => !def.devOnly || import.meta.env.DEV)
              .map((def) => (
                <AutoSetting key={def.key} def={def} settings={settings} update={update} />
              ))}
            {group.actions === 'fonts' && fontActions}
            {group.notes?.map((note) => (
              <p key={note}>{t(note)}</p>
            ))}
          </SettingsGroup>
        )
      )}
      {error && (
        <p role='alert' className='error-text'>
          {error}
        </p>
      )}
    </section>
  );
}
