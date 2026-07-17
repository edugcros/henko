// 📦 webpack.prod.js
import { merge } from 'webpack-merge'
import path from 'path'
import fs from 'fs'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import CompressionPlugin from 'compression-webpack-plugin'
import TerserPlugin from 'terser-webpack-plugin'
import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import baseConfig from './webpack.base.js'
import { createEnvPlugin } from './webpack.env.js'

const __dirname = path.resolve()

const publicPath = path.resolve(__dirname, 'public')
const manifestPath = path.resolve(publicPath, 'manifest.json')
const faviconPath = path.resolve(publicPath, 'favicon.ico')

const copyPatterns = []

if (fs.existsSync(manifestPath)) {
  copyPatterns.push({
    from: manifestPath,
    to: 'manifest.json',
  })
}

export default merge(baseConfig, {
  mode: 'production',

  bail: true,

  devtool: false,

  output: {
    filename: 'js/[name].[contenthash:8].js',
    chunkFilename: 'js/[name].[contenthash:8].chunk.js',
    path: path.resolve(__dirname, 'build'),
    publicPath: '/',
    clean: true,
  },

  module: {
    rules: [
      // ---------- CSS PROD ----------
      {
        test: /\.css$/i,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              sourceMap: false,
              importLoaders: 1,
            },
          },
        ],
      },

      // ---------- SASS / SCSS PROD ----------
      {
        test: /\.(scss|sass)$/i,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              sourceMap: false,
              importLoaders: 1,
            },
          },
          {
            loader: 'sass-loader',
            options: {
              sourceMap: false,
            },
          },
        ],
      },
    ],
  },

  plugins: [
    createEnvPlugin({
      mode: 'production',
    }),

    new CaseSensitivePathsPlugin(),

    new HtmlWebpackPlugin({
      template: path.resolve(publicPath, 'index.html'),
      filename: 'index.html',
      favicon: fs.existsSync(faviconPath) ? faviconPath : undefined,
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
      filename: 'css/[name].[contenthash:8].css',
      chunkFilename: 'css/[name].[contenthash:8].chunk.css',
    }),

    ...(copyPatterns.length
      ? [
          new CopyWebpackPlugin({
            patterns: copyPatterns,
          }),
        ]
      : []),

    new CompressionPlugin({
      filename: '[path][base].gz',
      algorithm: 'gzip',
      test: /\.(js|css|html|svg|json)$/,
      threshold: 10240,
      minRatio: 0.8,
    }),

    new CompressionPlugin({
      filename: '[path][base].br',
      algorithm: 'brotliCompress',
      test: /\.(js|css|html|svg|json)$/,
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
        extractComments: false,
        terserOptions: {
          format: {
            comments: false,
          },
          compress: {
            drop_console: true,
            drop_debugger: true,
            passes: 2,
          },
        },
      }),

      new ImageMinimizerPlugin({
        minimizer: {
          implementation: ImageMinimizerPlugin.imageminGenerate,
          options: {
            plugins: [
              ['mozjpeg', { quality: 80 }],
              ['pngquant', { quality: [0.7, 0.9] }],
              ['optipng', { optimizationLevel: 5 }],
              ['gifsicle', { interlaced: true }],
              [
                'svgo',
                {
                  plugins: [
                    {
                      name: 'preset-default',
                      params: {
                        overrides: {
                          removeViewBox: false,
                        },
                      },
                    },
                  ],
                },
              ],
            ],
          },
        },
        generator: [
          {
            type: 'asset',
            implementation: ImageMinimizerPlugin.imageminGenerate,
            options: {
              plugins: [['imagemin-webp', { quality: 75 }]],
            },
            filter: (_source, sourcePath) => /\.(jpe?g|png)$/i.test(sourcePath),
          },
        ],
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
          priority: 40,
          enforce: true,
        },

        muiVendor: {
          test: /[\\/]node_modules[\\/](@mui|@emotion)[\\/]/,
          name: 'mui-vendor',
          chunks: 'all',
          priority: 30,
          enforce: true,
        },

        motionVendor: {
          test: /[\\/]node_modules[\\/](framer-motion)[\\/]/,
          name: 'motion-vendor',
          chunks: 'all',
          priority: 25,
          enforce: true,
        },

        reduxVendor: {
          test: /[\\/]node_modules[\\/](redux|@reduxjs|react-redux|redux-persist)[\\/]/,
          name: 'redux-vendor',
          chunks: 'all',
          priority: 20,
          enforce: true,
        },

        utilityVendor: {
          test: /[\\/]node_modules[\\/](axios|lodash|moment|date-fns|uuid)[\\/]/,
          name: 'utility-vendor',
          chunks: 'all',
          priority: 15,
          enforce: true,
        },

        defaultVendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          priority: 10,
          reuseExistingChunk: true,
        },

        common: {
          name: 'common',
          minChunks: 2,
          chunks: 'all',
          priority: 5,
          reuseExistingChunk: true,
        },
      },
    },

    runtimeChunk: 'single',
  },

  performance: {
    hints: false,
  },
})
