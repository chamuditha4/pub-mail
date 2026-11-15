// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-tsc/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
      // TypeScript already resolves identifiers (browser/worker globals, etc.),
      // so the core no-undef rule only produces false positives here.
      'no-undef': 'off',
      // Control-character regexes are intentional in the email sanitizer and
      // filename hardening (stripping C0 controls).
      'no-control-regex': 'off',
    },
  },
);
