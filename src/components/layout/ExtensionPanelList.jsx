import { useI18n } from '../../lib/i18n.js';
import ExtensionSurface from '../ExtensionSurface.jsx';

export default function ExtensionPanelList({ extensions, placement, activePath, mode }) {
  const { t } = useI18n();
  return (extensions?.surfaces || [])
    .filter((surface) => {
      const when = surface.when;
      return (
        surface.kind === 'panels' &&
        surface.placement === placement &&
        surface.visible &&
        (!when?.extensions || !when.extensions.length || when.extensions.includes(activePath?.match(/\.[^.]+$/)?.[0]?.toLowerCase())) &&
        (!when?.mode || when.mode === mode)
      );
    })
    .map((surface) => (
      <section className={`extension-panel extension-panel-${placement}`} key={`${surface.host.manifest.id}:${surface.id}`}>
        <header>
          <strong>{surface.title}</strong>
          <button aria-label={t('Close')} onClick={() => extensions.closeSurface(surface)}>
            &times;
          </button>
        </header>
        <ExtensionSurface surface={surface} onClose={extensions.closeSurface} />
      </section>
    ));
}
