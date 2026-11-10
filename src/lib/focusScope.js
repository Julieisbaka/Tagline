const scopes = [];
const popped = [];
const inertElements = new WeakMap();

/**
 * Return visible, enabled focusable descendants in DOM order.
 * @param {Element} root
 * @returns {Element[]}
 */
function focusableElements(root) {
  return [
    ...root.querySelectorAll(
      'button, input, select, textarea, a[href], summary, iframe, [tabindex], [contenteditable="true"]'
    ),
  ].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.disabled &&
      !element.closest('[inert], [hidden]') &&
      element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden'
  );
}

/**
 * Keep Tab and Shift+Tab navigation inside an active dialog.
 * @param {KeyboardEvent} event
 * @param {Element} root
 * @returns {void}
 */
export function trapTabKey(event, root) {
  if (event.key !== 'Tab' || event.defaultPrevented) {
    return;
  }
  const elements = focusableElements(root);
  const first = elements[0];
  const last = elements.at(-1);
  const current = root.ownerDocument.activeElement;
  if (
    !first ||
    !root.contains(current) ||
    current === root ||
    (event.shiftKey ? current === first : current === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
    if (!first) {
      root.focus();
    }
  }
}

/**
 * Trap focus in a modal and restore the previous focus target on cleanup.
 * @param {Element} root
 * @param {Element} [previousFocus]
 * @param {boolean} [modal]
 * @param {boolean} [focusRoot] Focus the scope root instead of the first element.
 * @returns {function}
 */
export function containFocus(
  root,
  previousFocus = root.ownerDocument.activeElement,
  modal = true,
  focusRoot = false
) {
  const document = root.ownerDocument;
  const parent =
    [...scopes].reverse().find((candidate) => candidate.root.contains(previousFocus)) ||
    [...popped].reverse().find((candidate) => candidate.root.contains(previousFocus));
  const scope = { root, previousFocus, parent };
  const siblings = [];
  for (let branch = root; modal && branch.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) {
        continue;
      }
      const state = inertElements.get(sibling) || { count: 0, original: sibling.inert };
      state.count++;
      inertElements.set(sibling, state);
      sibling.inert = true;
      siblings.push(sibling);
    }
  }
  scopes.push(scope);
  /**
   * Focus the first tabbable element, or the scope root when none exists.
   * @returns {void}
   */
  const focusFirst = () =>
    (focusRoot ? root : focusableElements(root)[0] || root).focus({ preventScroll: true });
  /**
   * Restore focus into the topmost scope when focus escapes it.
   * @param {FocusEvent} event
   * @returns {void}
   */
  const onFocus = (event) => {
    if (scopes.at(-1) === scope && !root.contains(event.target)) {
      focusFirst();
    }
  };
  /**
   * Keep Tab navigation within the active focus scope.
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  const onKey = (event) => {
    if (scopes.at(-1) === scope) {
      trapTabKey(event, root);
    }
  };
  document.addEventListener('focusin', onFocus);
  document.addEventListener('keydown', onKey);
  if (!root.contains(document.activeElement)) {
    focusFirst();
  }
  return () => {
    scopes.splice(scopes.indexOf(scope), 1);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('keydown', onKey);
    // Keep the scope reachable until its restore microtask runs, so a scope
    // mounted in the same commit can inherit this restore chain.
    popped.push(scope);
    if (popped.length > 16) {
      popped.shift();
    }
    for (const sibling of siblings) {
      const state = inertElements.get(sibling);
      if (--state.count === 0) {
        sibling.inert = state.original;
        inertElements.delete(sibling);
      }
    }
    queueMicrotask(() => {
      popped.splice(popped.indexOf(scope), 1);
      const activeScope = scopes.at(-1);
      if (
        document.activeElement !== document.body &&
        !root.contains(document.activeElement) &&
        !activeScope?.root.contains(document.activeElement)
      ) {
        return;
      }
      for (let candidate = scope; candidate; candidate = candidate.parent) {
        if (candidate.previousFocus?.isConnected && !candidate.previousFocus.closest('[inert]')) {
          candidate.previousFocus.focus({ preventScroll: true });
          return;
        }
      }
      if (activeScope?.root.isConnected) {
        (focusableElements(activeScope.root)[0] || activeScope.root).focus({
          preventScroll: true,
        });
      }
    });
  };
}
