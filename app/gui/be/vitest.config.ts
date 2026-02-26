import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/services/**', 'src/routes/**'],
      thresholds: {
        lines: 60,
        functions: 75,
        branches: 80,
        statements: 60,
      },
    },
  },
});
