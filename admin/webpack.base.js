// 📦 webpack.base.js
import path from 'path'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import process from 'process'

const __dirname = path.resolve()
const isProd = process.env.NODE_ENV === 'production'

export default {
  entry: path.resolve(__dirname, './src/index.js'),
  target: 'web',
  performance: { hints: false },

  resolve: {
    extensions: [
      '.js',
      '.jsx',
      '.css',
      '.scss',
      '.sass',
      '.png',
      '.svg',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.otf',
      '.webp',
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
      // ---------- CSS ----------
      {
        test: /\.css$/i,
        use: [
          isProd ? MiniCssExtractPlugin.loader : 'style-loader',
          {
            loader: 'css-loader',
            options: {
              sourceMap: !isProd,
            },
          },
        ],
      },

      // ---------- SASS / SCSS ----------
      {
        test: /\.(scss|sass)$/i,
        use: [
          isProd ? MiniCssExtractPlugin.loader : 'style-loader',
          {
            loader: 'css-loader',
            options: {
              sourceMap: !isProd,
            },
          },
          {
            loader: 'sass-loader',
            options: {
              sourceMap: !isProd,
            },
          },
        ],
      },

      // ---------- IMÁGENES ----------
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
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
            presets: [
              ['@babel/preset-env', { modules: false }],
              '@babel/preset-react',
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

  stats: {
    errorDetails: true,
  },
}
