import { defineConfig } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html'
import path from 'path';

export default defineConfig(({ mode }) => ({
    base: './',
    build: {
        outDir: '../module/webroot',
    },
    plugins: [
        createHtmlPlugin({
            minify: true
        })
    ],
    resolve: {
        alias: mode === 'development' ? {
            // In dev mode, use mock kernelsu-alt for browser preview
            'kernelsu-alt': path.resolve(__dirname, 'mock/kernelsu-alt.js')
        } : {}
    }
}));
