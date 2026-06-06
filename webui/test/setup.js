/**
 * Vitest setup — runs once per test file before any specs execute.
 *
 * Two responsibilities:
 *  1. Make the localStorage / window stubs that jsdom provides sane
 *     defaults for (jsdom gives us a real Map-backed localStorage,
 *     which is what we want).
 *  2. Wipe the mocked `kernelsu-alt` exec queue between tests so
 *     per-test `vi.mock` overrides don't leak.
 *
 * Most of the per-test mocking happens inside each *.test.js file via
 * `vi.mock('kernelsu-alt', ...)`, which runs before this setup file's
 * body. So all we need to do here is reset cross-test state.
 */
import { afterEach, vi } from 'vitest';

// jsdom doesn't ship with IntersectionObserver (it's a no-op for our
// unit tests anyway, but importing page/patch.js pulls in index.js
// which transitively loads page/exclude.js which uses it).
// Provide a minimal stub so module evaluation doesn't blow up.
if (typeof globalThis.IntersectionObserver === 'undefined') {
    class IntersectionObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    // @ts-ignore - intentional shim
    globalThis.IntersectionObserver = IntersectionObserverStub;
}

afterEach(() => {
    // Clear the DOM so document.getElementById(...) lookups in a later
    // test don't accidentally return a node from an earlier one.
    document.body.innerHTML = '';
    // Clear localStorage so storage tests start from a known-empty state.
    // Individual tests are responsible for seeding values they need.
    if (typeof localStorage !== 'undefined') {
        localStorage.clear();
    }
    // Clear any module-level mock state set via vi.mock(...).
    vi.restoreAllMocks();
});
