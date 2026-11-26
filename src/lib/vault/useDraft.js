import { useEffect, useRef, useState } from 'react';
import { registerPendingFlush } from './pendingEdits.js';

export function useDraft(value, onCommit) {
  const [draft, setDraftState] = useState(value);
  const draftRef = useRef(value);
  const valueRef = useRef(value);
  const commitRef = useRef(null);
  commitRef.current = () => {
    if (draftRef.current !== valueRef.current) {
      const previous = valueRef.current;
      valueRef.current = draftRef.current;
      if (onCommit(draftRef.current) === false) {
        valueRef.current = previous;
        return false;
      }
    }
    return true;
  };
  const setDraft = (next) => {
    draftRef.current = next;
    setDraftState(next);
  };
  useEffect(() => {
    valueRef.current = value;
    draftRef.current = value;
    setDraftState(value);
  }, [value]);
  useEffect(() => {
    const unregister = registerPendingFlush(() => commitRef.current());
    return () => {
      unregister();
      commitRef.current();
    };
  }, []);
  return [draft, setDraft, () => commitRef.current()];
}
