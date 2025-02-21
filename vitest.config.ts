import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['json-summary', 'text', 'lcov'],
      include: ['./src/**']
    },
    testTimeout: 10000,
    globals: true
  }
})
