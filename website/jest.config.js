// 📁 jest.config.js

export default {
  testEnvironment: 'jsdom',

  setupFiles: ['<rootDir>/jest.env.js'],

  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  moduleNameMapper: {
    '^@components/(.*)$': '<rootDir>/src/Components/$1',
    '^@features/(.*)$': '<rootDir>/src/Features/$1',
    '^@pages/(.*)$': '<rootDir>/src/Pages/$1',
    '^@routes/(.*)$': '<rootDir>/src/Route/$1',
    '^@utils/(.*)$': '<rootDir>/src/Utils/$1',
    '^@hooks/(.*)$': '<rootDir>/src/Hooks/$1',

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
