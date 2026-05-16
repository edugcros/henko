module.exports = {
  presets: [
    ['@babel/preset-env'],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
  plugins: [
    '@babel/plugin-transform-runtime',
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: {
          '@components': './src/Components',
          '@utils': './src/Utils',
          '@app': './src/app',
          '@features': './src/Features',
          '@routes': './src/Route',
          '@pages': './src/Pages',
          '@hooks': './src/Hooks',
          '@assets': './src/assets',
        },
        extensions: ['.js', '.jsx', '.json'],
      },
    ],
  ],
};
