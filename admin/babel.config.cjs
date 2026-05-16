module.exports = {
  presets: [['@babel/preset-env'], ['@babel/preset-react', { runtime: 'automatic' }]],
  plugins: [
    '@babel/plugin-transform-runtime',
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: {
          '@components': './src/components',
          '@utils': './src/utils',
          '@app': './src/app',
          '@features': './src/features',
          '@routes': './src/route',
          '@pages': './src/pages',
          '@hooks': './src/hooks',
          '@assets': './src/assets',
          '@': './src',
        },
        extensions: ['.js', '.jsx', '.json'],
      },
    ],
  ],
}
