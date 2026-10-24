import { useEffect, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { useI18n } from '../lib/i18n.js';
import { trapTabKey } from '../lib/focusScope.js';

export default function VisualFindReplace({ editor, onClose }) {
  const { t } = useI18n();
  const input = useRef(null);
  const [term, setTerm] = useState(editor.storage.findAndReplace.searchTerm);
  const [replacement, setReplacement] = useState(editor.storage.findAndReplace.replaceTerm);
  const [caseSensitive, setCaseSensitive] = useState(editor.storage.findAndReplace.caseSensitive);
  const [wholeWord, setWholeWord] = useState(editor.storage.findAndReplace.wholeWord);
  const result = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      total: ed.storage.findAndReplace.results.length,
      current: ed.storage.findAndReplace.currentIndex,
    }),
  });
  useEffect(() => {
    input.current?.focus();
    return () => { if (!editor.isDestroyed) editor.commands.clearSearch(); };
  }, [editor]);
  const close = () => { onClose(); editor.commands.focus(); };
  return <div className="visual-find" role="search" aria-label={t('Find and replace in note')}
    onKeyDown={(event) => {
      trapTabKey(event, event.currentTarget);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <form className="visual-find-row" onSubmit={(event) => {
      event.preventDefault();
      editor.commands.goToNextResult();
    }}>
      <input ref={input} aria-label={t('Find text')} placeholder={t('Find text')} value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          editor.commands.setSearchTerm(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault();
            editor.commands.goToPreviousResult();
          }
        }} />
      <span role="status" aria-live="polite">{t('{current} of {total}', {
        current: result.current === null ? 0 : result.current + 1, total: result.total,
      })}</span>
      <button type="button" disabled={!result.total} onClick={() => editor.commands.goToPreviousResult()}>{t('Previous match')}</button>
      <button type="submit" disabled={!result.total}>{t('Next match')}</button>
      <button type="button" onClick={close}>{t('Close find')}</button>
    </form>
    <form className="visual-find-row" onSubmit={(event) => {
      event.preventDefault();
      editor.commands.setReplaceTerm(replacement);
      editor.commands.replace();
    }}>
      <input aria-label={t('Replace with')} placeholder={t('Replace with')} value={replacement}
        onChange={(event) => setReplacement(event.target.value)} />
      <button type="submit" disabled={!result.total}>{t('Replace')}</button>
      <button type="button" disabled={!result.total} onClick={() => {
        editor.commands.setReplaceTerm(replacement);
        editor.commands.replaceAll();
      }}>{t('Replace all')}</button>
      <label><input type="checkbox" checked={caseSensitive} onChange={(event) => {
        setCaseSensitive(event.target.checked);
        editor.commands.setCaseSensitive(event.target.checked);
      }} />{t('Match case')}</label>
      <label><input type="checkbox" checked={wholeWord} onChange={(event) => {
        setWholeWord(event.target.checked);
        editor.commands.setWholeWord(event.target.checked);
      }} />{t('Whole words')}</label>
    </form>
  </div>;
}
