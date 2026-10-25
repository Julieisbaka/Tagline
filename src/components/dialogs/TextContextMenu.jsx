import { useEffect, useState } from 'react';
import ContextMenu from './ContextMenu.jsx';

export default function TextContextMenu() {
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    const open = (event) => {
      if (event.defaultPrevented || event.target.closest('.context-menu')) return;
      const target = event.target.closest('input, textarea, [contenteditable="true"]');
      const selection = window.getSelection();
      if (!target && !selection?.toString()) return;
      if (target?.matches('input[type="checkbox"], input[type="radio"], input[type="range"]')) return;
      event.preventDefault();
      const editable = target && !target.readOnly && !target.disabled;
      const inputSelection = target && typeof target.selectionStart === 'number'
        ? [target.selectionStart, target.selectionEnd, target.selectionDirection] : null;
      const range = !inputSelection && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const selected = inputSelection ? inputSelection[0] !== inputSelection[1] : !!selection?.toString();
      const run = (action) => async () => {
        await Promise.resolve();
        target?.focus({ preventScroll: true });
        if (!target) document.activeElement?.blur();
        if (inputSelection) target.setSelectionRange(...inputSelection);
        else if (range) { selection.removeAllRanges(); selection.addRange(range); }
        await window.api.editText(action);
      };
      setMenu({ x: event.clientX, y: event.clientY, items: [
        ...(editable ? [{ label: 'Undo', run: run('undo') }, { label: 'Redo', run: run('redo') }] : []),
        ...(editable ? [{ label: 'Cut', disabled: !selected, run: run('cut') }] : []),
        { label: 'Copy', disabled: !selected, run: run('copy') },
        ...(editable ? [{ label: 'Paste', run: run('paste') }] : []),
        { label: 'Select all', run: run('selectAll') },
      ] });
    };
    document.addEventListener('contextmenu', open);
    return () => document.removeEventListener('contextmenu', open);
  }, []);
  return menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />;
}
