import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import SettingRow from './SettingRow.jsx';

/**
 * Render one settings control from a declarative definition (curated registry
 * entry or an inferred definition from a default value).
 * @param {object} props - Component props.
 * @param {object} props.def - Setting definition from SETTING_META or settingDefinition().
 * @param {object} props.settings - Current settings object.
 * @param {function} props.update - Settings updater.
 * @returns {JSX.Element} The rendered setting row and any attached notes.
 */
export default function AutoSetting({ def, settings, update }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = def.key;
  const value = settings[key];
  const label = t(def.label ?? key);
  const notes = def.notes ?? [];
  let control;
  if (def.type === 'checkbox' || def.type === 'lowResourceMode') {
    const checked = def.invert ? !value : !!value;
    control = (
      <input
        type='checkbox'
        data-setting={key}
        checked={checked}
        disabled={def.type === 'lowResourceMode' && busy}
        onChange={(event) => {
          const enabled = def.invert ? !event.target.checked : event.target.checked;
          if (def.type !== 'lowResourceMode') {
            update({ [key]: enabled });
            return;
          }
          setError('');
          setBusy(true);
          window.api
            .setLowResourceMode(enabled)
            .then(() => update({ lowResourceMode: enabled }))
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      />
    );
  } else if (def.type === 'number') {
    control = (
      <input
        type='number'
        min={def.min}
        max={def.max}
        step='1'
        value={value ?? ''}
        data-setting={key}
        onChange={(event) => {
          if (event.target.validity.valid && event.target.value !== '') {
            update({ [key]: Number(event.target.value) });
          }
        }}
      />
    );
  } else if (def.type === 'select') {
    control = (
      <select
        data-setting={key}
        value={value}
        onChange={(event) => update({ [key]: event.target.value })}
      >
        {def.options.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.label)}
          </option>
        ))}
      </select>
    );
  } else if (def.type === 'json') {
    control = (
      <textarea
        data-setting={key}
        value={
          typeof value === 'string' ? value : JSON.stringify(value ?? def.defaultValue ?? null, null, 2)
        }
        onChange={(event) => {
          try {
            update({ [key]: JSON.parse(event.target.value) });
          } catch {
            // Ignore invalid JSON while typing.
          }
        }}
      />
    );
  } else {
    // text and fontFamily
    control = (
      <input
        value={value ?? ''}
        placeholder={def.placeholder}
        data-setting={key}
        onChange={(event) =>
          def.type === 'fontFamily'
            ? update({ fontFamily: event.target.value, importedFont: false })
            : update({ [key]: event.target.value })
        }
      />
    );
  }
  const row = def.description ? (
    <SettingRow label={label} description={t(def.description)}>
      {control}
    </SettingRow>
  ) : (
    <label className='setting-row'>
      <span>{label}</span>
      {control}
    </label>
  );
  return (
    <>
      {row}
      {def.type === 'lowResourceMode' && value && <p>{t(def.activeNote)}</p>}
      {notes.map((note) => (
        <p key={note}>{t(note)}</p>
      ))}
      {error && (
        <p role='alert' className='error-text'>
          {error}
        </p>
      )}
    </>
  );
}
