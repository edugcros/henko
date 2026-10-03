// eslint.config.js
import eslintPluginJs from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
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
      'no-unused-vars': ['warn'],
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    },
  },

  // SIEMPRE AL FINAL: apaga las reglas de FORMATO que chocan con prettier.
  //
  // POR QUÉ SE FUERON SEIS REGLAS DE ACÁ
  //
  // Este bloque declaraba quotes, semi, indent, comma-dangle,
  // object-curly-spacing y arrow-parens: las seis son decisiones de formato, y
  // el formato lo decide prettier.config.cjs. Mientras el backend no tuvo
  // config de prettier la duplicación no se notaba, porque nadie formateaba.
  //
  // Se notó al formatearlo: 629 errores de `indent`, todos por discrepar con
  // la sangría que elige prettier. Dos herramientas peleando por lo mismo, que
  // es exactamente lo que el PR #247 arregló en admin y en website y lo que
  // AGENTS.md pide no repetir.
  //
  // eslint-config-prettier ya era dependencia; solo faltaba aplicarlo. Va
  // último porque gana la última configuración que toca una regla.
  eslintConfigPrettier,
]
