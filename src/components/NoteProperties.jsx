import { useEffect, useMemo, useRef, useState } from 'react';
import { parseDocument, stringify } from 'yaml';
import {
  deleteFrontmatterProperty,
  readFrontmatter,
  setFrontmatterProperty,
} from '../lib/markdown/frontmatter.js';
import { useI18n } from '../lib/i18n/i18n.js';
import { useDraft } from '../lib/vault/useDraft.js';
import { flushPendingEdits } from '../lib/vault/pendingEdits.js';

function TextValue({ property, value, onSave, t }) {
  const [draft, setDraft, commit] = useDraft(value ?? '', onSave);
  return (
    <div className='note-property-complex'>
      <input
        aria-label={t('Value for {property}', { property })}
        value={draft}
        data-draft-dirty={draft !== (value ?? '')}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type='button' onClick={commit}>
        {t('Apply')}
      </button>
      <button type='button' onClick={() => setDraft(value ?? '')}>
        {t('Cancel')}
      </button>
    </div>
  );
}

function YamlValue({ property, value, onSave, t }) {
  const initial = useMemo(() => stringify(value), [value]);
  const [error, setError] = useState('');
  const [draft, setDraft, save] = useDraft(initial, (draft) => {
    const document = parseDocument(draft);
    const problem = document.errors[0] || document.warnings[0];
    if (problem) {
      setError(problem.message);
      return false;
    }
    try {
      if (onSave(document.toJS({ maxAliasCount: 50 })) === false) {
        return false;
      }
      setError('');
    } catch (failure) {
      setError(failure.message);
      return false;
    }
  });
  useEffect(() => setError(''), [initial]);

  return (
    <div className='note-property-complex'>
      <textarea
        aria-label={t('YAML value for {property}', { property })}
        value={draft}
        data-draft-dirty={draft !== initial}
        onChange={(event) => setDraft(event.target.value)}
        rows={Math.min(6, Math.max(2, draft.split('\n').length))}
      />
      <button type='button' onClick={save}>
        {t('Apply')}
      </button>
      <button
        type='button'
        onClick={() => {
          setDraft(initial);
          setError('');
        }}
      >
        {t('Cancel')}
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
  const initial = value.join('\n');
  const [draft, setDraft, save] = useDraft(initial, (text) =>
    onSave(
      text
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
  return (
    <div className='note-property-complex'>
      <textarea
        aria-label={t('Values for {property}', { property })}
        placeholder={t('One value per line')}
        value={draft}
        data-draft-dirty={draft !== initial}
        onChange={(event) => setDraft(event.target.value)}
        rows={Math.min(6, Math.max(2, draft.split('\n').length))}
      />
      <button type='button' onClick={save}>
        {t('Apply')}
      </button>
      <button type='button' onClick={() => setDraft(initial)}>
        {t('Cancel')}
      </button>
    </div>
  );
}

function TagList({ value, onSave, t }) {
  const tags = (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().replace(/^#+/, '').toLowerCase())
    .filter((tag, index, list) => /^[a-z][\w/-]*$/.test(tag) && list.indexOf(tag) === index);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const add = (event) => {
    event.preventDefault();
    const raw = draft.split(/[\s,]+/).filter(Boolean);
    const next = raw.map((tag) => tag.replace(/^#+/, '').toLowerCase());
    if (!next.length || next.some((tag) => !/^[a-z][\w/-]*$/.test(tag))) {
      setError(
        t('Use tags that start with a letter and contain only letters, numbers, /, _ or -.')
      );
      return;
    }
    onSave([...new Set([...tags, ...next])]);
    setDraft('');
    setError('');
  };
  return (
    <div className='note-property-tags'>
      <div className='note-tag-chips'>
        {tags.map((tag) => (
          <span className='note-tag-chip' key={tag}>
            #{tag}
            <button
              type='button'
              aria-label={t('Remove tag {tag}', { tag })}
              onClick={() => onSave(tags.filter((item) => item !== tag))}
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <form className='note-tag-add' onSubmit={add}>
        <input
          aria-label={t('Add a tag')}
          placeholder={t('Add a tag')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type='submit' disabled={!draft.trim()}>
          {t('Add')}
        </button>
      </form>
      <small>{t('Tags are note metadata. Existing inline #tags remain searchable.')}</small>
      {error && (
        <span className='error-text' role='alert'>
          {error}
        </span>
      )}
    </div>
  );
}

function PropertyValue({ property, value, onSave, t }) {
  if (property === 'tags') {
    return <TagList value={value} onSave={onSave} t={t} />;
  }
  if (typeof value === 'string' || value === null) {
    return <TextValue property={property} value={value} onSave={onSave} t={t} />;
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
  const [error, setError] = useState('');
  const [draft, setDraft, save] = useDraft(String(value), (text) => {
    if (!text.trim() || !Number.isFinite(Number(text))) {
      setError(t('Enter a valid number'));
      return false;
    }
    setError('');
    return onSave(Number(text));
  });
  useEffect(() => setError(''), [value]);

  return (
    <label className='note-property-number'>
      <input
        type='number'
        aria-label={t('Value for {property}', { property })}
        value={draft}
        data-draft-dirty={draft !== String(value)}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type='button' onClick={save}>
        {t('Apply')}
      </button>
      <button
        type='button'
        onClick={() => {
          setDraft(String(value));
          setError('');
        }}
      >
        {t('Cancel')}
      </button>
      {error && (
        <span className='error-text' role='alert'>
          {error}
        </span>
      )}
    </label>
  );
}

export default function NoteProperties({
  content,
  onChange,
  editable,
  notify,
  onEditSource,
  visualRef,
  getContent,
}) {
  const { t } = useI18n();
  const metadata = useMemo(() => readFrontmatter(content), [content]);
  const contentRef = useRef(content);
  contentRef.current = content;
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState('text');
  const properties = Object.entries(metadata.data).filter(([key]) => key !== 'tags');
  const hasTags = Object.hasOwn(metadata.data, 'tags');

  const save = (key, value) => {
    try {
      const next = setFrontmatterProperty(getContent?.() ?? contentRef.current, key, value);
      contentRef.current = next;
      onChange(next);
    } catch (error) {
      notify(t('Could not update property: {error}', { error: error.message }));
      return false;
    }
    return true;
  };
  const remove = (key) => {
    try {
      if (!flushPendingEdits()) {
        return;
      }
      const next = deleteFrontmatterProperty(getContent?.() ?? contentRef.current, key);
      contentRef.current = next;
      onChange(next);
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
    save(key, newType === 'boolean' ? false : '');
    setNewKey('');
  };

  return (
    <details
      className='note-properties'
      open={properties.length > 0 || !!metadata.prefix || undefined}
      onKeyDown={(event) => {
        if (
          !(event.metaKey || event.ctrlKey) ||
          event.altKey ||
          (event.target.matches('input, textarea') && event.target.dataset.draftDirty !== 'false')
        ) {
          return;
        }
        const key = event.key.toLowerCase();
        if (key === 'z' || (key === 'y' && !event.metaKey)) {
          const redo = key === 'y' || event.shiftKey;
          if (visualRef?.current?.commands[redo ? 'redo' : 'undo']()) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }}
    >
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
          <div className='note-property-list'>
            <div className='note-property'>
              <span className='note-property-name'>{t('Tags')}</span>
              <PropertyValue
                property='tags'
                value={metadata.data.tags ?? []}
                onSave={(next) => save('tags', next)}
                t={t}
              />
              {hasTags ? (
                <button
                  type='button'
                  className='icon-btn'
                  aria-label={t('Remove property {property}', { property: 'tags' })}
                  title={t('Remove property')}
                  onClick={() => remove('tags')}
                >
                  &times;
                </button>
              ) : (
                <span />
              )}
            </div>
            {properties.map(([key, value]) => (
              <div className='note-property' key={key}>
                <span className='note-property-name'>{key}</span>
                <PropertyValue
                  property={key}
                  value={value}
                  onSave={(next) => {
                    if (
                      Object.hasOwn(readFrontmatter(getContent?.() ?? contentRef.current).data, key)
                    ) {
                      return save(key, next);
                    }
                    return true;
                  }}
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
          {!properties.length && <p>{t('No additional properties yet.')}</p>}
          <form className='note-property-add' onSubmit={add}>
            <input
              aria-label={t('Property name')}
              placeholder={t('Property name')}
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
            />
            <select
              aria-label={t('Property type')}
              value={newType}
              onChange={(event) => setNewType(event.target.value)}
            >
              <option value='text'>{t('Text')}</option>
              <option value='boolean'>{t('Boolean')}</option>
            </select>
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
