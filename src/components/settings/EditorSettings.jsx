import { useI18n } from '../../lib/i18n.js';
import SettingRow from './SettingRow.jsx';
import SettingsGroup from './SettingsGroup.jsx';

export default function EditorSettings({ settings, update }) {
  const { t } = useI18n();
  const checkbox = (label, key, description) =>
    description ? (
      <SettingRow label={t(label)} description={t(description)}>
        <input
          type='checkbox'
          data-setting={key}
          checked={settings[key]}
          onChange={(event) => update({ [key]: event.target.checked })}
        />
      </SettingRow>
    ) : (
      <label className='setting-row'>
        <span>{t(label)}</span>
        <input
          type='checkbox'
          data-setting={key}
          checked={settings[key]}
          onChange={(event) => update({ [key]: event.target.checked })}
        />
      </label>
    );
  return (
    <section className='editor-settings'>
      <SettingsGroup title={t('Note editor')}>
        <SettingRow
          label={t('Default editor')}
          description={t('Initial editing mode for Markdown notes.')}
        >
          <select
            data-setting='editorMode'
            value={settings.editorMode}
            onChange={(event) => update({ editorMode: event.target.value })}
          >
            <option value='visual'>{t('Visual (Tiptap)')}</option>
            <option value='edit'>{t('Source (CodeMirror)')}</option>
          </select>
        </SettingRow>
        <SettingRow
          label={t('Readable line width')}
          description={t('Limit note text to the width below.')}
        >
          <input
            type='checkbox'
            data-setting='readableWidth'
            checked={settings.readableWidth}
            onChange={(event) => update({ readableWidth: event.target.checked })}
          />
        </SettingRow>
        <SettingRow label={t('Editor font size')} description={t('Font size for note text.')}>
          <input
            type='number'
            data-setting='fontSize'
            min='10'
            max='32'
            step='1'
            value={settings.fontSize}
            onChange={(event) => {
              if (event.target.validity.valid && event.target.value !== '') {
                update({ fontSize: Number(event.target.value) });
              }
            }}
          />
        </SettingRow>
        {checkbox(
          'Show formatting toolbar',
          'visualToolbar',
          'Show formatting buttons above the visual editor.'
        )}
        {checkbox(
          'Visual editor spellcheck',
          'visualSpellcheck',
          'Underline possible spelling mistakes in the visual editor.'
        )}
        <label className='setting-row'>
          <span>{t('Readable content width (pixels)')}</span>
          <input
            type='number'
            data-setting='readableWidthPixels'
            min='400'
            max='1600'
            step='20'
            value={settings.readableWidthPixels}
            onChange={(event) => {
              if (event.target.validity.valid && event.target.value !== '') {
                update({ readableWidthPixels: Number(event.target.value) });
              }
            }}
          />
        </label>
        <p className='settings-help'>
          {t(
            'Applies to visual, source and reading modes when Readable line width is enabled above.'
          )}
        </p>
        <SettingRow
          label={t('Editor line height')}
          description={t('Spacing between lines of note text.')}
        >
          <input
            type='number'
            data-setting='visualLineHeight'
            min='1'
            max='2.5'
            step='0.05'
            value={settings.visualLineHeight}
            onChange={(event) => {
              if (event.target.validity.valid && event.target.value !== '') {
                update({ visualLineHeight: Number(event.target.value) });
              }
            }}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('Flow creation')}>
        {checkbox('Separate negative block in new flows (2NC and 1NR)', 'separateNegativeBlock')}
        <p className='settings-help'>
          {t('Only affects new flows; existing flows and sheets are unchanged.')}
        </p>
        <SettingRow
          label={t('Focus new flow rows')}
          description={t('Move the cursor into a newly added flow row.')}
        >
          <input
            type='checkbox'
            data-setting='focusNewFlowRow'
            checked={settings.focusNewFlowRow}
            onChange={(event) => update({ focusNewFlowRow: event.target.checked })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('Flow editor')}>
        <SettingRow
          label={t('Default editor')}
          description={t('Initial editing mode for flow files.')}
        >
          <select
            data-setting='flowEditorMode'
            value={settings.flowEditorMode}
            onChange={(event) => update({ flowEditorMode: event.target.value })}
          >
            <option value='visual'>{t('Visual')}</option>
            <option value='edit'>{t('JSON source')}</option>
          </select>
        </SettingRow>
        {checkbox(
          'Flow editor spellcheck',
          'flowSpellcheck',
          'Underline possible spelling mistakes in flow cells, sheet names, and column headings.'
        )}
      </SettingsGroup>
      <SettingsGroup title={t('Canvas editor')}>
        <SettingRow
          label={t('Default editor')}
          description={t('Initial editing mode for canvas files.')}
        >
          <select
            data-setting='canvasEditorMode'
            value={settings.canvasEditorMode}
            onChange={(event) => update({ canvasEditorMode: event.target.value })}
          >
            <option value='visual'>{t('Visual')}</option>
            <option value='edit'>{t('JSON source')}</option>
          </select>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('Source editor (CodeMirror)')}>
        {checkbox(
          'Source editor spellcheck',
          'sourceSpellcheck',
          'Underline possible mistakes in Markdown source. Visual spellcheck is separate.'
        )}
        {checkbox(
          'Show line numbers',
          'sourceLineNumbers',
          'Show a numbered gutter beside source text.'
        )}
        {checkbox(
          'Wrap long lines',
          'sourceLineWrapping',
          'Fit long source lines to the editor width without changing the file.'
        )}
        {checkbox(
          'Highlight active line',
          'sourceActiveLine',
          'Shade the source line containing the cursor.'
        )}
        {checkbox(
          'Highlight other occurrences of selected text',
          'sourceSelectionMatches',
          'Mark matching text elsewhere in the source editor when you select a word.'
        )}
        {checkbox(
          'Show autocomplete suggestions',
          'sourceAutocomplete',
          'Suggest completions as you type in source editors.'
        )}
        <SettingRow
          label={t('Tab size')}
          description={t('Number of columns per tab in source editors.')}
        >
          <input
            type='number'
            data-setting='sourceTabSize'
            min='1'
            max='8'
            step='1'
            value={settings.sourceTabSize}
            onChange={(event) => {
              if (event.target.validity.valid && event.target.value !== '') {
                update({ sourceTabSize: Number(event.target.value) });
              }
            }}
          />
        </SettingRow>
        {checkbox(
          'Indent with tabs instead of spaces',
          'sourceIndentWithTabs',
          'Use tab characters for new indentation instead of spaces.'
        )}
        {checkbox(
          'Highlight matching brackets',
          'sourceBracketMatching',
          'Mark the matching bracket beside the cursor.'
        )}
        {checkbox(
          'Automatically close brackets',
          'sourceCloseBrackets',
          'Insert a matching closing bracket or quote as you type.'
        )}
        {checkbox(
          'Enable code folding',
          'sourceCodeFolding',
          'Collapse and expand supported sections using the source gutter.'
        )}
      </SettingsGroup>
    </section>
  );
}
