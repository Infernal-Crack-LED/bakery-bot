import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      curly: 'error',
      'dot-notation': 'error',
      // NOTE: 'func-style' intentionally omitted — this repo idiomatically uses
      // `export function ...` declarations (see the discord-feature skill).
      'require-await': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.test.*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**/*',
      '**/.next/**/*',
      '**/out/**/*',
      '**/build/**/*',
      '**/next-env.d.ts',
      'packages/db/drizzle/**/*',
    ],
  }
);
