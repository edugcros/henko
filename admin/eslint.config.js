import js from '@eslint/js'
import reactPlugin from 'eslint-plugin-react'
import prettierPlugin from 'eslint-plugin-prettier'
import unusedImports from 'eslint-plugin-unused-imports'
import babelParser from '@babel/eslint-parser'
import globals from 'globals'

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}', '**/__tests__/**/*.test.jsx'],
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/public/**',
      '**/*.bundle.js',
      '**/webpack.*.js',
    ],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        ecmaVersion: 'latest',
        sourceType: 'module',
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-env', '@babel/preset-react'],
          plugins: [
            [
              'module-resolver',
              {
                root: ['./src'],
                alias: {
                  '@components': './src/components',
                  '@utils': './src/utils',
                  '@app': './src/app',
                  '@features': './src/features',
                  '@routes': './src/route',
                  '@pages': './src/pages',
                  '@hooks': './src/hooks',
                  '@': './src',
                },
                extensions: ['.js', '.jsx', '.json'],
              },
            ],
          ],
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
        ...globals.jest,
        vi: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        es6: true,
        console: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        document: 'readonly',
        window: 'readonly',
        FormData: 'readonly',
        URLSearchParams: 'readonly',
        process: true,
        module: 'readonly',
        __webpack_require__: 'readonly',
        __webpack_exports__: 'readonly',
        __unused_webpack_module: 'readonly',
        self: 'readonly',
        setTimeout: 'readonly',
      },
    },
    plugins: {
      'unused-imports': unusedImports,
      react: reactPlugin,
      prettier: prettierPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
      'import/resolver': {
        alias: {
          extensions: ['.js', '.jsx', '.json'],
        },
      },
    },
    rules: {
      'unused-imports/no-unused-imports': 'off',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern:
            '^(MockComponent|LazyLoad|Component|Suspense|Navigate|Route|Routes|Router|Layout|SpinnerCentered|PrivateRoute|PublicRoute|__webpack_|exports|module|chunkId|__webpack_require__|self|webpackHotUpdate|React|(?:.*Components?.*|.*Service.*|.*Hooks.*|.*Pages.*|.*Utils.*|.*Context.*|.*Features.*|.*Route.*|Color))$',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'no-dupe-keys': 'error',
      'no-unused-vars': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'prettier/prettier': [
        'error',
        {
          semi: false,
          singleQuote: true,
          trailingComma: 'all',
          endOfLine: 'auto',
          printWidth: 80,
        },
      ],
    },
  },
]
