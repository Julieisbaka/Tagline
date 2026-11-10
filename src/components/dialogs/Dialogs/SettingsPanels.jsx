import AdvancedSettings from '../../settings/AdvancedSettings.jsx';
import DEFAULTS from '../../../lib/defaultSettings.json';
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
import TemplateSettings from '../../settings/TemplateSettings.jsx';
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
        <SettingsGroup title={t('Timer auto-start')}>
          <SettingRow
            label={t('Use Web Speech API for automatic start')}
            description={t(
              'Detect speech with your browser speech recognition when automatic start is armed. May require internet access, can be less private, and may be unavailable on some systems. When off, Tagline uses on-device sound detection.'
            )}
          >
            <input
              type='checkbox'
              data-setting='timerAutoStartUseSpeechRecognition'
              checked={!!settings.timerAutoStartUseSpeechRecognition}
              onChange={(event) =>
                update({ timerAutoStartUseSpeechRecognition: event.target.checked })
              }
            />
          </SettingRow>
        </SettingsGroup>
        <TemplateSettings settings={settings} update={update} contents={contents} />
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
        <label className='setting-row'>
          <span>{t('Interaction sounds')}</span>
          <input
            type='checkbox'
            data-setting='interactionSounds'
            checked={settings.interactionSounds}
            onChange={(event) => update({ interactionSounds: event.target.checked })}
          />
        </label>
        <p className='settings-help'>
          {t('Play short sounds for opening notes, tabs, saving, and errors.')}
        </p>
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
            {Object.keys({ ...DEFAULTS.internalFlags, ...(settings.internalFlags || {}) }).map(
              (flag) => {
                const labels = {
                  visualNoticeDismissed: 'Visual editor notice dismissed',
                  hasSeenOnboarding: 'Has seen onboarding',
                };
                return (
                  <label className='setting-row' key={flag}>
                    <span>{t(labels[flag] || flag)}</span>
                    <input
                      type='checkbox'
                      data-flag={flag}
                      checked={!!settings.internalFlags?.[flag]}
                      onChange={(e) =>
                        update({
                          internalFlags: {
                            ...settings.internalFlags,
                            [flag]: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                );
              }
            )}
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
        <SettingsGroup title={t('All settings')}>
          {Object.entries(DEFAULTS).map(([key, defaultValue]) => {
            if (key === 'internalFlags') {
              return null;
            }
            const value = settings[key];
            if (typeof defaultValue === 'boolean') {
              return (
                <label className='setting-row' key={key}>
                  <span>{key}</span>
                  <input
                    type='checkbox'
                    data-setting={key}
                    checked={!!value}
                    onChange={(e) => update({ [key]: e.target.checked })}
                  />
                </label>
              );
            }
            if (typeof defaultValue === 'number') {
              return (
                <label className='setting-row' key={key}>
                  <span>{key}</span>
                  <input
                    type='number'
                    data-setting={key}
                    value={value ?? ''}
                    onChange={(e) => {
                      if (e.target.value !== '') {
                        update({ [key]: Number(e.target.value) });
                      }
                    }}
                  />
                </label>
              );
            }
            if (typeof defaultValue === 'string') {
              return (
                <label className='setting-row' key={key}>
                  <span>{key}</span>
                  <input
                    type='text'
                    data-setting={key}
                    value={value ?? ''}
                    onChange={(e) => update({ [key]: e.target.value })}
                  />
                </label>
              );
            }
            return (
              <label className='setting-row' key={key}>
                <span>{key}</span>
                <textarea
                  data-setting={key}
                  value={
                    typeof value === 'string'
                      ? value
                      : JSON.stringify(value ?? defaultValue ?? null, null, 2)
                  }
                  onChange={(e) => {
                    try {
                      update({ [key]: JSON.parse(e.target.value) });
                    } catch {
                      // Ignore invalid JSON while typing.
                    }
                  }}
                />
              </label>
            );
          })}
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