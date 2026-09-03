import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'data/raw/**', 'data/normalized/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Vendored uma-skill-tools engine (GPL-3.0). Kept close to upstream so it can be
    // re-synced; style rules that would force a rewrite are relaxed here only.
    files: ['src/engine/vendor/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'prefer-const': 'off',
      'prefer-spread': 'off',
      'no-var': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
    },
  },
];

export default eslintConfig;
