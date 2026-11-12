import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist-electron/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/index.html'),
      output: {
        entryFileNames: '[name].js'
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}']
  }
})
