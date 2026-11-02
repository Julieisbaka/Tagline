import globals from 'globals';

export default [
  {
    files: ['**/*.{js,jsx,cjs,mjs}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Existing codebase uses single-statement blocks without braces and == in
      // places; keep as warnings so lint passes while still flagging them.
      'curly': 'warn',
      'eqeqeq': ['warn', 'always'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // CommonJS files (tests, scripts, electron main/preload).
    files: ['tests/**/*.cjs', 'scripts/**/*.cjs', 'electron/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
];
