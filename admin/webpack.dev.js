// 📦 webpack.dev.js
import { merge } from 'webpack-merge'
import path from 'path'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import Dotenv from 'dotenv-webpack'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import baseConfig from './webpack.base.js'
import { createDotenvPlugin } from './webpack.env.js'

const __dirname = path.resolve()

export default merge(baseConfig, {
  mode: 'development',
  devtool: 'eval-source-map',

  output: {
    filename: 'js/[name].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
  },

  plugins: [
    createDotenvPlugin(),
    new CaseSensitivePathsPlugin(),

    // 🔥 CORRECTO: HtmlWebpackPlugin con favicon incluido
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public', 'index.html'),
      filename: 'index.html',
      favicon: path.resolve(__dirname, 'public', 'favicon.ico'),
      inject: 'body',
      scriptLoading: 'defer',
    }),

    new Dotenv({
      path: './.env.development',
      systemvars: true,
    }),

    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash].css',
      chunkFilename: 'css/[id].[contenthash].css',
    }),
  ],

  devServer: {
    static: {
      directory: path.resolve(__dirname, 'public'),
      publicPath: '/',
      watch: true,
    },

    historyApiFallback: true,
    open: true,
    compress: true,
    port: 3001,
    hot: true,

    // 🔑 Para acceso desde otra PC o desde ngrok
    host: 'admin.henko.local',
    allowedHosts: 'all', // importante para que webpack-dev-server acepte subdominios locales

    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },

  stats: {
    errorDetails: true,
  },
})
