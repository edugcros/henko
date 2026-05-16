// babel.config.js
module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: { node: 'current' },
        modules: false,
      },
    ],
  ],
  plugins: [
    '@babel/plugin-transform-runtime',
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: {
          '@utils': './src/utils',
        },
        extensions: ['.js', '.json'],
      },
    ],
  ],
}
