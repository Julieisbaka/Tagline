import { useEffect, useRef } from 'react';
import { requirePayload } from '../lib/extensionCapabilities.js';

export default function ExtensionSurface({ surface, onClose }) {
  const frame = useRef(null);
  const rate = useRef({ start: 0, count: 0 });
  const { host, kind, id, html, title } = surface;

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

  return <iframe className="extension-surface" key={html} ref={frame} title={title}
    sandbox="allow-scripts" referrerPolicy="no-referrer"
    src={new URL('extension-webview.html', document.baseURI).href}
    onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'initialize', html }, '*')} />;
}
