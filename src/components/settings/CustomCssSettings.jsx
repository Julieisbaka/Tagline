import { css } from '@codemirror/lang-css';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef, useState } from 'react';
import { settingsCodeMirrorTheme } from '../../lib/editorExtensions.js';
import { useI18n } from '../../lib/i18n.js';
import { useConfirm } from '../dialogs/ConfirmProvider.jsx';

export default function CustomCssSettings({ settings, update }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [draft, setDraft] = useState(settings.customCss);
  const [error, setError] = useState('');
  useEffect(() => setDraft(settings.customCss), [settings.customCss]);
  const apply = useRef(null);
  apply.current = () => { if (draft !== settings.customCss) update({ customCss: draft }); };
  const label = t('CSS source');
  const extensions = useMemo(() => [
    css(),
    settingsCodeMirrorTheme,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'false' }),
    Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => { apply.current(); return true; } }])),
  ], [label]);
  const warning = 'Custom CSS is unrestricted. It can hide controls, break the layout, and load external resources. Only enable CSS you trust.';
  return <section className="custom-css-settings">
    <h4>{t('Custom CSS')}</h4>
    <p>{t(warning)}</p>
    <label className="setting-row"><span>{t('Enable custom CSS')}</span>
      <input type="checkbox" data-setting="customCssEnabled" checked={settings.customCssEnabled}
        onChange={async (event) => {
          const enabled = event.target.checked;
          if (!enabled || await confirm(t(warning))) update({ customCssEnabled: enabled });
        }} />
    </label>
    <label className="setting-row"><span>{t('Import CSS file')}</span>
      <input type="file" className="theme-file-input" accept=".css,text/css" aria-label={t('Import CSS file')}
        onChange={async (event) => {
          const file = event.target.files[0];
          event.target.value = '';
          if (!file) return;
          try { setDraft(await file.text()); setError(''); }
          catch (err) { setError(err.message); }
        }} />
    </label>
    <div className="custom-css-editor">
      <span>{label} <small>{t('Ctrl/Cmd+Enter applies')}</small></span>
      <CodeMirror value={draft} onChange={setDraft} extensions={extensions} theme="none" minHeight="180px" maxHeight="420px"
        basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true, searchKeymap: true,
          highlightSelectionMatches: settings.sourceSelectionMatches }} />
    </div>
    <div className="settings-actions">
      <button disabled={draft === settings.customCss} onClick={() => update({ customCss: draft })}>{t('Apply CSS')}</button>
      <button onClick={() => setDraft(settings.customCss)}>{t('Discard CSS edits')}</button>
      <button onClick={() => { update({ customCss: '', customCssEnabled: false }); setError(''); }}>{t('Reset custom CSS')}</button>
    </div>
    <p>{t('CSS is saved on this device and applied after you choose Apply CSS. To recover hidden controls, use View > Toggle Developer Tools and disable customCssEnabled in tagline-settings, then reload.')}</p>
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
