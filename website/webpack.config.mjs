// 📦 webpack.config.js
import devConfig from './webpack.dev.js'
import prodConfig from './webpack.prod.js'

import process from 'process'

export default (env, argv) => {
  const isProduction = argv.mode === 'production'
  process.env.NODE_ENV = argv.mode // Asegura coherencia de entorno

  return isProduction ? prodConfig : devConfig
}
