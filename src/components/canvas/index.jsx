import { useMemo, useState } from 'react';
import { parseCanvas } from '../../lib/canvas.js';
import { useI18n } from '../../lib/i18n.js';
import { baseName } from '../../lib/vault.js';
import JsonEditor from '../JsonEditor.jsx';
import JsonRecovery from '../JsonRecovery.jsx';
import CanvasEditor from './CanvasEditor.jsx';

export default function CanvasView({
  path, content, mode, setMode, onChange, onRestore, onRename, onOpenHistory, paths, contents, onOpenFile, onOpenUrl, onOpenLink, settings,
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(baseName(path));
  const parsed = useMemo(() => {
    try { return { canvas: parseCanvas(content), error: null }; }
    catch (error) { return { canvas: null, error: error.message }; }
  }, [content]);
  const editorMode = mode === 'edit' ? 'source' : 'visual';
  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== baseName(path)) onRename(path, next);
    else setTitle(baseName(path));
  };

  return (
    <div className="note-view canvas-view">
      <div className="note-header">
        <input className="note-title" value={title} onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle} onKeyDown={(event) => event.key === 'Enter' && event.target.blur()} />
        <div className="note-actions">
          <button onClick={onOpenHistory}>{t('History')}</button>
          <select aria-label={t('Canvas mode')} value={editorMode}
            onChange={(event) => setMode(event.target.value === 'source' ? 'edit' : 'visual')}>
            <option value="visual">{t('Visual')}</option>
            <option value="source">{t('JSON source')}</option>
          </select>
        </div>
      </div>
      {editorMode === 'source' ? <>
        {parsed.error && <div className="editor-notice source-fallback" role="alert">{parsed.error}
          <JsonRecovery path={path} content={content} onRestore={onRestore} />
        </div>}
        <JsonEditor className="canvas-json-editor" label={t('Canvas JSON')} value={content} onChange={onChange}
          height="100%" autoFocus settings={settings} />
      </> : parsed.error ? <div className="canvas-invalid" role="alert">
        <h2>{t('Invalid Canvas JSON')}</h2><p>{parsed.error}</p>
        <button onClick={() => setMode('edit')}>{t('Open JSON source')}</button>
        <JsonRecovery path={path} content={content} onRestore={onRestore} />
      </div> : <CanvasEditor canvas={parsed.canvas} onChange={onChange} paths={paths} onEditSource={() => setMode('edit')}
        contents={contents}
        onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} onOpenLink={onOpenLink} t={t} keybindings={settings.keybindings} />}
    </div>
  );
}
