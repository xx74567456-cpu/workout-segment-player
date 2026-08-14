import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor 配置：把前端 Web 代码打包成原生 App（安卓 / iOS）
const config: CapacitorConfig = {
  // 应用唯一标识（安卓包名，反域名格式）
  appId: 'com.fitsegment.app',
  // 安装到手机上显示的名称
  appName: '跟练',
  // 前端构建产物目录
  webDir: 'dist',
}

export default config
