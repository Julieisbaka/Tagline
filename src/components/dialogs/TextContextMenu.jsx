import { useEffect, useState } from 'react';
import ContextMenu from './ContextMenu.jsx';

export default function TextContextMenu() {
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    const pendingSpell = [];
    const offSpell = window.api.spellcheck?.onContext((info) => pendingSpell.shift()?.(info));
    let activeMenu = 0;
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
      const tracksSpell = !!editable && !!window.api.spellcheck && event.isTrusted;
      const wantsSpell = tracksSpell && target.spellcheck !== false;
      // Leaving the event uncancelled lets Electron report the misspelled word.
      if (!tracksSpell) {
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
      const spellItems = (spell) => {
        const word = spell?.word || '';
        return word
          ? [
              ...((spell.suggestions || []).length
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
      };
      const id = ++activeMenu;
      const actions = [
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
      ];
      const x = keyboard ? rect.left + 16 : event.clientX;
      const y = keyboard ? rect.top + 16 : event.clientY;
      const isFlow = !!target?.closest('.flow');
      if (isFlow) {
        const flowMenuEvent = new CustomEvent('flow-spellcheck-context', {
          cancelable: true,
          detail: { phase: 'open', sourceEvent: event, target, pending: wantsSpell },
        });
        if (!window.dispatchEvent(flowMenuEvent)) {
          if (tracksSpell) {
            pendingSpell.push((info) => {
              if (!wantsSpell || activeMenu !== id) {
                return;
              }
              window.dispatchEvent(
                new CustomEvent('flow-spellcheck-context', {
                  cancelable: true,
                  detail: {
                    phase: 'suggestions',
                    sourceEvent: event,
                    target,
                    items: spellItems(info),
                  },
                })
              );
            });
          }
          return;
        }
      }
      setMenu({ id, x, y, items: actions, spellcheck: wantsSpell });
      if (tracksSpell) {
        pendingSpell.push((info) => {
          if (!wantsSpell || activeMenu !== id) {
            return;
          }
          const suggestions = spellItems(info);
          if (suggestions.length) {
            setMenu((current) =>
              current?.id === id
                ? { ...current, items: [...suggestions, { separator: true }, ...actions] }
                : current
            );
          }
        });
      }
    };
    document.addEventListener('contextmenu', open);
    return () => {
      document.removeEventListener('contextmenu', open);
      offSpell?.();
    };
  }, []);
  return menu && <ContextMenu {...menu} forceApp={menu.spellcheck} onClose={() => setMenu(null)} />;
}
