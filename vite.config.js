import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 项目站点部署在子路径下（https://用户名.github.io/仓库名/），需要设置 base。
// 注意：Android 构建用 `vite build --base=./` 会在命令行覆盖此值，不影响 APK。
const base = '/workout-segment-player/'

export default defineConfig({
  base,
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '运动分段跟练',
        short_name: '跟练',
        description: '运动视频分段循环跟练工具',
        theme_color: '#10b981',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: base,
        scope: base,
        lang: 'zh-CN',
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      }
    })
  ]
})
