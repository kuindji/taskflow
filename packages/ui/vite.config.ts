import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import monacoEditor from 'vite-plugin-monaco-editor';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    monacoEditor({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
    }),
  ],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
