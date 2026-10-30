import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), Components({ dirs: [], dts: false, resolvers: [ElementPlusResolver({ importStyle: false })] })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@tabler/icons-vue')) return 'icons'
          if (id.includes('marked') || id.includes('dompurify')) return 'markdown'
          if (id.includes('/node_modules/vue/') || id.includes('/node_modules/@vue/')) return 'vue'
        },
      },
    },
  },
})
