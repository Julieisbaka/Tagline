import { Component, useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import ModalBackdrop from './dialogs/ModalBackdrop.jsx';

class LoadBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('Unable to load view', error); }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

export function deferred(load, modal = false) {
  let cached;
  let pending;
  function Content({ viewProps, status }) {
    const [View, setView] = useState(() => cached);
    const [error, setError] = useState(null);
    useEffect(() => {
      if (cached) { setView(() => cached); return; }
      let active = true;
      pending ||= load().then((module) => {
        cached = module.default;
        return cached;
      }).catch((error) => {
        pending = null;
        throw error;
      });
      pending.then((view) => { if (active) setView(() => view); },
        (error) => { if (active) setError(error); });
      return () => { active = false; };
    }, []);
    if (error) throw error;
    return View ? <View {...viewProps} /> : status(null);
  }
  return function Deferred(props) {
    const { t } = useI18n();
    const status = (error) => {
      const content = <div className={modal ? 'modal dialog' : 'empty-workspace'}
        role={modal ? 'dialog' : undefined} aria-modal={modal || undefined} aria-label={modal ? t('Loading…') : undefined}
        onMouseDown={(event) => event.stopPropagation()}>
        <p role={error ? 'alert' : 'status'}>{error ? t('Could not load this view: {error}', { error: error.message }) : t('Loading…')}</p>
        {error && <button onClick={() => window.location.reload()}>{t('Reload')}</button>}
        {modal && <button onClick={props.onClose}>{t('Close')}</button>}
      </div>;
      return modal ? <ModalBackdrop onMouseDown={props.onClose}>{content}</ModalBackdrop> : content;
    };
    const content = <LoadBoundary fallback={status}>
      <Content viewProps={props} status={status} />
    </LoadBoundary>;
    // Preserve the invoking control across loading and loaded dialog focus scopes.
    return modal ? <ModalBackdrop className="deferred-dialog" onMouseDown={props.onClose}>{content}</ModalBackdrop> : content;
  };
}
