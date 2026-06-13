// 📁 jest.config.cjs
export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@components/(.*)$': '<rootDir>/src/Components/$1',
    '^@features/(.*)$': '<rootDir>/src/Features/$1',
    '^@pages/(.*)$': '<rootDir>/src/Pages/$1',
    '^@routes/(.*)$': '<rootDir>/src/Route/$1',
    '^@utils/(.*)$': '<rootDir>/src/Utils/$1',
    '^@hooks/(.*)$': '<rootDir>/src/Hooks/$1',

    // ✅ FIXED: esta es la línea correcta para archivos estáticos
    '\\.(css|less|scss|sass)$': '<rootDir>/src/test/__mocks__/styleMock.js',
    '\\.(jpg|jpeg|png|gif|webp|svg|eot|ttf|woff|woff2)$':
      '<rootDir>/src/test/__mocks__/fileMock.js',
  },
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  coverageReporters: ['text', 'lcov'],
  testMatch: ['<rootDir>/src/**/*.test.{js,jsx}'],
}
