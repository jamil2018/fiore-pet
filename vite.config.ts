import { defineConfig } from 'vitest/config';

// Tauri + Vitest. Port and env prefix: docs/reference/tauri-v2.md section 1.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'chrome105',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
