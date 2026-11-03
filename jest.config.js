module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  ...(process.env.COPILOT_JEST_MAX_WORKERS && { maxWorkers: process.env.COPILOT_JEST_MAX_WORKERS }),
  roots: ["<rootDir>/src", "<rootDir>/dev", "<rootDir>/scripts"],
  transform: {
    "^.+\\.(js|jsx)$": [
      "ts-jest",
      {
        tsconfig: { module: "CommonJS", moduleResolution: "Node", importHelpers: false },
        useESM: false,
        isolatedModules: true,
      },
    ],
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  moduleNameMapper: {
    "\\.svg$": "<rootDir>/__mocks__/svg.js",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^obsidian$": "<rootDir>/__mocks__/obsidian.js",
    "^yaml$": "<rootDir>/node_modules/yaml/dist/index.js",
    "^@earendil-works/pi-ai/(.*)$": "<rootDir>/node_modules/@earendil-works/pi-ai/dist/$1.js",
    "^@earendil-works/pi-schema$": "<rootDir>/node_modules/@earendil-works/pi-schema/dist/index.js",
    "^@earendil-works/pi-telemetry$":
      "<rootDir>/node_modules/@earendil-works/pi-telemetry/dist/index.js",
    "^@anthropic-ai/claude-agent-sdk$": "<rootDir>/__mocks__/@anthropic-ai/claude-agent-sdk.js",
    "^react-resizable-panels$": "<rootDir>/__mocks__/react-resizable-panels.js",
  },
  testRegex: ".*\\.test\\.(jsx?|tsx?)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testPathIgnorePatterns: ["/node_modules/"],
  transformIgnorePatterns: ["/node_modules/(?!@earendil-works/)"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
