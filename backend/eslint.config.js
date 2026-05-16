// eslint.config.js
import eslintPluginJs from '@eslint/js'
import eslintPluginJest from 'eslint-plugin-jest'
import globals from 'globals'

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // ⛔️ Ignorar carpetas externas y archivos de entorno virtual
  {
    ignores: [
      'node_modules/**',
      '**/venv/**',
      '**/venv/**/*',
      '**/site-packages/**',
      'src/test/**',
      'jest.setup.js',
    ],
  },

  // ✅ Reglas base recomendadas de JS
  {
    ...eslintPluginJs.configs.recommended,
  },

  // ✅ Reglas para tests con Jest
  {
    files: ['**/*.test.js', '**/__tests__/**/*.js'],
    plugins: {
      jest: eslintPluginJest,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'jest/no-disabled-tests': 'warn',
      'jest/no-identical-title': 'error',
      'jest/prefer-to-have-length': 'warn',
      'jest/valid-expect': 'error',
    },
  },

  // ✅ Reglas personalizadas para tu código backend
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      quotes: ['error', 'single'],
      semi: ['error', 'never'],
      indent: ['error', 2],
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      'arrow-parens': ['error', 'as-needed'],
      'no-unused-vars': ['warn'],
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    },
  },
]
