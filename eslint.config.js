import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

/**
 * The rules worth having on a codebase this size, and nothing else.
 *
 * Deliberately not a style guide: Prettier settles formatting, and a linter
 * arguing about it only produces noise somebody learns to scroll past. What is
 * here catches things that are actually wrong — a hook with a dependency it does
 * not declare, a promise nobody waits for, a variable that is never read. That is
 * the class of bug this application has actually shipped.
 *
 * Type-aware rules run over the application and its tests, which is what the
 * tsconfig covers. The build scripts and the no-install server are plain Node
 * files outside it, and get the syntactic rules only.
 */
const off = (...names) => Object.fromEntries(names.map((n) => [n, 'off']));

export default ts.config(
  {
    ignores: ['dist/**', 'standalone/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'public/**', '**/*.tmp.*'],
  },
  js.configs.recommended,

  // --- the application and its tests: everything the tsconfig knows about ---
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'tests-ui/**/*.ts'],
    extends: [...ts.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json'], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // A floating promise is how a save silently does not happen.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      /*
       * Turned off on purpose.
       *
       * The `unsafe-*` family fires on every boundary where untyped data enters —
       * the spreadsheet library, the File System Access API, JSON off disk — and
       * those boundaries are exactly where the code already validates by hand.
       * The React Compiler rules shipped with the hooks plugin report optimisations
       * it declined to make, which is advice about a compiler this build does not
       * run. Neither set describes a defect.
       */
      ...off(
        '@typescript-eslint/no-unsafe-assignment',
        '@typescript-eslint/no-unsafe-member-access',
        '@typescript-eslint/no-unsafe-argument',
        '@typescript-eslint/no-unsafe-call',
        '@typescript-eslint/no-unsafe-return',
        '@typescript-eslint/restrict-template-expressions',
        '@typescript-eslint/no-base-to-string',
        'react-hooks/set-state-in-effect',
        'react-hooks/incompatible-library',
        'react-hooks/immutability',
        'react-hooks/preserve-manual-memoization',
        'react-hooks/purity',
        'react-hooks/refs',
        'react-hooks/static-components',
        'react-hooks/unsupported-syntax',
        'react-hooks/config',
        'react-hooks/error-boundaries',
        'react-hooks/gating',
        'react-hooks/globals',
        'react-hooks/use-memo',
        'react-hooks/component-hook-factories',
        'react-hooks/invariant',
        'react-hooks/no-deriving-state-in-effects',
        'react-hooks/fbt',
        'react-hooks/fire',
      ),
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  /*
   * The in-memory adapter implements an interface whose every method returns a
   * promise, because the other two adapters genuinely do the work asynchronously.
   * Its methods have nothing to await, and that is the point of it.
   */
  {
    files: ['src/storage/memoryAdapter.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },

  // Tests say what they mean; an assertion that reads as documentation stays.
  {
    files: ['tests/**/*.ts', 'tests-ui/**/*.ts'],
    rules: {
      ...off(
        '@typescript-eslint/no-unnecessary-type-assertion',
        '@typescript-eslint/require-await',
        '@typescript-eslint/no-floating-promises',
        'no-useless-assignment',
      ),
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },

  // --- plain Node: the build scripts and the no-install server ---
  {
    files: ['scripts/**/*.{js,mjs}', 'server/**/*.{js,mjs}', '*.config.js'],
    languageOptions: { sourceType: 'module', ecmaVersion: 2023 },
    rules: off('no-undef'),
  },

  // The build's own TypeScript, parsed but not type-checked: it is config, not app.
  {
    files: ['*.config.ts', 'scripts/**/*.ts'],
    extends: [...ts.configs.recommended],
    rules: off('no-undef', '@typescript-eslint/no-unnecessary-type-assertion'),
  },
);
