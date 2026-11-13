// Declarative registry for every user-facing setting. This is the single
// source the settings UI renders from: adding a key to defaultSettings.json
// automatically exposes it in the advanced "All settings" list (inferred
// control), and giving it an entry here upgrades it to a curated row with
// label, description, constraints and help notes.

export const SETTING_GROUPS = [
  {
    section: 'performance',
    title: 'Performance and search',
    collapsibleWhenAll: true,
    items: [
      {
        key: 'lowResourceMode',
        type: 'lowResourceMode',
        label: 'Low-resource mode',
        description:
          'Disable model autoload and cap the cache at 8 entries and 2,000,000 characters, and search at 20 results. Previous preferences return when disabled.',
        activeNote: 'Low-resource caps are active. Saved values below may exceed these limits.',
      },
      {
        key: 'visualCacheEntries',
        type: 'number',
        label: 'Maximum visual cache entries (0 disables)',
        description: 'Rendered documents kept in memory for faster reopening.',
        min: 0,
        max: 256,
      },
      {
        key: 'visualCacheCharacters',
        type: 'number',
        label: 'Maximum visual cache characters',
        description: 'Maximum text size in the visual editor cache.',
        min: 0,
        max: 100_000_000,
      },
      {
        key: 'disposeCodeMirrorViews',
        type: 'checkbox',
        label: 'Dispose inactive CodeMirror views',
        description: 'Release editor views that are no longer visible to save memory.',
      },
      {
        key: 'markdownCacheEntries',
        type: 'number',
        label: 'Maximum markdown cache entries (0 disables)',
        description: 'Rendered Markdown documents kept in memory for faster reopening.',
        min: 0,
        max: 256,
      },
      {
        key: 'undoHistoryLimit',
        type: 'number',
        label: 'Maximum undo history entries',
        description: 'Older undo steps are pruned above this limit.',
        min: 0,
        max: 10000,
      },
      {
        key: 'searchMaxResults',
        type: 'number',
        label: 'Maximum search results',
        description: 'Maximum matches returned by vault search.',
        min: 1,
        max: 1000,
      },
    ],
  },
  {
    section: 'fonts',
    title: 'Custom fonts',
    actions: 'fonts',
    items: [
      {
        key: 'fontFamily',
        type: 'fontFamily',
        label: 'Installed font family',
        placeholder: 'Georgia',
      },
    ],
    notes: ['Fonts apply to note text. Import only trusted, licensed fonts.'],
  },
  {
    section: 'files',
    title: 'Folder paths',
    items: [
      {
        key: 'underscoreFolders',
        type: 'checkbox',
        label: 'Use underscores for spaces in folder paths',
      },
    ],
  },
  {
    section: 'files',
    title: 'File names',
    items: [
      {
        key: 'hideFlowExtension',
        type: 'checkbox',
        label: 'Hide .flow file extension',
        description: 'Hide the suffix without renaming files.',
      },
      {
        key: 'showMarkdownExtension',
        type: 'checkbox',
        invert: true,
        label: 'Hide .md file extension',
        description: 'Hide the suffix without renaming files.',
      },
    ],
  },
  {
    section: 'files',
    title: 'Links',
    items: [
      {
        key: 'autoRelink',
        type: 'checkbox',
        label: 'Update wiki links on rename',
        description: 'Update links in other notes when a file or folder is renamed.',
      },
    ],
  },
  {
    section: 'workspace',
    title: 'Workspace tabs',
    items: [
      {
        key: 'closeMissingTabs',
        type: 'checkbox',
        label: 'Close tabs when files disappear externally',
        notes: [
          'Deleting files in Tagline always closes their tabs. Kept tabs show a notice until the file returns.',
        ],
      },
      {
        key: 'persistWorkspaceTabs',
        type: 'checkbox',
        label: 'Save workspace tabs',
        notes: ['When disabled, open tabs are not saved. Saved workspaces return when re-enabled.'],
      },
    ],
  },
  {
    section: 'history',
    title: 'Revision history',
    collapsibleWhenAll: true,
    items: [
      {
        key: 'historyRetention',
        type: 'number',
        label: 'Maximum saved revisions per document',
        description: 'Older revisions are pruned above this limit.',
        min: 1,
        max: 5000,
      },
      {
        key: 'experimentalHistoryDeltas',
        type: 'checkbox',
        label: 'Delta revision history (experimental)',
        notes: [
          'Off by default. Saves smaller changes as deltas with periodic full snapshots. Existing revisions remain readable when disabled. Damaged dependencies can affect several revisions.',
        ],
      },
      {
        key: 'canvasHistoryMode',
        type: 'select',
        label: 'Canvas history mode',
        options: [
          { value: 'complete', label: 'Complete (JSON and layout)' },
          { value: 'data', label: 'Data (shared latest layout)' },
        ],
        notes: [
          'Data history saves content changes only. Restoring uses the latest positions and sizes; moving nodes does not create revisions.',
          'Older revisions are removed after the next document change. History is stored in each vault under .tagline/history.',
        ],
      },
    ],
  },
];

// Curated metadata for keys that are not rendered as standalone rows above.
const EXTRA_META = [
  { key: 'importedFont', type: 'checkbox', label: 'Imported custom font is active' },
  {
    key: 'developerMode',
    type: 'checkbox',
    label: 'Developer mode',
    description: 'Enables developer tools and diagnostics. For now, does nothing.',
  },
];

export const SETTING_META = Object.freeze(
  Object.fromEntries(
    [...SETTING_GROUPS.flatMap((group) => group.items), ...EXTRA_META].map((item) => [
      item.key,
      item,
    ])
  )
);

export const INTERNAL_FLAG_LABELS = Object.freeze({
  visualNoticeDismissed: 'Visual editor notice dismissed',
  hasSeenOnboarding: 'Has seen onboarding',
});

/**
 * Infer a control type from a default value's type.
 * @param {*} value - The default value from defaultSettings.json.
 * @returns {'checkbox'|'number'|'text'|'json'} The inferred control type.
 */
export function inferSettingType(value) {
  if (typeof value === 'boolean') {
    return 'checkbox';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'string') {
    return 'text';
  }
  return 'json';
}

/**
 * Resolve the definition to render for a settings key: curated metadata when
 * present, otherwise an inferred definition from the key's default value.
 * @param {string} key - The settings key.
 * @param {*} defaultValue - The key's default value.
 * @returns {object} The definition to render.
 */
export function settingDefinition(key, defaultValue) {
  return (
    SETTING_META[key] ?? { key, type: inferSettingType(defaultValue), label: key, defaultValue }
  );
}
