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
      lines: 60,
      functions: 60,
      branches: 60,
      statements: 60,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
  forceExit: true,
};
