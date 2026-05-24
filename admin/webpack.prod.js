// 📦 webpack.prod.js
import { merge } from 'webpack-merge'
import path from 'path'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import CompressionPlugin from 'compression-webpack-plugin'
import TerserPlugin from 'terser-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'

import baseConfig from './webpack.base.js'
import { createEnvPlugin } from './webpack.env.js'

const __dirname = path.resolve()

export default merge(baseConfig, {
  mode: 'production',

  devtool: false,

  output: {
    filename: 'js/[name].[contenthash].js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    chunkFilename: 'js/[name].[contenthash].chunk.js',
    publicPath: '/',
  },

  performance: {
    hints: false,
  },

  plugins: [
    createEnvPlugin(),

    new CaseSensitivePathsPlugin(),

    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public', 'index.html'),
      filename: 'index.html',
      inject: 'body',
      scriptLoading: 'defer',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        removeStyleLinkTypeAttributes: true,
        keepClosingSlash: true,
        minifyJS: true,
        minifyCSS: true,
        minifyURLs: true,
      },
    }),

    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash].css',
      chunkFilename: 'css/[id].[contenthash].css',
    }),

    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'public', 'manifest.json'),
          to: 'manifest.json',
          noErrorOnMissing: true,
        },
      ],
    }),

    new CompressionPlugin({
      algorithm: 'gzip',
    }),

    new CompressionPlugin({
      algorithm: 'brotliCompress',
      filename: '[path][base].br',
      compressionOptions: {
        level: 11,
      },
      threshold: 10240,
      minRatio: 0.8,
    }),
  ],

  optimization: {
    minimize: true,

    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          format: {
            comments: false,
          },
          compress: {
            drop_console: false,
            passes: 2,
          },
        },
        extractComments: false,
      }),
    ],

    splitChunks: {
      chunks: 'all',
      minSize: 20000,
      maxSize: 250000,
      cacheGroups: {
        reactVendor: {
          test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
          name: 'react-vendor',
          chunks: 'all',
          priority: 30,
        },

        muiVendor: {
          test: /[\\/]node_modules[\\/](@mui|@emotion)[\\/]/,
          name: 'mui-vendor',
          chunks: 'all',
          priority: 25,
        },

        reduxVendor: {
          test: /[\\/]node_modules[\\/](redux|react-redux|@reduxjs|redux-persist)[\\/]/,
          name: 'redux-vendor',
          chunks: 'all',
          priority: 20,
        },

        utilityVendor: {
          test: /[\\/]node_modules[\\/](axios|lodash|moment|dayjs|js-cookie)[\\/]/,
          name: 'utility-vendor',
          chunks: 'all',
          priority: 15,
        },

        defaultVendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          priority: 10,
          reuseExistingChunk: true,
        },
      },
    },

    runtimeChunk: 'single',
  },

  stats: {
    errorDetails: true,
  },
})