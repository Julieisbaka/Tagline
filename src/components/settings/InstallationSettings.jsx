import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from '../dialogs/ModalBackdrop.jsx';

export default function InstallationSettings() {
  const { t } = useI18n();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [showUninstall, setShowUninstall] = useState(false);
  const [removeProfile, setRemoveProfile] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallError, setUninstallError] = useState('');
  const [uninstallMessage, setUninstallMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [release, setRelease] = useState(null);
  const [updateError, setUpdateError] = useState('');
  const [updateState, setUpdateState] = useState({ status: 'idle', received: 0, total: 0 });
  const [installMessage, setInstallMessage] = useState('');
  const updating = ['checking', 'downloading', 'installing'].includes(updateState.status);
  const openPage = async (page) => {
    setUpdateError('');
    try { await window.api.openProjectPage(page); }
    catch (failure) { setUpdateError(failure.message); }
  };
  const checkUpdates = async () => {
    setChecking(true); setUpdateError(''); setRelease(null);
    try { setRelease(await window.api.checkForUpdates()); }
    catch (failure) { setUpdateError(failure.message); }
    finally { setChecking(false); }
  };
  const downloadUpdate = async () => {
    setUpdateError(''); setInstallMessage('');
    try { setUpdateState(await window.api.downloadUpdate()); }
    catch (failure) { setUpdateError(failure.message); }
  };
  const installUpdate = async () => {
    setUpdateError('');
    try {
      const result = await window.api.installUpdate();
      if (result.manual) setInstallMessage(t('The disk image is open. Quit Tagline, drag the new app into Applications and choose Replace, then reopen Tagline. Your settings and vaults are kept.'));
    } catch (failure) { setUpdateError(failure.message); }
  };
  useEffect(() => {
    let active = true;
    const apply = (state) => {
      if (!active) return;
      setUpdateState(state);
      if (state.release) setRelease(state.release);
    };
    const unsubscribe = window.api.onUpdateState(apply);
    window.api.getUpdateState().then(apply).catch((failure) => { if (active) setUpdateError(failure.message); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    let active = true;
    window.api.getInstallationInfo().then((value) => { if (active) setInfo(value); })
      .catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const platforms = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const [copied, setCopied] = useState(false);
  const bugReport = info ? [
    '```',
    'Tagline-Report-Format: 1',
    `Version: ${info.version}`,
    `Build: ${info.packaged ? 'packaged' : 'development'}`,
    `OS: ${platforms[info.platform] || info.platform}`,
    `OS-Version: ${info.osVersion}`,
    `Architecture: ${info.arch}`,
    `Electron: ${info.electron}`,
    `Chromium: ${info.chromium}`,
    `Node.js: ${info.node}`,
    '```',
  ].join('\n') : '';
  const copyBugReport = async () => {
    try {
      await navigator.clipboard.writeText(bugReport);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (failure) { setError(failure.message); }
  };
  const startUninstall = async () => {
    setUninstalling(true);
    setUninstallError('');
    setUninstallMessage('');
    try {
      const result = await window.api.uninstallApp(removeProfile);
      if (result.manual) {
        setShowUninstall(false);
        setUninstallMessage(t(removeProfile
          ? 'The app location is open. Remove Tagline there; profile data will be removed after you quit.'
          : 'The app location is open. Remove Tagline there. Your profile data will be kept.'));
      }
    } catch (failure) {
      setUninstallError(failure.message);
    } finally {
      setUninstalling(false);
    }
  };
  return <div className="installation-settings">
    {error && <p role="alert">{error}</p>}
    {!info && !error && <p role="status">{t('Loading…')}</p>}
    {info && <dl className="installation-details">
      {[
        ['Version', info.version],
        ['Build type', t(info.packaged ? 'Packaged application' : 'Development build')],
        ['Operating system', `${platforms[info.platform] || info.platform} ${info.osVersion}`],
        ['Architecture', info.arch],
        ['Electron', info.electron],
        ['Chromium', info.chromium],
        ['Node.js', info.node],
        ['Application executable', info.executable],
        ['Profile folder', info.profile],
      ].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}
    </dl>}
    {info && <>
      <h3>{t('Bug report details')}</h3>
      <p>{t('Copy these details and paste them into the bug report. They contain no file paths or personal information.')}</p>
      <textarea readOnly rows={10} aria-label={t('Bug report details')} value={bugReport} onFocus={(event) => event.target.select()} />
      <div className="settings-actions">
        <button onClick={copyBugReport}>{t(copied ? 'Copied' : 'Copy bug report details')}</button>
      </div>
    </>}
    <h3>{t('Updates')}</h3>
    <p>{t('Tagline does not check for or install updates automatically.')}</p>
    <div className="settings-actions">
      <button disabled={checking || updating} aria-busy={checking || updateState.status === 'checking'} onClick={checkUpdates}>
        {t(checking ? 'Checking for updates…' : 'Check for updates')}
      </button>
      <button className="link-btn" onClick={() => openPage('repository')}>{t('GitHub repository')}</button>
      <button className="link-btn" onClick={() => openPage('releases')}>{t('View releases')}</button>
    </div>
    {release && <p role="status">{t(release.updateAvailable
      ? 'Version {version} is available.'
      : 'You are up to date (latest release: {version}).', { version: release.latestVersion })}</p>}
    {release?.updateAvailable && release.download && info?.packaged && <div className="settings-actions">
      {updateState.status !== 'ready' && <button disabled={updating} onClick={downloadUpdate}>
        {t(updateState.status === 'downloading' ? 'Downloading update…' : 'Download update')}
      </button>}
      {updateState.status === 'ready' && <button className="primary" disabled={updating} onClick={installUpdate}>
        {t(info.platform === 'win32' ? 'Install update and restart' : 'Open installer')}
      </button>}
    </div>}
    {updateState.status === 'downloading' && <div role="status" aria-live="polite">
      <label>{t('Downloading update…')}
        <progress aria-label={t('Update download progress')} max={updateState.total || 1} value={updateState.received} />
      </label>
      <span>{Math.round(updateState.received / (updateState.total || 1) * 100)}%</span>
    </div>}
    {updateState.status === 'installing' && <p role="status">{t('Saving pending edits and starting the installer…')}</p>}
    {release?.updateAvailable && !release.download && <p>{t('No compatible in-app download is available for this release. Use View releases to install it manually.')}</p>}
    {info && !info.packaged && <p>{t('In-app downloads are available only in a packaged installation. Use View releases to get an installer.')}</p>}
    {installMessage && <p role="status">{installMessage}</p>}
    {(updateError || updateState.error) && <p className="error-text" role="alert">{updateError || updateState.error}</p>}
    <p>{t('Download the matching installer here, then start installation. Downloads are verified against release checksums. Windows saves pending edits before exiting; on macOS, open the DMG and replace the app in Applications.')}</p>
    <p>{t('Keep your profile folder to preserve settings, themes, extensions, and downloaded models. Vaults and revision history remain in their own folders. Back up your profile and vaults before updating.')}</p>
    <h3>{t('Uninstall Tagline')}</h3>
    <p>{t('Choose whether to keep or remove your profile. Vaults and their revision history are always kept.')}</p>
    {uninstallMessage && <p role="status">{uninstallMessage}</p>}
    {uninstallError && <p className="error-text" role="alert">{uninstallError}</p>}
    <button className="danger" disabled={!info?.packaged || updating} onClick={() => {
      setUninstallError('');
      setRemoveProfile(false);
      setShowUninstall(true);
    }}>{t('Uninstall Tagline…')}</button>
    {!info?.packaged && info && <p>{t('Uninstall is available only in a packaged installation.')}</p>}
    {showUninstall && <ModalBackdrop className="modal-backdrop" onMouseDown={() => setShowUninstall(false)}>
      <div className="modal dialog uninstall-dialog" role="dialog" aria-modal="true"
        aria-labelledby="uninstall-title" onMouseDown={(event) => event.stopPropagation()}>
        <h3 id="uninstall-title">{t('Uninstall Tagline')}</h3>
        <p>{t('Your vault files and revision history are stored separately and will not be deleted.')}</p>
        <label>
          <input type="radio" name="uninstall-profile" checked={!removeProfile}
            onChange={() => setRemoveProfile(false)} />
          <span><strong>{t('Keep profile data')}</strong><small>{t('Keep settings, extensions, themes, and downloaded models.')}</small></span>
        </label>
        <label>
          <input type="radio" name="uninstall-profile" checked={removeProfile}
            onChange={() => setRemoveProfile(true)} />
          <span><strong>{t('Remove profile data')}</strong><small>{t('Delete settings, extensions, themes, and downloaded models too.')}</small></span>
        </label>
        {info.platform !== 'win32' && <p>{t('Your operating system requires you to remove the app manually after its location opens.')}</p>}
        {uninstallError && <p className="error-text" role="alert">{uninstallError}</p>}
        <div className="dialog-buttons">
          <button disabled={uninstalling} onClick={() => setShowUninstall(false)}>{t('Cancel')}</button>
          <button className="danger" disabled={uninstalling} onClick={startUninstall}>
            {t(uninstalling ? 'Starting…' : 'Continue')}
          </button>
        </div>
      </div>
    </ModalBackdrop>}
  </div>;
}
