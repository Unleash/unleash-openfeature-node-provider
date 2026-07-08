import { defineConfig } from 'vitest/config';

// Conformance runs the shared-contract suite, which needs the `verifier/` spec submodule.
// Kept separate from the default config (which excludes it) so `npm test` — the unit tests —
// stays green without the submodule checked out.
export default defineConfig({
  test: {
    include: ['test/openfeature-contract.test.ts'],
  },
});
