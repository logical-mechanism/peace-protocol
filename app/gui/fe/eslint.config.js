import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Catches user-facing strings that bypass i18n in screen-reader-only or
      // tooltip attributes — these are invisible during visual review.
      // `placeholder` is intentionally not listed: form placeholders in this
      // app are numeric ("0", "0.00") or symbolic ("…") and locale-agnostic.
      'no-restricted-syntax': ['error',
        {
          selector: "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|alt|title)$/] > Literal[value!=''][value!=' ']",
          message: "Hardcoded user-facing attribute string. Use t() — e.g. aria-label={t('namespace:key')}.",
        },
        {
          selector: "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|alt|title)$/] > JSXExpressionContainer > TemplateLiteral",
          message: "User-facing attribute should use t() with interpolation, not a template literal that may contain hardcoded English. e.g. aria-label={t('foo', { count })}.",
        },
      ],
    },
  },
  {
    // Test files use synthetic fixtures — exempt from the i18n attr rule.
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
])
