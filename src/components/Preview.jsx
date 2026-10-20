import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown, slugify } from '../lib/markdown.js';

export default function Preview({ content, resolve, onOpenLink, onTagClick, highlightOnly, scrollTo }) {
  const ref = useRef(null);
  const html = useMemo(() => renderMarkdown(content, resolve), [content, resolve]);

  useEffect(() => {
    if (!scrollTo?.heading || !ref.current) return;
    const el = ref.current.querySelector(`#${CSS.escape(slugify(scrollTo.heading))}`);
    el?.scrollIntoView({ block: 'start' });
  }, [scrollTo, html]);

  const onClick = (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    if (link.classList.contains('internal-link')) {
      e.preventDefault();
      onOpenLink(link.dataset.href, link.dataset.heading, e.ctrlKey || e.metaKey);
    } else if (link.classList.contains('tag')) {
      e.preventDefault();
      onTagClick(link.dataset.tag);
    }
    // External http(s) links are handled by the main process (opened in browser).
  };

  return (
    <div
      ref={ref}
      className={`preview markdown-body${highlightOnly ? ' highlight-only' : ''}`}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
