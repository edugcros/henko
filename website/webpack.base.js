// 📦 webpack.base.js
import path from 'path'
import webpack from 'webpack'

const __dirname = path.resolve()

export default {
  entry: path.resolve(__dirname, './src/index.js'),

  target: 'web',

  performance: {
    hints: false,
  },

  resolve: {
    extensions: [
      '.js',
      '.jsx',
      '.json',
      '.css',
      '.scss',
      '.sass',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.svg',
      '.webp',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.otf',
    ],

    alias: {
      '@routes': path.resolve(__dirname, 'src/Route'),
      '@features': path.resolve(__dirname, 'src/Features'),
      '@components': path.resolve(__dirname, 'src/Components'),
      '@utils': path.resolve(__dirname, 'src/Utils'),
      '@app': path.resolve(__dirname, 'src/app'),
      '@pages': path.resolve(__dirname, 'src/Pages'),
      '@hooks': path.resolve(__dirname, 'src/Hooks'),
      '@assets': path.resolve(__dirname, 'src/assets'),
    },

    fallback: {
      process: 'process/browser',
    },
  },

  module: {
    rules: [
      // ---------- IMÁGENES ----------
      {
        test: /\.(png|jpe?g|gif|svg|webp)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/images/[name].[contenthash][ext]',
        },
      },

      // ---------- FUENTES ----------
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/fonts/[name].[contenthash][ext]',
        },
      },

      // ---------- JS / JSX ----------
      {
        test: /\.(js|jsx)$/i,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            cacheDirectory: true,
            presets: [
              [
                '@babel/preset-env',
                {
                  modules: false,
                  bugfixes: true,
                  targets: '>0.2%, not dead, not op_mini all',
                },
              ],
              [
                '@babel/preset-react',
                {
                  runtime: 'automatic',
                },
              ],
            ],
            plugins: ['@babel/plugin-transform-runtime'],
          },
        },
      },

      // ---------- ESM COMPAT ----------
      {
        test: /\.m?js$/,
        type: 'javascript/auto',
        resolve: {
          fullySpecified: false,
        },
      },
    ],
  },

  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
  ],

  stats: {
    errorDetails: true,
  },
}