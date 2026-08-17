// 全局应用状态：用 Vue 的 reactive 管理当前视图和选中项，不做复杂的状态库。
import { reactive } from 'vue'

export const store = reactive({
  // 底部导航当前页：library | categories | checkin
  tab: 'library',
  // 视频库当前筛选的文件夹 id，null 表示「全部」
  activeFolderId: null,
  // 全屏覆盖视图持有的视频对象（含 blob，播放/编辑时引用，不复制）
  playerVideo: null,
  editorVideo: null,
})

/** 打开播放器 */
export function openPlayer(video) {
  store.playerVideo = video
}

/** 关闭播放器 */
export function closePlayer() {
  store.playerVideo = null
}

/** 打开编辑器 */
export function openEditor(video) {
  store.editorVideo = video
}

/** 关闭编辑器 */
export function closeEditor() {
  store.editorVideo = null
}

// ---------- 轻量全局提示（toast） ----------

export const toast = reactive({
  show: false,
  message: '',
})

let toastTimer = null

/** 弹出一条短暂提示，默认 1.5 秒后自动消失 */
export function showToast(message, duration = 1500) {
  toast.message = message
  toast.show = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.show = false
  }, duration)
}

// ---------- 全局对话框（替代原生 confirm / alert / prompt） ----------

export const dialog = reactive({
  show: false,
  type: 'confirm', // 'confirm' | 'alert' | 'prompt'
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
  placeholder: '',
  inputValue: '',
  _resolve: null,
})

function openDialog(opts) {
  return new Promise((resolve) => {
    dialog.type = opts.type || 'confirm'
    dialog.title = opts.title || ''
    dialog.message = opts.message || ''
    dialog.confirmText = opts.confirmText || (dialog.type === 'alert' ? '知道了' : '确定')
    dialog.cancelText = opts.cancelText || '取消'
    dialog.danger = !!opts.danger
    dialog.placeholder = opts.placeholder || ''
    dialog.inputValue = opts.inputValue || ''
    dialog._resolve = resolve
    dialog.show = true
  })
}

/** 确认框：确定 resolve(true)，取消 resolve(false) */
export function showConfirm(opts = {}) {
  return openDialog({ ...opts, type: 'confirm' })
}

/** 提示框：仅一个按钮，点击 resolve(true) */
export function showAlert(opts = {}) {
  return openDialog({ ...opts, type: 'alert' })
}

/** 输入框：确定 resolve(输入值)，取消 resolve(null) */
export function showPrompt(opts = {}) {
  return openDialog({ ...opts, type: 'prompt' })
}

/** 关闭对话框并回传结果（由 Dialog 组件调用） */
export function closeDialog(result) {
  dialog.show = false
  if (dialog._resolve) {
    dialog._resolve(result)
    dialog._resolve = null
  }
}

// ---------- 主题（深色 / 浅色） ----------

export const theme = reactive({
  dark: false,
})

const THEME_KEY = 'fit-segment:theme'

/** 应用主题到根元素，并记忆到 localStorage */
export function applyTheme(dark) {
  theme.dark = dark
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  } catch {}
}

/** 启动时恢复主题 */
export function initTheme() {
  let dark = false
  try {
    dark = localStorage.getItem(THEME_KEY) === 'dark'
  } catch {}
  applyTheme(dark)
}

export function toggleTheme() {
  applyTheme(!theme.dark)
}
