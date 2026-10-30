// The library's management code lives outside src, so it needs its own runner
// rather than a testRegex broad enough to swallow the rest of the repository.
module.exports = {
  rootDir: __dirname,
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
