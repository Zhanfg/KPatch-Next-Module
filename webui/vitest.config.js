/**
 * Vitest configuration for the Kpatch WebUI unit tests.
 *
 * Reuses Vite's resolve.alias mapping for `kernelsu-alt` so the tests
 * can import the device-API stub in `mock/kernelsu-alt.js` instead of
 * pulling in the real (Android-only) module.
 *
 * jsdom is selected as the default environment so DOM-touching modules
 * (e.g. kpm_repo.js, ksu.js — which read localStorage / use document)
 * work without the browser.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: false,
        include: ['test/**/*.test.js'],
        setupFiles: ['./test/setup.js'],
        // WebUI tests are small and isolated; fail fast on the first
        // unhandled rejection so a missing mock surfaces immediately.
        dangerouslyIgnoreUnhandledErrors: false,
    },
    resolve: {
        alias: {
            'kernelsu-alt': path.resolve(__dirname, 'mock/kernelsu-alt.js'),
        },
    },
});
