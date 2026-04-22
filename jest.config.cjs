module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dashboard/",
    "/\\.worktrees/",
    "/paperclipai-alt\\d+/",
  ],
  modulePathIgnorePatterns: [
    "<rootDir>/\\.worktrees/",
    "<rootDir>/paperclipai-alt\\d+/",
  ],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/index.ts",
    "!src/test-factories/**",
  ],
  coverageThreshold: {
    global: {
      lines: 57,
      functions: 62,
      branches: 38,
      statements: 56,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
  forceExit: true,
};
