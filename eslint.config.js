import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Javora — lint configuration.
 *
 * Division of labour between the two checkers:
 *
 *   `npm run typecheck` (tsc --noEmit)  — owns every .ts/.tsx file. Strict mode
 *       covers correctness, unused values, unreachable code and exhaustiveness.
 *
 *   `npm run lint` (eslint)             — owns the .js/.jsx surface: the React
 *       components, hooks rules and general JS hygiene.
 *
 * TypeScript files are deliberately not linted by ESLint. `typescript-eslint`
 * declares a peer range of `>=4.8.4 <6.1.0` and this project is on TypeScript 7,
 * so wiring it in would require either forcing an unsupported resolution or
 * downgrading the compiler. Since `tsc` already checks those files under
 * `strict`, the coverage gap is stylistic only. Revisit once typescript-eslint
 * supports TypeScript 7.
 */
export default [
  // Build output and tool artefacts. `ds-bundle/` and `.ds-sync/` belong to the
  // design-sync tool: both are gitignored, both contain a vendored copy of React
  // and its own node_modules, and linting them produced 209 errors that had
  // nothing to do with this project's source. They regenerate on every design
  // sync, so ignoring them is the durable fix rather than deleting them once.
  {
    ignores: [
      'dist/**',
      'dist-ssr/**',
      'node_modules/**',
      'coverage/**',
      'ds-bundle/**',
      '.ds-sync/**',
      '**/*.ts',
      '**/*.tsx',
    ],
  },

  {
    files: ['**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  {
    files: ['**/*.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
