// jest-dom's own vitest augmentation resolves `vitest` from its pnpm sandbox, where the peer is
// not linked, so the matchers never reach our `expect`. Re-declare the augmentation here.
// oxlint-disable-next-line vite-plus/prefer-vite-plus-imports
import "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// The augmented module has to be `vitest` itself: `vite-plus/test` only re-exports it.
declare module "vitest" {
  interface Assertion<T> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
