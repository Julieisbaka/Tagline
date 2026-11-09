import AdvancedSettings from '../../settings/AdvancedSettings.jsx';
import CustomCssSettings from '../../settings/CustomCssSettings.jsx';
import CustomizationLimits from '../../settings/CustomizationLimits.jsx';
import EditorSettings from '../../settings/EditorSettings.jsx';
import DictionarySettings from '../../settings/DictionarySettings.jsx';
import SettingsGroup from '../../settings/SettingsGroup.jsx';
import ExtensionSettings from '../../settings/ExtensionSettings.jsx';
import InstallationSettings from '../../settings/InstallationSettings.jsx';
import IntegrationSettings from '../../settings/IntegrationSettings.jsx';
import KeybindingSettings from '../../settings/KeybindingSettings.jsx';
import OpenCaselistSettings from '../../settings/OpenCaselistSettings.jsx';
import TournamentLinks from '../../settings/TournamentLinks.jsx';
import ReadingSettings from '../../settings/ReadingSettings.jsx';
import RibbonSettings from '../../settings/RibbonSettings.jsx';
import SettingRow from '../../settings/SettingRow.jsx';
import ThemeSettings from '../../settings/ThemeSettings.jsx';
import TimerSoundSettings from '../../settings/TimerSoundSettings.jsx';

export default function SettingsPanels({
  contentRef,
  terms,
  section,
  t,
  settings,
  update,
  field,
  speechDoc,
  speechDocuments,
  onSelectSpeechDoc,
  contents,
  extensions,
  onOpenCaselist,
  onOpenTabroom,
  platform,
  onClose,
}) {
  return (
    <div className='settings-content' ref={contentRef} hidden={terms.length > 0}>
      <section
        data-settings-panel='general'
        hidden={section !== 'general'}
        className='settings-panel'
      >
        <SettingsGroup title={t('Speech settings')}>
          {field('Speaking rate (weighted syllables per minute)', 'syllablesPerMinute', 'number', {
            min: 75,
            max: 1500,
          })}
          <label className='setting-row'>
            <span>{t('Active speech document')}</span>
            <select
              data-setting='speechDoc'
              value={speechDoc}
              onChange={(event) => onSelectSpeechDoc(event.target.value)}
            >
              {[...new Set([speechDoc, ...speechDocuments])].filter(Boolean).map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
        </SettingsGroup>
        <ReadingSettings settings={settings} update={update} contents={contents} />
        <TimerSoundSettings settings={settings} update={update} />
        <p className='settings-help'>
          {t(
            'Speech documents use speech: true in YAML frontmatter. Right-click a Markdown file and choose Set as speech doc to make it active.'
          )}
        </p>
      </section>
      <section
        data-settings-panel='editors'
        hidden={section !== 'editors'}
        className='settings-panel'
      >
        <EditorSettings settings={settings} update={update} />
        <DictionarySettings />
      </section>
      <section
        data-settings-panel='accessibility'
        hidden={section !== 'accessibility'}
        className='settings-panel'
      >
        <SettingsGroup title={t('Accessibility')} collapsible={false}>
          <label className='setting-row'>
            <span>{t('Emphasize editor focus outline')}</span>
            <input
              type='checkbox'
              data-setting='editorFocusOutline'
              checked={settings.editorFocusOutline}
              onChange={(event) => update({ editorFocusOutline: event.target.checked })}
            />
          </label>
          <p className='settings-help'>
            {t(
              'Use a thicker outline for the focused note editor. Basic keyboard focus remains visible.'
            )}
          </p>
          {[
            ['Reduce motion', 'reduceMotion', 'Minimize interface animations and transitions.'],
            [
              'Disable animations',
              'disableAnimations',
              'Disable interface animations and transitions.',
            ],
            [
              'Stronger keyboard focus indicators',
              'strongFocusIndicators',
              'Make the keyboard-focused control easier to see.',
            ],
            [
              'Larger interface text',
              'largerInterfaceText',
              'Enlarge application labels and menus without changing the editor font size.',
            ],
            [
              'Larger buttons and click targets',
              'largerClickTargets',
              'Increase the size of controls to make them easier to activate.',
            ],
            [
              'Always underline links',
              'underlineLinks',
              'Keep links underlined so they are recognizable without relying on color.',
            ],
          ].map(([label, key, description]) => (
            <SettingRow key={key} label={t(label)} description={t(description)}>
              <input
                type='checkbox'
                data-setting={key}
                checked={settings[key]}
                onChange={(event) => update({ [key]: event.target.checked })}
              />
            </SettingRow>
          ))}
        </SettingsGroup>
        <p className='settings-help'>
          {t(
            'Reduce motion also follows your system preference. Larger targets are at least 48 pixels. Stronger focus includes note editors.'
          )}
        </p>
      </section>
      <section
        data-settings-panel='appearance'
        hidden={section !== 'appearance'}
        className='settings-panel'
      >
        <SettingsGroup title={t('Theme and typography')}>
          <ThemeSettings settings={settings} update={update} />
        </SettingsGroup>
        <AdvancedSettings settings={settings} update={update} section='fonts' />
        <CustomCssSettings settings={settings} update={update} />
      </section>
      <section
        data-settings-panel='performance'
        hidden={section !== 'performance'}
        className='settings-panel'
      >
        <AdvancedSettings settings={settings} update={update} section='performance' />
      </section>
      <section data-settings-panel='files' hidden={section !== 'files'} className='settings-panel'>
        <AdvancedSettings settings={settings} update={update} section='files' />
        <p className='settings-help'>{platform.flowAssociation}</p>
      </section>
      <section
        data-settings-panel='workspace'
        hidden={section !== 'workspace'}
        className='settings-panel'
      >
        <RibbonSettings
          settings={settings}
          update={update}
          contributions={extensions?.ribbonItems}
        />
        <AdvancedSettings settings={settings} update={update} section='workspace' />
      </section>
      <section
        data-settings-panel='history'
        hidden={section !== 'history'}
        className='settings-panel'
      >
        <AdvancedSettings settings={settings} update={update} section='history' />
      </section>
      <section
        data-settings-panel='integrations'
        hidden={section !== 'integrations'}
        className='settings-panel'
      >
        <SettingsGroup title={t('Tabroom')}>
          <div className='settings-integration-entry'>
            <p>
              {t(
                'View tournament data by ID or URL and save its JSON backup. Optional sign-in uses your Tabroom permissions.'
              )}
            </p>
            <div className='integration-buttons'>
              <button onClick={onOpenTabroom}>{t('Open Tabroom')}</button>
            </div>
          </div>
        </SettingsGroup>
        <SettingsGroup title={t('OpenCaselist')}>
          <div className='settings-integration-entry'>
            <p>
              {t(
                'Browse disclosures, download files, and publish changes using your OpenCaselist account.'
              )}
            </p>
            <div className='integration-buttons'>
              <button onClick={onOpenCaselist}>{t('Open OpenCaselist')}</button>
            </div>
          </div>
        </SettingsGroup>
        <TournamentLinks />
        <SettingsGroup title={t('OpenCaselist settings')}>
          <OpenCaselistSettings />
        </SettingsGroup>
        <SettingsGroup title={t('Website behavior')}>
          <label className='setting-row'>
            <span>{t('Open websites inside Tagline')}</span>
            <input
              type='checkbox'
              data-setting='embedWebsites'
              checked={settings.embedWebsites}
              onChange={(e) => update({ embedWebsites: e.target.checked })}
            />
          </label>
          <p>
            {t(
              'Websites use a separate session and identify as Chrome. Disable to use your default browser.'
            )}
          </p>
        </SettingsGroup>
        <IntegrationSettings settings={settings} />
      </section>
      <section
        data-settings-panel='shortcuts'
        hidden={section !== 'shortcuts'}
        className='settings-panel'
      >
        <KeybindingSettings
          settings={settings}
          update={update}
          extra={extensions?.commands || []}
        />
      </section>
      <section
        data-settings-panel='extensions'
        hidden={section !== 'extensions'}
        className='settings-panel'
      >
        {extensions && <ExtensionSettings extensions={extensions} />}
      </section>
      <section
        data-settings-panel='advanced'
        hidden={section !== 'advanced'}
        className='settings-panel'
      >
        <CustomizationLimits settings={settings} />
        <SettingsGroup title={t('Internal flags')}>
          <section className='internal-flags'>
            <p>{t('These flags record workspace state and dismissed notices.')}</p>
            <label className='setting-row'>
              <span>{t('Visual editor notice dismissed')}</span>
              <input
                type='checkbox'
                data-flag='visualNoticeDismissed'
                checked={!!settings.internalFlags?.visualNoticeDismissed}
                onChange={(e) =>
                  update({
                    internalFlags: {
                      ...settings.internalFlags,
                      visualNoticeDismissed: e.target.checked,
                    },
                  })
                }
              />
            </label>
            <label className='setting-row'>
              <span>{t('Has seen onboarding')}</span>
              <input
                type='checkbox'
                data-flag='hasSeenOnboarding'
                checked={!!settings.internalFlags?.hasSeenOnboarding}
                onChange={(event) =>
                  update({
                    internalFlags: {
                      ...settings.internalFlags,
                      hasSeenOnboarding: event.target.checked,
                    },
                  })
                }
              />
            </label>
            <button
              onClick={() => {
                update({
                  internalFlags: { ...settings.internalFlags, hasSeenOnboarding: false },
                });
                onClose();
              }}
            >
              {t('Show onboarding again')}
            </button>
          </section>
        </SettingsGroup>
      </section>
      <section
        data-settings-panel='installation'
        hidden={section !== 'installation'}
        className='settings-panel'
      >
        <InstallationSettings />
      </section>
    </div>
  );
}
