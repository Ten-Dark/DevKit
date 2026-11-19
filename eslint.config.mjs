import jsRules from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactX from 'eslint-plugin-react-x'
import reactJsx from 'eslint-plugin-react-jsx'
import reactHooks from 'eslint-plugin-react-hooks'
import reactDom from 'eslint-plugin-react-dom'
import globals from 'globals'

export default tseslint.config(
  jsRules.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'no-undef': 'warn',
      'preserve-caught-error': 'warn',
      'no-restricted-syntax': 'off',
      'guard-for-in': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    extends: [
      reactX.configs.recommended,
      reactJsx.configs.recommended,
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      'react-x': {
        version: 'detect',
        importSource: 'react',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The react-hooks plugin is the single source of truth for Hook checks.
      'react-x/rules-of-hooks': 'off',
      'react-x/exhaustive-deps': 'off',
      'react-x/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      // Restore important checks that are not enabled by react-dom's recommended preset.
      'react-dom/no-unsafe-target-blank': 'error',
      'react-dom/no-unknown-property': 'error',
      'react-jsx/no-children-prop': 'error',
      // Preserve two legacy React restrictions with ESLint core AST/property rules.
      'no-restricted-properties': ['error', {
        property: 'isMounted',
        message: 'React isMounted() is deprecated; use an explicit lifecycle/state strategy.',
      }],
      'no-restricted-syntax': ['error', {
        selector: "JSXAttribute[name.name='ref'][value.type='Literal']",
        message: 'String refs are deprecated; use callback or object refs.',
      }],
      // Closest maintained equivalent to the former react/display-name rule.
      'react-x/no-missing-component-display-name': 'error',
    },
  },
  {
    // Type-aware deprecation checking replaces the React plugin's deprecated-API check.
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
  {
    // TypeScript performs undefined-name checks itself; the base no-undef rule
    // reports false positives for type-only names and the automatic JSX runtime.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    // CommonJS maintenance scripts intentionally use require().
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['scripts/**/*.{mjs,cjs,js}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist-electron/',
      'dist/',
      '*.log',
      'package-lock.json',
      'scripts/__xmind_fixtures__/',
    ],
  },
)
