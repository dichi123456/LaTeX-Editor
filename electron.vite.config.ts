import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// 插件：移除 HTML 中的 crossorigin 属性（file:// 协议下会阻止资源加载）
function removeCrossorigin() {
  return {
    name: 'remove-crossorigin',
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      return html.replace(/ crossorigin/g, '')
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('electron')
      }
    },
    // 主进程入口在 electron/main.ts
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'electron/main.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'electron/preload.ts')
      }
    }
  },
  renderer: {
    root: resolve(__dirname),
    plugins: [vue(), removeCrossorigin()],
    resolve: {
      alias: {
        '@': resolve('src')
      }
    },
    optimizeDeps: {
      exclude: ['pdfjs-dist']
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      },
      // 不加 crossorigin，避免 file:// 协议下加载失败
      modulePreload: {
        resolveDependencies: () => []
      }
    }
  }
})
