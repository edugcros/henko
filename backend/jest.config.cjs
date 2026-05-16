module.exports = {
  testEnvironment: 'node',
  transform: {},
  setupFilesAfterEnv: ['./jest.setup.js'],
  verbose: true,
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['js', 'json'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(test).js'],
  collectCoverageFrom: ['src/**/*.js', '!src/index.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
}
