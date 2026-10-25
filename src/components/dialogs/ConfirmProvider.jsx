import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from './ModalBackdrop.jsx';

const Confirmation = createContext(null);
export const useConfirm = () => useContext(Confirmation);

export default function ConfirmProvider({ children }) {
  const { t } = useI18n();
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
  useEffect(() => () => {
    for (const item of queue.current) item.resolve(false);
    queue.current = [];
  }, []);
  return <Confirmation.Provider value={confirm}>
    {children}
    {request && <ModalBackdrop onMouseDown={() => answer(false)}>
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
