import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: { '/admin': 'http://127.0.0.1:47900' },
  },
  build: { outDir: 'dist', sourcemap: true },
});
