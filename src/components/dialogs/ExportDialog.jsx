import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { renderMarkdown } from '../../lib/markdown.js';

const FORMATS = [
  ['docx', 'Word (.docx)'], ['odt', 'OpenDocument (.odt)'], ['rtf', 'Rich text (.rtf)'],
  ['html', 'HTML (.html)'], ['epub', 'EPUB (.epub)'], ['pdf', 'PDF (requires a PDF engine)'],
];

export function exportHtml(content, resolve) {
  const doc = new DOMParser().parseFromString(renderMarkdown(content, resolve), 'text/html');
  // Pandoc must never fetch remote resources or interpret raw note HTML as code.
  doc.querySelectorAll('img, script, style, iframe, object, embed').forEach((el) => el.remove());
  doc.querySelectorAll('a.internal-link').forEach((el) => {
    el.replaceWith(doc.createTextNode(el.textContent));
  });
  return doc.body.innerHTML;
}

export function standaloneHtml(title, content, resolve, language = 'en') {
  const doc = new DOMParser().parseFromString('<!doctype html><html><head></head><body></body></html>', 'text/html');
  doc.documentElement.lang = language;
  doc.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
  const heading = doc.createElement('title');
  heading.textContent = title;
  doc.head.append(heading);
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  doc.head.append(csp);
  const style = doc.createElement('style');
  style.textContent = 'body{max-width:56rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.6 system-ui;color:#111;background:#fff}mark{background:#fff176;color:#111}table{border-collapse:collapse}td,th{border:1px solid #555;padding:.4rem}pre{white-space:pre-wrap}a{color:#003c8f}';
  doc.head.append(style);
  doc.body.innerHTML = exportHtml(content, resolve);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

import ModalBackdrop from './ModalBackdrop.jsx';

export default function ExportDialog({ title, content, resolve, onClose }) {
  const { t, locale } = useI18n();
  const [format, setFormat] = useState('html');
  const [pandoc, setPandoc] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    window.api.pandocStatus().then(setPandoc).catch((e) => setError(e.message));
  }, []);

  const perform = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const result = format === 'html'
        ? await window.api.exportHtml({ title, html: standaloneHtml(title, content, resolve, locale) })
        : await window.api.exportDocument({ title, format, html: exportHtml(content, resolve) });
      if (!result.canceled) setResult(result);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <ModalBackdrop onMouseDown={() => !busy && onClose()}>
      <div className="modal dialog export-dialog" role="dialog" aria-modal="true"
        aria-label={t('Export {title}', { title })} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('Export {title}', { title })}</h3>
        <p>{format === 'html' ? t('Built-in HTML export. Pandoc is not required.')
          : pandoc?.available ? pandoc.version : t('Pandoc is required for this format. Locate it in Settings.')}</p>
        <label className="setting-row"><span>{t('Format')}</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
          </select>
        </label>
        <p>{t('Exports the entire note, including unsaved edits. Wiki links become labels; images are omitted. Formatting support varies by format.')}</p>
        {format === 'pdf' && <p>{t('PDF also needs a Pandoc-compatible LaTeX engine on PATH.')}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        {result && <div role="status"><p>{t('Exported to {path}', { path: result.path })}</p>
          {result.warnings && <pre>{result.warnings}</pre>}</div>}
        <div className="dialog-buttons">
          <button disabled={busy} onClick={onClose}>{t('Close')}</button>
          <button className="primary" disabled={busy || (format !== 'html' && !pandoc?.available)} onClick={perform}>
            {t(busy ? 'Exporting...' : 'Save export')}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
