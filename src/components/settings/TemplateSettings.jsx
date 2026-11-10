import { useI18n } from '../../lib/i18n.js';
import { isMarkdown } from '../../lib/vault.js';
import { templateBody } from '../../lib/template.js';
import SettingsGroup from './SettingsGroup.jsx';

export default function TemplateSettings({ settings, update, contents = {}, extensions }) {
  const { t } = useI18n();
  const folder = (settings.templateFolder || 'Templates').replace(/^\/+|\/+$/g, '');
  const prefix = `${folder.toLowerCase()}/`;
  const templates = Object.keys(contents)
    .filter((p) => p.toLowerCase().startsWith(prefix) && isMarkdown(p))
    .sort();
  const extensionTemplates = extensions?.templates ?? [];
  return (
    <SettingsGroup title={t('Templates')}>
      <label className='setting-row'>
        <span>{t('Template folder')}</span>
        <input
          type='text'
          data-setting='templateFolder'
          value={settings.templateFolder ?? 'Templates'}
          onChange={(event) => update({ templateFolder: event.target.value })}
          onBlur={(event) => update({ templateFolder: event.target.value.trim() || 'Templates' })}
        />
      </label>
      {templates.length || extensionTemplates.length ? (
        <ul className='template-list'>
          {templates.map((p) => (
            <li key={p}>
              {p}
              {templateBody(contents[p] || '').hasFrontmatter ? ` (${t('has properties')})` : ''}
            </li>
          ))}
          {extensionTemplates.map((template) => (
            <li key={template.id}>
              {template.extensionName}: {template.title}
              {templateBody(template.content || '').hasFrontmatter
                ? ` (${t('has properties')})`
                : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className='settings-help'>{t('No templates found in this folder.')}</p>
      )}
      <p className='settings-help'>
        {t(
          'Placeholders: {{date}}, {{time}}, {{title}}, {{path}}, {{content}}, {{properties}}. Use {{date:YYYY-MM-DD}} or {{time:hh:mm A}} for custom formats; wrap literal text in [brackets].'
        )}
      </p>
      {extensionTemplates.length > 0 && (
        <p className='settings-help'>
          {t('Extension templates are bundled and disappear when their extension is disabled.')}
        </p>
      )}
    </SettingsGroup>
  );
}
