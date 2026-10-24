import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

export default function WebsiteView({ url, onClose }) {
  const { t } = useI18n();
  const surface = useRef(null);
  const [address, setAddress] = useState(url);
  const [state, setState] = useState({ url, loading: true });
  const [error, setError] = useState('');
  const run = async (action, target) => {
    setError('');
    try { await window.api.websiteAction(action, target); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => {
    const unsubscribe = window.api.onWebsiteState((next) => {
      setState(next);
      if (next.url) setAddress(next.url);
    });
    const rectangle = () => {
      const { x, y, width, height } = surface.current.getBoundingClientRect();
      return { x, y, width, height };
    };
    const report = (e) => setError(e.message);
    window.api.openWebsite(url, rectangle()).catch(report);
    const resize = () => window.api.resizeWebsite(rectangle()).catch(report);
    const unsubscribeResize = window.api.onWebsiteResize(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(surface.current);
    // The surface can move without resizing when sibling chrome changes height.
    if (surface.current.parentElement) observer.observe(surface.current.parentElement);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      unsubscribe();
      unsubscribeResize();
      window.api.closeWebsite().catch((e) =>
        window.dispatchEvent(new CustomEvent('app-error', { detail: e.message })));
    };
  }, [url]);
  return <section className="website-view" aria-label={t('Website browser')}>
    <form className="website-toolbar" onSubmit={(e) => { e.preventDefault(); run('navigate', address); }}>
      <button type="button" disabled={!state.canGoBack} onClick={() => run('back')}>{t('Back')}</button>
      <button type="button" disabled={!state.canGoForward} onClick={() => run('forward')}>{t('Forward')}</button>
      <button type="button" onClick={() => run('reload')}>{t('Reload')}</button>
      <input aria-label={t('Website address')} type="url" required value={address} onChange={(e) => setAddress(e.target.value)} />
      <button type="submit">{t('Go')}</button>
      <button type="button" onClick={() => run('archive', state.url || url)}
        title={t('Open the Wayback Machine snapshot of this page')}>{t('Archived copy')}</button>
      <button type="button" onClick={() => run('external', state.url || url)}>{t('Open in browser')}</button>
      <button type="button" onClick={onClose} aria-label={t('Close website')}>&times;</button>
    </form>
    <div className="website-status" role="status">{error || state.error || (state.loading ? t('Loading…') : state.url)}</div>
    <div className="website-surface" ref={surface} />
  </section>;
}
