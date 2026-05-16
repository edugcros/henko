// 📦 webpack.dev.js
import { merge } from 'webpack-merge'
import path from 'path'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import baseConfig from './webpack.base.js'
import { createEnvPlugin } from './webpack.env.js'

const __dirname = path.resolve()

export default merge(baseConfig, {
  mode: 'development',

  devtool: 'eval-source-map',

  output: {
    filename: 'js/[name].js',
    chunkFilename: 'js/[name].chunk.js',
    path: path.resolve(__dirname, 'build'),
    publicPath: '/',
    clean: true,
  },

  plugins: [
    createEnvPlugin(),

    new CaseSensitivePathsPlugin(),

    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public', 'index.html'),
      filename: 'index.html',
      favicon: path.resolve(__dirname, 'public', 'favicon.ico'),
      inject: 'body',
      scriptLoading: 'defer',
    }),
  ],

  devServer: {
    static: {
      directory: path.resolve(__dirname, 'public'),
      publicPath: '/',
      watch: true,
    },

    historyApiFallback: {
      index: '/index.html',
      disableDotRule: true,
    },

    open: true,
    compress: true,
    port: 3002,
    hot: true,

    host: 'henko.local',
    allowedHosts: 'all',

    client: {
      overlay: {
        errors: true,
        warnings: false,
      },
      logging: 'info',
    },

    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },

  stats: {
    errorDetails: true,
  },
})