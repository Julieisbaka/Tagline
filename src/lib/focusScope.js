const scopes = [];
const inertElements = new WeakMap();

function focusableElements(root) {
  return [...root.querySelectorAll('button, input, select, textarea, a[href], summary, iframe, [tabindex], [contenteditable="true"]')]
    .filter((element) => element.tabIndex >= 0 && !element.disabled &&
      !element.closest('[inert], [hidden]') && element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden');
}

export function trapTabKey(event, root) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const elements = focusableElements(root);
  const first = elements[0];
  const last = elements.at(-1);
  const current = root.ownerDocument.activeElement;
  if (!first || !root.contains(current) || current === root ||
    (event.shiftKey ? current === first : current === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
    if (!first) root.focus();
  }
}

export function containFocus(root, previousFocus = root.ownerDocument.activeElement) {
  const document = root.ownerDocument;
  const scope = { root };
  const siblings = [];
  for (let branch = root; branch.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      const state = inertElements.get(sibling) || { count: 0, original: sibling.inert };
      state.count++;
      inertElements.set(sibling, state);
      sibling.inert = true;
      siblings.push(sibling);
    }
  }
  scopes.push(scope);
  const focusFirst = () => (focusableElements(root)[0] || root).focus({ preventScroll: true });
  const onFocus = (event) => {
    if (scopes.at(-1) === scope && !root.contains(event.target)) focusFirst();
  };
  const onKey = (event) => {
    if (scopes.at(-1) === scope) trapTabKey(event, root);
  };
  document.addEventListener('focusin', onFocus);
  document.addEventListener('keydown', onKey);
  if (!root.contains(document.activeElement)) focusFirst();
  return () => {
    scopes.splice(scopes.indexOf(scope), 1);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('keydown', onKey);
    for (const sibling of siblings) {
      const state = inertElements.get(sibling);
      if (--state.count === 0) {
        sibling.inert = state.original;
        inertElements.delete(sibling);
      }
    }
    queueMicrotask(() => {
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]') &&
        (document.activeElement === document.body || root.contains(document.activeElement))) {
        previousFocus.focus({ preventScroll: true });
      }
    });
  };
}
