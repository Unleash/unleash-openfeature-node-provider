import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      'verifier/**', // the spec submodule ships its own tests — never run them here
      'test/openfeature-contract.test.ts',
    ],
  },
});
