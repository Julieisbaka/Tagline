import { useEffect, useRef } from 'react';

import { citedUrls, normalizeCheckup, scanCards, vaultHealthReport } from './evidenceCheckup.js';
import { readStoredJson } from './storedJson.js';

export const LINK_ROT_KEY = 'tagline.linkRot';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const isState = (value) => !!value && typeof value === 'object';

/** Opt-in: weekly idle link check of cited URLs; writes a health report note. */
export function useLinkRotMonitor({ contents, createFile, vaultKey }) {
  const latest = useRef({ contents, createFile });
  latest.current = { contents, createFile };
  useEffect(() => {
    const state = readStoredJson(LINK_ROT_KEY, {}, isState);
    const key = vaultKey || '';
    if (!key || !state.enabled || Date.now() - (state.last?.[key] || 0) < WEEK) {
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const cards = scanCards(latest.current.contents);
        const urls = citedUrls(cards);
        if (!urls.length) {
          return;
        }
        const settings = normalizeCheckup(readStoredJson('tagline.evidenceCheckup', {}, isState));
        const results = await window.api.checkEvidenceLinks(urls, {
          timeoutSeconds: settings.linkTimeoutSeconds,
          archiveFallback: settings.archiveFallback,
        });
        const now = new Date();
        await latest.current.createFile(
          `Vault health report ${now.toISOString().slice(0, 10)}.md`,
          vaultHealthReport(cards, results, now)
        );
        const fresh = readStoredJson(LINK_ROT_KEY, {}, isState);
        localStorage.setItem(
          LINK_ROT_KEY,
          JSON.stringify({ ...fresh, last: { ...fresh.last, [key]: now.getTime() } })
        );
      } catch {
        // Background check; retry next launch.
      }
    }, 30_000);
    return () => clearTimeout(timer);
  }, [vaultKey]);
}
