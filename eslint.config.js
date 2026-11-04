import './eslint-typescript6-hook.js'; // must stay first: gives typescript-eslint the TS 6 API (see that file)
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import { createNodeResolver, flatConfigs as importConfigs } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = ['**/*.{js,mjs,cjs}', '**/*.{ts,tsx}'];
const typedFiles = ['**/*.{ts,tsx}'];
const plainJsFiles = ['**/*.{js,mjs,cjs}'];
const clientFiles = ['src/client/**/*.{ts,tsx}'];
const workerFiles = ['src/worker/**/*.ts'];

export default defineConfig([
  globalIgnores([
    'dist',
    'node_modules',
    '.wrangler',
    'drizzle', // generated migrations + meta
    'public',
    'tsconfig.tsbuildinfo',
    'vite.verify.config.ts' // temporary
  ]),

  {
    name: 'edging-mail/linter-options',
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' }
  },

  // ---------------------------------------------------------------------------------------------------------------
  // Everything: ESLint core + imports + unicorn
  // ---------------------------------------------------------------------------------------------------------------
  {
    name: 'edging-mail/base',
    files: sourceFiles,
    extends: [js.configs.recommended, importConfigs.recommended, unicorn.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    settings: {
      // import-x's own node resolver with TS extensions: enough for relative imports (cycles, self-imports, duplicates),
      // and it avoids eslint-import-resolver-typescript. Bare specifiers are tsc's job.
      'import-x/extensions': ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs'],
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import-x/resolver-next': [
        createNodeResolver({ extensions: ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs', '.json'] })
      ]
    },
    rules: {
      // Correctness / hard rules
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'object-shorthand': ['error', 'always'],
      'no-param-reassign': ['error', { props: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-alert': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-return-assign': ['error', 'always'],
      'no-sequences': 'error',
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-multi-assign': 'error',
      'no-void': ['error', { allowAsStatement: true }],
      'no-promise-executor-return': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-constructor-return': 'error',
      'array-callback-return': ['error', { checkForEach: true }],
      'default-case-last': 'error',
      'grouped-accessor-pairs': ['error', 'getBeforeSet'],
      'prefer-object-spread': 'error',
      'prefer-template': 'error',
      'prefer-exponentiation-operator': 'error',
      radix: 'error',
      yoda: 'error',

      // Imports (ordering is left alone on purpose: cosmetic, and it would rewrite every file's import block)
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-absolute-path': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
      // Module resolution/exports are checked by tsc (bundler resolution, path aliases), no resolver needed here.
      'import-x/no-unresolved': 'off',
      'import-x/named': 'off',
      'import-x/namespace': 'off',
      'import-x/default': 'off',
      'import-x/export': 'off',

      // Unicorn: recommended set minus rules that fight this codebase's conventions
      'unicorn/filename-case': ['error', { cases: { pascalCase: true, camelCase: true, kebabCase: true } }], // components PascalCase, lib camelCase, worker kebab-case
      'unicorn/no-null': 'off', // D1/JSON/DOM APIs use null
      'unicorn/prevent-abbreviations': 'off', // props/ref/e/err/env/db/res are idiomatic here
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/no-unused-array-method-return': 'off', // syntactic: misfires on Drizzle's awaited `insert(t).values(row)` builder
      'unicorn/prefer-global-this': 'off', // browser code uses `window` deliberately; worker has no window
      'unicorn/no-nested-ternary': 'off', // JSX needs nested conditionals
      'unicorn/no-negated-condition': 'off'
    }
  },

  // ---------------------------------------------------------------------------------------------------------------
  // Plain JS (eslint.config.js and friends): no type information
  // ---------------------------------------------------------------------------------------------------------------
  {
    name: 'edging-mail/plain-js',
    files: plainJsFiles,
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node }
  },

  // ---------------------------------------------------------------------------------------------------------------
  // TypeScript (src/** + root config files such as vite.config.ts and drizzle.config.ts): type-aware, strictest sets
  // ---------------------------------------------------------------------------------------------------------------
  {
    name: 'edging-mail/typescript',
    files: typedFiles,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        // Root files outside tsconfig.json's `include` (vite.config.ts, drizzle.config.ts) go through the default
        // project, which is tsconfig.json itself (compilerOptions only, `include` is ignored for it).
        projectService: { allowDefaultProject: ['*.config.ts'] },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        // The code uses both `import type { A }` and `import { a, type B }`; both are accepted.
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // `onClick={() => setOpen(false)}` is the idiomatic React handler; forcing braces on every one is noise (88 hits).
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true, ignoreVoidOperator: false }],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: true, checksConditionals: true, checksSpreads: true }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { requireDefaultForNonUnion: true, considerDefaultExhaustiveForUnions: false }
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowAny: false, allowBoolean: false, allowNever: false, allowNullish: false, allowNumber: true, allowRegExp: false }
      ],
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ],
      // core rules superseded by the typed versions above
      'no-shadow': 'off',
      'no-use-before-define': 'off'
    }
  },

  // Exported non-component functions in .ts modules (worker + client lib/theme) declare their return type.
  {
    name: 'edging-mail/explicit-return-types',
    files: ['src/**/*.ts'],
    ignores: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': [
        'error',
        {
          allowArgumentsExplicitlyTypedAsAny: false,
          allowDirectConstAssertionInArrowFunctions: true,
          allowHigherOrderFunctions: true,
          allowTypedFunctionExpressions: true
        }
      ]
    }
  },

  // ---------------------------------------------------------------------------------------------------------------
  // Worker: Cloudflare Workers runtime
  // ---------------------------------------------------------------------------------------------------------------
  {
    name: 'edging-mail/worker',
    files: workerFiles,
    rules: {
      // console.* is the Workers observability channel (wrangler tail / Logs); the existing `[edging-mail]` lines use log.
      'no-console': ['error', { allow: ['log', 'info', 'warn', 'error'] }]
    }
  },

  // ---------------------------------------------------------------------------------------------------------------
  // Client: React 19 + DOM
  // ---------------------------------------------------------------------------------------------------------------
  {
    name: 'edging-mail/client',
    files: clientFiles,
    extends: [
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.strict
    ],
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
    rules: {
      // react-hooks: recommended + the newer compiler-backed rules, all as errors
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/incompatible-library': 'error',
      'react-hooks/unsupported-syntax': 'error',
      'react-hooks/capitalized-calls': 'error',
      'react-hooks/void-use-memo': 'error',
      'react-hooks/no-deriving-state-in-effects': 'error',
      'react-hooks/memoized-effect-dependencies': 'error',

      // react
      'react/button-has-type': 'error',
      'react/iframe-missing-sandbox': 'error', // MessageView renders email HTML in an iframe srcDoc
      'react/jsx-boolean-value': ['error', 'never'],
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never', propElementValues: 'always' }],
      'react/jsx-fragments': ['error', 'syntax'],
      'react/jsx-key': ['error', { checkFragmentShorthand: true, checkKeyMustBeforeSpread: true, warnOnDuplicates: true }],
      'react/jsx-no-constructed-context-values': 'error',
      'react/jsx-no-leaked-render': ['error', { validStrategies: ['ternary', 'coerce'] }],
      'react/jsx-no-script-url': 'error',
      'react/jsx-no-target-blank': ['error', { enforceDynamicLinks: 'always' }],
      'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
      'react/jsx-pascal-case': 'error',
      'react/no-array-index-key': 'error',
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-unstable-nested-components': 'error',
      'react/no-object-type-as-default-prop': 'error',
      'react/self-closing-comp': 'error',
      'react/void-dom-elements-no-children': 'error',
      'react/hook-use-state': 'error',
      // `<ul role="list">` is deliberate on lists styled with `list-style: none` (Safari/VoiceOver drops the list role otherwise)
      'jsx-a11y/no-redundant-roles': ['error', { ul: ['list'], ol: ['list'] }],
      // TypeScript already checks props, so the PropTypes-era rules are off
      'react/prop-types': 'off',
      'react/require-default-props': 'off'
    }
  },

  // Root tooling files: default exports are the API, and they run in Node.
  {
    name: 'edging-mail/root-config-files',
    files: ['*.config.{js,mjs,ts}'],
    languageOptions: { globals: globals.node }
  },

  // Turns off every rule that would fight Prettier (Prettier itself is not run through ESLint).
  { ...prettier, name: 'edging-mail/prettier' },

  // eslint-config-prettier switches `curly` off, but only the "multi-line"/"multi-or-nest" variants clash with Prettier;
  // `'all'` is safe, so it is re-enabled after the Prettier config.
  { name: 'edging-mail/curly-after-prettier', files: sourceFiles, rules: { curly: ['error', 'all'] } }
]);
