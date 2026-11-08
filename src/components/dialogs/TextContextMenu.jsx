import { useEffect, useState } from 'react';
import ContextMenu from './ContextMenu.jsx';

export default function TextContextMenu() {
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    const pendingSpell = [];
    const offSpell = window.api.spellcheck?.onContext((info) => pendingSpell.shift()?.(info));
    const open = (event) => {
      if (event.defaultPrevented || event.target.closest('.context-menu')) {
        return;
      }
      const target = event.target.closest('input, textarea, [contenteditable="true"]');
      const selection = window.getSelection();
      if (!target && !selection?.toString()) {
        return;
      }
      if (target?.matches('input[type="checkbox"], input[type="radio"], input[type="range"]')) {
        return;
      }
      const editable = target && !target.readOnly && !target.disabled;
      const wantsSpell = !!editable && window.api.spellcheck && target.spellcheck !== false;
      // Leaving the event uncancelled lets Electron report the misspelled word.
      if (!wantsSpell) {
        event.preventDefault();
      }
      const inputSelection =
        target && typeof target.selectionStart === 'number'
          ? [target.selectionStart, target.selectionEnd, target.selectionDirection]
          : null;
      const range =
        !inputSelection && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const selected = inputSelection
        ? inputSelection[0] !== inputSelection[1]
        : !!selection?.toString();
      const run = (action, custom) => async () => {
        await Promise.resolve();
        if ((target && !target.isConnected) || (range && !range.startContainer.isConnected)) {
          throw new Error('The selected text is no longer available.');
        }
        target?.focus({ preventScroll: true });
        if (!target) {
          document.activeElement?.blur();
        }
        if (inputSelection) {
          target.setSelectionRange(...inputSelection);
        } else if (range) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        await (custom ? custom() : window.api.editText(action));
      };
      const rect = event.target.getBoundingClientRect();
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const show = (spell) => {
        const word = spell?.word || '';
        const spellItems = word
          ? [
              ...(spell.suggestions.length
                ? spell.suggestions.map((suggestion) => ({
                    label: suggestion,
                    translate: false,
                    run: run(null, () => window.api.spellcheck.replace(suggestion)),
                  }))
                : [{ label: 'No spelling suggestions', disabled: true, run: () => {} }]),
              {
                label: 'Add to dictionary',
                run: run(null, () => window.api.spellcheck.addWord(word)),
              },
            ]
          : [];
        setMenu({
          x: keyboard ? rect.left + 16 : event.clientX,
          y: keyboard ? rect.top + 16 : event.clientY,
          items: [
            ...spellItems,
            ...(editable
              ? [
                  { label: 'Undo', run: run('undo') },
                  { label: 'Redo', run: run('redo') },
                ]
              : []),
            ...(editable ? [{ label: 'Cut', disabled: !selected, run: run('cut') }] : []),
            { label: 'Copy', disabled: !selected, run: run('copy') },
            ...(editable ? [{ label: 'Paste', run: run('paste') }] : []),
            { label: 'Select all', run: run('selectAll') },
          ],
        });
      };
      if (wantsSpell) {
        let done = false;
        const finish = (info) => {
          if (!done) {
            done = true;
            show(info);
          }
        };
        pendingSpell.push(finish);
        setTimeout(() => {
          const index = pendingSpell.indexOf(finish);
          if (index >= 0) {
            pendingSpell.splice(index, 1);
          }
          finish(null);
        }, 250);
      } else {
        show(null);
      }
    };
    document.addEventListener('contextmenu', open);
    return () => {
      document.removeEventListener('contextmenu', open);
      offSpell?.();
    };
  }, []);
  return menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />;
}
