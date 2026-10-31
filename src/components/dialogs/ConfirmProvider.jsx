import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { useNativeUi } from '../../lib/nativeUi.js';
import ModalBackdrop from './ModalBackdrop.jsx';

const Confirmation = createContext(null);
export const useConfirm = () => useContext(Confirmation);

export default function ConfirmProvider({ children }) {
  const { t } = useI18n();
  const native = useNativeUi();
  const queue = useRef([]);
  const [request, setRequest] = useState(null);
  const confirm = useCallback((message) => new Promise((resolve) => {
    queue.current.push({ message, resolve });
    setRequest(queue.current[0]);
  }), []);
  const answer = (accepted) => {
    queue.current.shift().resolve(accepted);
    setRequest(queue.current[0] || null);
  };
  useEffect(() => {
    if (!native || !request) return;
    let active = true;
    window.api.nativeConfirm({ message: request.message, title: t('Confirm'), cancel: t('Cancel'), confirm: t('Confirm') })
      .then((accepted) => { if (active) answer(accepted); })
      .catch((error) => {
        if (!active) return;
        window.dispatchEvent(new CustomEvent('app-error', { detail: error.message }));
        answer(false);
      });
    return () => { active = false; };
  }, [native, request, t]);
  useEffect(() => () => {
    for (const item of queue.current) item.resolve(false);
    queue.current = [];
  }, []);
  return <Confirmation.Provider value={confirm}>
    {children}
    {request && !native && <ModalBackdrop onMouseDown={() => answer(false)}>
      <div className="modal dialog confirm-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="confirm-title" aria-describedby="confirm-message" onMouseDown={(event) => event.stopPropagation()}>
        <h3 id="confirm-title">{t('Confirm')}</h3>
        <p id="confirm-message">{request.message}</p>
        <div className="dialog-buttons">
          <button autoFocus onClick={() => answer(false)}>{t('Cancel')}</button>
          <button className="primary" onClick={() => answer(true)}>{t('Confirm')}</button>
        </div>
      </div>
    </ModalBackdrop>}
  </Confirmation.Provider>;
}
