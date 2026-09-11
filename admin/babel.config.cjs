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
          // Faltaban los dos, y webpack.base.js sí los tiene. La consecuencia
          // no se veía en el build —webpack resuelve por su cuenta— pero Jest
          // usa estos: cualquier test que importara una pantalla con
          // `@constants/...` fallaba con "Cannot find module", así que esas
          // pantallas simplemente no se probaban.
          '@constants': './src/constants',
          '@services': './src/services',
          '@': './src',
        },
        extensions: ['.js', '.jsx', '.json'],
      },
    ],
  ],
}
