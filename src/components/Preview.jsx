import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown, slugify } from '../lib/markdown.js';

export default function Preview({
  content,
  resolve,
  onOpenLink,
  onTagClick,
  highlightOnly,
  scrollTo,
  className = '',
}) {
  const ref = useRef(null);
  const html = useMemo(() => renderMarkdown(content, resolve), [content, resolve]);

  useEffect(() => {
    if (!scrollTo?.heading || !ref.current) {
      return;
    }
    const el = ref.current.querySelector(`#${CSS.escape(slugify(scrollTo.heading))}`);
    el?.scrollIntoView({ block: 'start' });
  }, [scrollTo, html]);

  const onClick = (e) => {
    const link = e.target.closest('a');
    if (!link) {
      return;
    }
    if (link.classList.contains('internal-link')) {
      e.preventDefault();
      onOpenLink(link.dataset.href, link.dataset.heading, e.ctrlKey || e.metaKey);
    } else if (link.classList.contains('tag')) {
      e.preventDefault();
      onTagClick(link.dataset.tag);
    }
    // External http(s) links are handled by the main process (opened in browser).
  };

  const onCopy = (event) => {
    const selection = window.getSelection();
    if (!event.clipboardData || !selection?.rangeCount || selection.isCollapsed) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) {
      return;
    }
    const container = document.createElement('div');
    let fragment = range.cloneContents();
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) {
      ancestor = ancestor.parentElement;
    }
    while (ancestor && ancestor !== ref.current) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.appendChild(fragment);
      fragment = wrapper;
      ancestor = ancestor.parentElement;
    }
    container.appendChild(fragment);
    container.querySelectorAll('mark').forEach((mark) => {
      mark.style.backgroundColor = '#ffff00';
    });
    event.clipboardData.setData('text/html', container.innerHTML);
    event.clipboardData.setData('text/plain', selection.toString());
    event.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={`preview markdown-body${className ? ` ${className}` : ''}${highlightOnly ? ' highlight-only' : ''}`}
      onClick={onClick}
      onCopy={onCopy}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
