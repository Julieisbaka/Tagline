import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

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
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      // Existing codebase uses single-statement blocks without braces.
      curly: 'warn',
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'react/jsx-uses-vars': 'error',
      'react-hooks/exhaustive-deps': 'warn',
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
