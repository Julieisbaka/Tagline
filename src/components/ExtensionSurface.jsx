import { useEffect, useMemo, useRef } from 'react';
import { requirePayload } from '../lib/extensionCapabilities.js';

const BOOTSTRAP = `<script>
(() => {
  const listeners = new Set();
  window.taglineWebview = Object.freeze({
    postMessage: (payload) => parent.postMessage({ type: 'extension-ui-message', payload }, '*'),
    onMessage: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('Expected a listener.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'extension-ui-message') return;
    for (const listener of [...listeners]) {
      try { listener(event.data.payload); }
      catch (error) { parent.postMessage({ type: 'extension-ui-error', message: String(error.message) }, '*'); }
    }
  });
  addEventListener('error', (event) => parent.postMessage({ type: 'extension-ui-error', message: event.message }, '*'));
  addEventListener('unhandledrejection', (event) => parent.postMessage({
    type: 'extension-ui-error', message: String(event.reason?.message || event.reason)
  }, '*'));
})();
</script>`;

export default function ExtensionSurface({ surface, onClose }) {
  const frame = useRef(null);
  const rate = useRef({ start: 0, count: 0 });
  const { host, kind, id, html, title } = surface;
  const document = useMemo(() => `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'">
    ${BOOTSTRAP}</head><body>${html}</body></html>`, [html]);

  useEffect(() => {
    const receive = (event) => {
      if (event.source !== frame.current?.contentWindow || !event.data) return;
      const now = performance.now();
      if (now - rate.current.start >= 1000) rate.current = { start: now, count: 0 };
      if (++rate.current.count > host.limits.extensionMessagesPerSecond) {
        host.bridge.notify(`${title}: Webview message rate exceeded; surface closed.`);
        onClose(surface);
        return;
      }
      if (event.data.type === 'extension-ui-error') {
        host.bridge.notify(`${title}: ${String(event.data.message).slice(0, 500)}`);
      } else if (event.data.type === 'extension-ui-message') {
        try { host.sendEvent('surface-event', `${kind}:${id}`, requirePayload(event.data.payload)); }
        catch (error) { host.bridge.notify(`${title}: ${error.message}`); }
      }
    };
    const send = (payload) => frame.current?.contentWindow?.postMessage({ type: 'extension-ui-message', payload }, '*');
    host.surfaceTransports.set(`${kind}:${id}`, send);
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      if (host.surfaceTransports.get(`${kind}:${id}`) === send) host.surfaceTransports.delete(`${kind}:${id}`);
    };
  }, [host, kind, id, title, surface, onClose]);

  return <iframe className="extension-surface" ref={frame} title={title}
    sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} />;
}
