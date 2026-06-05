import { defineConfig } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html'
import path from 'path';

// Plugin to remove external @import in dev mode (prevents blocking when mui.kernelsu.org is unreachable)
function removeExternalImports() {
    return {
        name: 'remove-external-imports',
        // Only apply to CSS files
        transform(src, id) {
            if (id.endsWith('.css') && src.includes('mui.kernelsu.org')) {
                return src.replace(/@import\s+url\(['"]https?:\/\/mui\.kernelsu\.org[^)]*\)['"];?\s*/g, '');
            }
            return src;
        }
    };
}

export default defineConfig(({ mode }) => ({
    base: './',
    build: {
        outDir: '../module/webroot',
    },
    plugins: [
        createHtmlPlugin({ minify: true }),
        ...(mode === 'development' ? [removeExternalImports()] : [])
    ],
    resolve: {
        alias: mode === 'development' ? {
            'kernelsu-alt': path.resolve(__dirname, 'mock/kernelsu-alt.js')
        } : {}
    }
}));
