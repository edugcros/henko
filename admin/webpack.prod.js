// 📦 webpack.prod.js
import { merge } from 'webpack-merge'
import path from 'path'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import Dotenv from 'dotenv-webpack'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import CompressionPlugin from 'compression-webpack-plugin'
import TerserPlugin from 'terser-webpack-plugin'
import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import baseConfig from './webpack.base.js'
import { createDotenvPlugin } from './webpack.env.js'


const __dirname = path.resolve()

export default merge(baseConfig, {
  mode: 'production',
  output: {
    filename: 'js/[name].[contenthash].js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    chunkFilename: 'js/[name].[contenthash].chunk.js',
    publicPath: 'auto',
  },
  performance: {
    hints: false
  },  
  plugins: [
    createDotenvPlugin(),
    new CaseSensitivePathsPlugin(),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public', 'index.html'),
      filename: 'index.html',
      inject: 'body',
      scriptLoading: 'defer',
    }),
    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash].css',
      chunkFilename: 'css/[id].[contenthash].css',
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'public/manifest.json', to: 'manifest.json' },
      ],
    }),
    new Dotenv({
      path: './.env.production',
      systemvars: true,
    }),
    new CompressionPlugin({ algorithm: 'gzip' }),
    new CompressionPlugin({ algorithm: 'brotliCompress' }),
  ],
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          format: { comments: false },
          compress: {
            drop_console: true,
            passes: 3,
          },
        },
      }),
      new ImageMinimizerPlugin({
        minimizer: {
          implementation: ImageMinimizerPlugin.imageminGenerate,
          options: {
            plugins: [
              ['mozjpeg', { quality: 80 }],
              ["pngquant", { quality: [0.7, 0.9] }], // Solo PNG
              ['optipng', { optimizationLevel: 5 }],
              ['gifsicle', { interlaced: true }],
              ['svgo'],
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
            filter: (source, sourcePath) => {
              return /\.(jpe?g|png)$/i.test(sourcePath);
            },
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
          priority: 2,
        },
        utilityVendor: {
          test: /[\\/]node_modules[\\/](lodash|moment|axios|redux|redux-persist)[\\/]/,
          name: 'utility-vendor',
          chunks: 'all',
          priority: 1,
        },
        defaultVendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          enforce: true,
          priority: 0,
        },
      },
    },
    runtimeChunk: 'single',
  },
})
