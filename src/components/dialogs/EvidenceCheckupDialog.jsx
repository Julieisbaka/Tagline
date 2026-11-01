import { useEffect, useMemo, useState } from 'react';
import {
  CITATION_FIELDS, DEFAULT_CHECKUP, annotateEvidence, auditCards, citedUrls, linkIssues, normalizeCheckup, scanCards, sourceIssues,
} from '../../lib/evidenceCheckup.js';
import { useI18n } from '../../lib/i18n.js';
import { readStoredJson } from '../../lib/storedJson.js';

import ModalBackdrop from './ModalBackdrop.jsx';

const STORAGE_KEY = 'tagline.evidenceCheckup';
const FIELD_LABELS = {
  author: 'Author', year: 'Year', title: 'Title', publication: 'Publication', url: 'URL', accessed: 'Access date',
};
const KIND_LABELS = {
  missing_citation: 'Missing citation', missing_fields: 'Incomplete citation', uncertain_fields: 'Uncertain citation fields',
  stale_date: 'Stale source date', dead_link: 'Dead link',
  source_mismatch: 'Possible source mismatch', source_unavailable: 'Source lookup unavailable',
  source_not_comparable: 'No comparable source fields',
};
const isSettings = (value) => !!value && typeof value === 'object';

/**
 * Scan dialog for citation problems. All settings live here, and link checks run only on demand.
 * @param {object} props
 * @param {function} props.onOpen - Opens a note by path.
 * @param {function} props.onClose - Closes the dialog.
 */
export default function EvidenceCheckupDialog({ contents, getContent, updateContent, flush, onOpen, onClose }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState(() => normalizeCheckup(readStoredJson(STORAGE_KEY, DEFAULT_CHECKUP, isSettings)));
  const [scan, setScan] = useState(null);
  const [links, setLinks] = useState(null);
  const [sources, setSources] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [addComments, setAddComments] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const update = (patch) => setSettings((current) => normalizeCheckup({ ...current, ...patch }));
  const updateChecks = (patch) => update({ checks: { ...settings.checks, ...patch } });
  const toggleField = (field) => {
    const fields = settings.requiredFields.includes(field)
      ? settings.requiredFields.filter((item) => item !== field) : [...settings.requiredFields, field];
    update({ requiredFields: fields });
  };

  const run = async (name, action) => {
    setBusy(name);
    setError('');
    setMessage('');
    try { await action(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const saveComments = async (files, cards, findings, categories) => {
    const updated = annotateEvidence(files, cards, findings, categories, describe);
    const paths = Object.keys(updated).filter((path) => updated[path] !== files[path]);
    if ([...new Set(cards.map((card) => card.path))].some((path) => getContent(path) !== files[path])) {
      throw new Error(t('Notes changed since the scan. Scan again before adding comments.'));
    }
    for (const path of paths) updateContent(path, updated[path]);
    if (paths.length && !await flush()) throw new Error(t('Could not save evidence checkup comments.'));
    if (paths.length) setMessage(t('Comments updated in {count} notes.', { count: paths.length }));
    return updated;
  };

  const scanVault = () => run('scan', async () => {
    let files = contents;
    const cards = scanCards(files);
    const findings = auditCards(cards, settings);
    if (addComments && (settings.checks.citations || settings.checks.stale)) {
      files = await saveComments(files, cards, findings, ['citation']);
    }
    setScan({ files, cards: scanCards(files), issues: auditCards(scanCards(files), settings) });
    setLinks(null);
    setSources(null);
  });

  const checkCitedLinks = () => run('links', async () => {
    const results = await window.api.checkEvidenceLinks(citedUrls(scan.cards), {
      timeoutSeconds: settings.linkTimeoutSeconds,
      archiveFallback: settings.archiveFallback,
    });
    if (addComments) {
      const files = await saveComments(scan.files, scan.cards, linkIssues(scan.cards, results), ['link']);
      const cards = scanCards(files);
      setScan({ files, cards, issues: auditCards(cards, settings) });
    }
    setLinks(results);
  });

  const compareSources = () => run('sources', async () => {
    const urls = citedUrls(scan.cards);
    const results = {};
    let next = 0;
    const worker = async () => {
      while (next < urls.length) {
        const url = urls[next++];
        try { results[url] = { metadata: await window.api.sourceCitationMetadata(url) }; }
        catch (error) { results[url] = { error: error.message }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
    if (scan.cards.some((card) => card.citation?.url && getContent(card.path) !== scan.files[card.path])) {
      throw new Error(t('Notes changed since the scan. Scan again before comparing sources.'));
    }
    if (addComments) {
      const findings = sourceIssues(scan.cards, results);
      const eligible = scan.cards.filter((card) => {
        const result = card.citation?.url && results[card.citation.url];
        return result && !result.error && !findings.some((issue) =>
          issue.path === card.path && issue.lineIndex === card.lineIndex && issue.kind === 'source_not_comparable');
      });
      const files = await saveComments(scan.files, eligible, findings, ['source']);
      const cards = scanCards(files);
      setScan({ files, cards, issues: auditCards(cards, settings) });
    }
    setSources(results);
  });

  const issues = useMemo(() => {
    if (!scan) return [];
    return [...scan.issues, ...(settings.checks.links && links ? linkIssues(scan.cards, links) : []),
    ...(sources ? sourceIssues(scan.cards, sources) : [])];
  }, [scan, links, sources, settings.checks.links]);

  const grouped = useMemo(() => {
    const byPath = new Map();
    for (const issue of issues) {
      if (!byPath.has(issue.path)) byPath.set(issue.path, []);
      byPath.get(issue.path).push(issue);
    }
    return [...byPath];
  }, [issues]);

  const linkCount = scan ? citedUrls(scan.cards).length : 0;
  const describe = (issue) => {
    if (issue.kind === 'missing_fields') return t('Missing {fields}.', {
      fields: issue.fields.map((field) => t(FIELD_LABELS[field])).join(', '),
    });
    if (issue.kind === 'uncertain_fields') return t('Review uncertain fields: {fields}.', {
      fields: issue.fields.map((field) => t(FIELD_LABELS[field])).join(', '),
    });
    if (issue.kind === 'stale_date') return t('Source from {year} is {age} years old (threshold {years}).', {
      year: issue.year, age: issue.age, years: issue.threshold,
    });
    if (issue.kind === 'dead_link') return t('Link no longer resolves ({reason}).', { reason: issue.reason });
    if (issue.kind === 'source_mismatch') return t('{field}: citation says “{citation}”; source metadata says “{source}”.', {
      field: t(FIELD_LABELS[issue.field]), citation: issue.citationValue, source: issue.sourceValue,
    });
    if (issue.kind === 'source_unavailable') return issue.reason;
    if (issue.kind === 'source_not_comparable') return t('No certain citation fields were available in the source metadata for comparison.');
    return t('No citation line.');
  };

  return (
    <ModalBackdrop className="modal-backdrop evidence-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div className="modal dialog evidence-checkup-dialog" role="dialog" aria-modal="true" aria-labelledby="evidence-checkup-title"
        onMouseDown={(e) => e.stopPropagation()}>
        <header className="evidence-header">
          <div className="evidence-eyebrow">{t('Research tools')}</div>
          <h3 id="evidence-checkup-title">{t('Evidence checkup')}</h3>
          <p className="hint">{t('Scan the vault for cards with missing citation fields, stale source dates, or links that no longer resolve.')}</p>
        </header>

        <fieldset className="evidence-settings" disabled={!!busy}>
          <legend>{t('Checks')}</legend>
          <div className="evidence-check">
            <label className="evidence-toggle">
              <input type="checkbox" checked={settings.checks.citations}
                onChange={(e) => updateChecks({ citations: e.target.checked })} />
              <span>{t('Check citation fields')}</span>
            </label>
            <fieldset className="evidence-fields" disabled={!settings.checks.citations}>
              <legend>{t('Required citation fields')}</legend>
              <div className="evidence-field-grid">
                {CITATION_FIELDS.map((field) => <label className="evidence-field" key={field}>
                  <input type="checkbox" checked={settings.requiredFields.includes(field)} onChange={() => toggleField(field)} />
                  <span>{t(FIELD_LABELS[field])}</span>
                </label>)}
              </div>
            </fieldset>
          </div>
          <div className="evidence-check">
            <label className="evidence-toggle">
              <input type="checkbox" checked={settings.checks.stale}
                onChange={(e) => updateChecks({ stale: e.target.checked })} />
              <span>{t('Flag stale source dates')}</span>
            </label>
            <div className="evidence-options">
              <label className="evidence-number">
                <span>{t('Older than (years)')}</span>
                <input type="number" min="1" max="100" value={settings.staleYears} disabled={!settings.checks.stale}
                  onChange={(e) => update({ staleYears: e.target.value })} />
              </label>
            </div>
          </div>
          <div className="evidence-check">
            <label className="evidence-toggle">
              <input type="checkbox" checked={settings.checks.links}
                onChange={(e) => updateChecks({ links: e.target.checked })} />
              <span>{t('Check cited links')}</span>
            </label>
            <div className="evidence-options">
              <label className="evidence-number">
                <span>{t('Timeout (seconds)')}</span>
                <input type="number" min="1" max="60" value={settings.linkTimeoutSeconds} disabled={!settings.checks.links}
                  onChange={(e) => update({ linkTimeoutSeconds: e.target.value })} />
              </label>
              <label className="evidence-field">
                <input type="checkbox" checked={settings.archiveFallback} disabled={!settings.checks.links}
                  onChange={(e) => update({ archiveFallback: e.target.checked })} />
                <span>{t('Look for archived copies of dead links')}</span>
              </label>
            </div>
          </div>
        </fieldset>
        <div className="evidence-comment-option">
          <label>
            <input type="checkbox" checked={addComments} disabled={!!busy}
              onChange={(e) => setAddComments(e.target.checked)} />
            <strong>{t('Add comments to affected cards')}</strong>
          </label>
          <p className="hint">{t('Writes Markdown comments into notes when you scan or check links. Existing checkup comments are refreshed; other comments are kept.')}</p>
        </div>
        <p className="hint evidence-privacy">{t('Link checks send requests to the cited sites. Dead links are reported only when the page returns 404 or 410, or its domain no longer exists.')}</p>
        <p className="hint evidence-privacy">{t('Compare sources sends citation URLs to their sites or Crossref. Only available, certain author, year, title, and publication fields are compared; differences require review.')}</p>

        <div className="dialog-buttons">
          <button disabled={!!busy} onClick={onClose}>{t('Close')}</button>
          <button disabled={!!busy} onClick={scanVault}>{t(busy === 'scan' ? 'Scanning...' : 'Scan vault')}</button>
          <button className="primary" disabled={!!busy || !scan || !settings.checks.links || !linkCount}
            onClick={checkCitedLinks}>{t(busy === 'links' ? 'Checking links...' : 'Check links')}</button>
          <button disabled={!!busy || !scan || !linkCount}
            onClick={compareSources}>{t(busy === 'sources' ? 'Comparing sources...' : 'Compare sources')}</button>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {scan && <p role="status">{t('{cards} cards scanned, {issues} issues found.', { cards: scan.cards.length, issues: issues.length })}
          {links && ` ${t('{count} links checked.', { count: linkCount })}`}</p>}
        {sources && <p role="status">{t('Source lookups completed for {count} URLs.', { count: Object.keys(sources).length })}</p>}
        {scan && !issues.length && <p>{t('No issues found.')}</p>}
        {grouped.map(([path, list]) => <section className="evidence-results" key={path}>
          <div className="evidence-results-header"><h4>{path}</h4>
            <button type="button" onClick={() => onOpen(path)}>{t('Open note')}</button></div>
          <ul>
            {list.map((issue, index) => <li key={`${issue.card}-${issue.kind}-${index}`}>
              <span className="evidence-result-kind">{t(KIND_LABELS[issue.kind])}</span>
              <strong>{issue.card}</strong>
              <span>{describe(issue)}</span>
              {issue.archiveUrl && <button type="button" onClick={() => window.api.websiteAction('external', issue.archiveUrl)
                .catch((e) => setError(e.message))}>{t('Archived copy')}</button>}
            </li>)}
          </ul>
        </section>)}
      </div>
    </ModalBackdrop>
  );
}
