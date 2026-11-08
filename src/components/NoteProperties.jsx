import { useEffect, useMemo, useState } from 'react';
import { parseDocument, stringify } from 'yaml';
import {
  deleteFrontmatterProperty,
  readFrontmatter,
  setFrontmatterProperty,
} from '../lib/frontmatter.js';
import { useI18n } from '../lib/i18n.js';

function YamlValue({ property, value, onSave, t }) {
  const initial = useMemo(() => stringify(value), [value]);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(initial);
    setError('');
  }, [initial]);

  const save = () => {
    const document = parseDocument(draft);
    const problem = document.errors[0] || document.warnings[0];
    if (problem) {
      setError(problem.message);
      return;
    }
    try {
      onSave(document.toJS({ maxAliasCount: 50 }));
      setError('');
    } catch (failure) {
      setError(failure.message);
    }
  };

  return (
    <div className='note-property-complex'>
      <textarea
        aria-label={t('YAML value for {property}', { property })}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={Math.min(6, Math.max(2, draft.split('\n').length))}
      />
      <button type='button' onClick={save}>
        {t('Apply')}
      </button>
      {error && (
        <span className='error-text' role='alert'>
          {error}
        </span>
      )}
    </div>
  );
}

function StringList({ property, value, onSave, t }) {
  const [draft, setDraft] = useState(value.join('\n'));
  useEffect(() => setDraft(value.join('\n')), [value]);
  return (
    <div className='note-property-complex'>
      <textarea
        aria-label={t('Values for {property}', { property })}
        placeholder={t('One value per line')}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={Math.min(6, Math.max(2, draft.split('\n').length))}
      />
      <button
        type='button'
        onClick={() =>
          onSave(
            draft
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean)
          )
        }
      >
        {t('Apply')}
      </button>
    </div>
  );
}

function PropertyValue({ property, value, onSave, t }) {
  if (typeof value === 'string' || value === null) {
    return (
      <input
        aria-label={t('Value for {property}', { property })}
        value={value ?? ''}
        onChange={(event) => onSave(event.target.value)}
      />
    );
  }
  if (typeof value === 'boolean') {
    return (
      <label className='note-property-boolean'>
        <input
          type='checkbox'
          aria-label={t('Value for {property}', { property })}
          checked={value}
          onChange={(event) => onSave(event.target.checked)}
        />
        {t(value ? 'True' : 'False')}
      </label>
    );
  }
  if (typeof value === 'number') {
    return <NumberValue property={property} value={value} onSave={onSave} t={t} />;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return <StringList property={property} value={value} onSave={onSave} t={t} />;
  }
  return <YamlValue property={property} value={value} onSave={onSave} t={t} />;
}

function NumberValue({ property, value, onSave, t }) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(String(value));
    setError('');
  }, [value]);

  return (
    <label className='note-property-number'>
      <input
        type='number'
        aria-label={t('Value for {property}', { property })}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type='button'
        onClick={() => {
          if (!draft.trim() || !Number.isFinite(Number(draft))) {
            setError(t('Enter a valid number'));
            return;
          }
          setError('');
          onSave(Number(draft));
        }}
      >
        {t('Apply')}
      </button>
      {error && (
        <span className='error-text' role='alert'>
          {error}
        </span>
      )}
    </label>
  );
}

export default function NoteProperties({ content, onChange, editable, notify, onEditSource }) {
  const { t } = useI18n();
  const metadata = useMemo(() => readFrontmatter(content), [content]);
  const [newKey, setNewKey] = useState('');
  const properties = Object.entries(metadata.data);

  const save = (key, value) => {
    try {
      onChange(setFrontmatterProperty(content, key, value));
    } catch (error) {
      notify(t('Could not update property: {error}', { error: error.message }));
    }
  };
  const remove = (key) => {
    try {
      onChange(deleteFrontmatterProperty(content, key));
    } catch (error) {
      notify(t('Could not update property: {error}', { error: error.message }));
    }
  };
  const add = (event) => {
    event.preventDefault();
    const key = newKey.trim();
    if (!key || Object.hasOwn(metadata.data, key)) {
      return;
    }
    save(key, '');
    setNewKey('');
  };

  return (
    <details className='note-properties' open={editable || undefined}>
      <summary>{t('Properties')}</summary>
      {!editable ? (
        <>
          <pre>{metadata.raw}</pre>
          <button type='button' onClick={onEditSource}>
            {t('Edit properties in Source')}
          </button>
        </>
      ) : metadata.error ? (
        <p className='error-text' role='alert'>
          {t('Invalid YAML frontmatter: {error}', { error: metadata.error })}
        </p>
      ) : (
        <div className='note-properties-editor'>
          {properties.length ? (
            <div className='note-property-list'>
              {properties.map(([key, value]) => (
                <div className='note-property' key={key}>
                  <span className='note-property-name'>{key}</span>
                  <PropertyValue
                    property={key}
                    value={value}
                    onSave={(next) => save(key, next)}
                    t={t}
                  />
                  <button
                    type='button'
                    className='icon-btn'
                    aria-label={t('Remove property {property}', { property: key })}
                    title={t('Remove property')}
                    onClick={() => remove(key)}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p>{t('No properties yet. Add one to start.')}</p>
          )}
          <form className='note-property-add' onSubmit={add}>
            <input
              aria-label={t('Property name')}
              placeholder={t('Property name')}
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
            />
            <button
              type='submit'
              disabled={!newKey.trim() || Object.hasOwn(metadata.data, newKey.trim())}
            >
              {t('Add property')}
            </button>
          </form>
        </div>
      )}
    </details>
  );
}
