import { useLayoutEffect, useRef } from 'react';
import { containFocus } from '../../lib/focusScope.js';

export default function ModalBackdrop({ children, className = 'modal-backdrop', onMouseDown }) {
  const ref = useRef(null);
  const previousFocus = useRef(document.activeElement);
  useLayoutEffect(() => containFocus(ref.current, previousFocus.current), []);
  return <div ref={ref} className={className} tabIndex={-1} onMouseDown={onMouseDown}
    onKeyDown={(event) => {
      if (event.target.closest('select')?.matches(':open')) return;
      if (event.key === 'Escape' && !event.defaultPrevented && onMouseDown) {
        event.preventDefault();
        event.stopPropagation();
        onMouseDown();
      }
    }}>{children}</div>;
}
