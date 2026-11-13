import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// React + MUI 前端。构建产物直接输出到后端托管的 web/dist，后端无需改动。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  publicDir: '../web/public',
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: { '/api': { target: 'http://127.0.0.1:18080', changeOrigin: true } },
  },
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // 只拆分体量大且相互独立的库；React/MUI 等交给 Rollup，避免初始化顺序循环。
          if (id.includes('@univerjs')) return 'univer'
          if (id.includes('@visactor')) return 'vtable'
          if (id.includes('echarts') || id.includes('zrender')) return 'charts'
          if (id.includes('pdfjs-dist')) return 'pdf'
          if (id.includes('codemirror') || id.includes('@codemirror')) return 'editor'
        },
      },
    },
  },
})
