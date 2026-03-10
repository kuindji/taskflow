import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import monacoEditorModule from 'vite-plugin-monaco-editor';
import path from 'path';

// CJS module with exports.default
const monacoEditor = (monacoEditorModule as { default: typeof monacoEditorModule }).default;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    monacoEditor({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
