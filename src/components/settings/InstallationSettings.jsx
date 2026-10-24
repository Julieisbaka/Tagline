import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

export default function InstallationSettings() {
  const { t } = useI18n();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    window.api.getInstallationInfo().then((value) => { if (active) setInfo(value); })
      .catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const platforms = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
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
  </div>;
}
