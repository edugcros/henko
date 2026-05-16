// 📁 admin/webpack.config.js
import process from 'process'
import devConfig from './webpack.dev.js'
import prodConfig from './webpack.prod.js'

export default (env, argv) => {
  const mode = argv.mode || process.env.NODE_ENV || 'development'
  const isProduction = mode === 'production'

  process.env.NODE_ENV = mode

  return isProduction ? prodConfig : devConfig
}