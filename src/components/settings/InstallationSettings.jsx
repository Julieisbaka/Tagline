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
  useEffect(() => {
    let active = true;
    window.api.getInstallationInfo().then((value) => { if (active) setInfo(value); })
      .catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const platforms = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
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
    <h3>{t('Manual updates')}</h3>
    <p>{t('Tagline does not check for or install updates automatically.')}</p>
    <p>{t('Quit Tagline before updating. On Windows, run the newer installer using the same install scope and location. On macOS, replace Tagline in Applications.')}</p>
    <p>{t('Keep your profile folder to preserve settings, themes, extensions, and downloaded models. Vaults and revision history remain in their own folders. Back up your profile and vaults before updating.')}</p>
    <h3>{t('Uninstall Tagline')}</h3>
    <p>{t('Choose whether to keep or remove your profile. Vaults and their revision history are always kept.')}</p>
    {uninstallMessage && <p role="status">{uninstallMessage}</p>}
    {uninstallError && <p className="error-text" role="alert">{uninstallError}</p>}
    <button className="danger" disabled={!info?.packaged} onClick={() => {
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
