import { useEffect, useState } from 'react';
import { DEFAULT_LIMITS, LIMIT_DEFINITIONS, setRuntimeLimits, validateLimits } from '../../electron/customization.mjs';
import { validateTheme } from '../lib/themes.js';
import { useI18n } from '../lib/i18n.js';

export default function CustomizationLimits({ settings }) {
  const { t } = useI18n();
  const [values, setValues] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    window.api.getCustomizationLimits().then((limits) => { if (!disposed) setValues(limits); })
      .catch((err) => { if (!disposed) setError(err.message); });
    return () => { disposed = true; };
  }, []);
  const save = async (reset = false) => {
    setError(''); setBusy(true);
    try {
      const next = validateLimits(reset ? DEFAULT_LIMITS : Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, value === '' ? NaN : Number(value)]),
      ));
      if (settings.customTheme) {
        validateTheme(settings.customTheme, next);
        if (new TextEncoder().encode(JSON.stringify(settings.customTheme)).length > next.themeFileBytes) {
          throw new Error(t('The saved custom theme exceeds the new file size limit.'));
        }
      }
      const saved = await window.api.setCustomizationLimits(next);
      setRuntimeLimits(saved);
      setValues(saved);
      window.dispatchEvent(new Event('customizationlimits'));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="customization-limits">
    <h4>{t('Theme and extension limits')}</h4>
    <p>{t('Limits apply across theme import, extension loading, and sandbox execution. Applying them reloads extensions. Fixed safety ceilings and permission checks cannot be disabled.')}</p>
    {values && Object.entries(LIMIT_DEFINITIONS).map(([key, definition]) => <label className="setting-row" key={key}>
      <span>{t(definition.label)} <small>{definition.min}–{definition.max}</small></span>
      <input aria-label={t(definition.label)} data-limit={key} type="number" step="1"
        min={definition.min} max={definition.max} value={values[key]}
        onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
    </label>)}
    <div className="settings-actions">
      <button disabled={!values || busy} onClick={() => save()}>{t('Apply customization limits')}</button>
      <button disabled={!values || busy} onClick={() => save(true)}>{t('Reset customization limits')}</button>
    </div>
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>;
}
