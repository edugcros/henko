// 📦 webpack.config.js
import devConfig from './webpack.dev.js'
import prodConfig from './webpack.prod.js'

import process from 'process'

const ignoredWarnings = [
  {
    module: /framer-motion[\\/]dist[\\/]es[\\/]render[\\/]dom[\\/]utils[\\/]filter-props\.mjs/,
    message: /Critical dependency: the request of a dependency is an expression/,
  },
]

const normalizeArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const resolveConfig = (config, env, argv) => {
  return typeof config === 'function' ? config(env, argv) : config
}

const withSharedWebpackConfig = (config) => ({
  ...config,

  ignoreWarnings: [
    ...normalizeArray(config.ignoreWarnings),
    ...ignoredWarnings,
  ],
})

export default (env = {}, argv = {}) => {
  const mode = argv.mode || process.env.NODE_ENV || 'development'
  const isProduction = mode === 'production'

  process.env.NODE_ENV = mode

  const selectedConfig = resolveConfig(
    isProduction ? prodConfig : devConfig,
    env,
    argv
  )

  return withSharedWebpackConfig(selectedConfig)
}