// 语音控制：统一封装「浏览器 Web Speech API」与「安卓原生插件」两种识别方式。
// 浏览器端用系统 SpeechRecognition（零依赖），安卓 App 端用 @capgo/capacitor-speech-recognition，
// 由 Capacitor.isNativePlatform() 自动选择。对外暴露统一的 start / stop / onCommand。
import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { SpeechRecognition as NativeSpeechRecognition } from '@capgo/capacitor-speech-recognition'

const isNative = Capacitor.isNativePlatform()

/**
 * 从识别文本中匹配语音命令。
 * 返回 'prev' | 'next' | 'pause' | 'play' 之一，未命中返回 null。
 * 方向口令用「前进/后退」（发音差异大、不易混淆），同时兼容「下一个/上一个」。
 */
export function matchCommand(text) {
  if (!text) return null
  // 只保留中英文和数字，去掉标点/空格，避免识别结果带标点导致漏配
  const t = String(text).toLowerCase().replace(/[^a-z0-9一-龥]/g, '')
  const isNext = /(前进|往前|向前|下一个|下个|下一)/.test(t)
  const isPrev = /(后退|往后|向后|上一个|上个|上一)/.test(t)
  // 「前/后」「上/下」方向词同时出现视为方向不确定，返回 null，避免误判方向
  if (isPrev && isNext) return null
  if (isPrev) return 'prev'
  if (isNext) return 'next'
  if (/(暂停|停止)/.test(t)) return 'pause'
  if (/(播放|开始|继续)/.test(t)) return 'play'
  return null
}

export function useVoiceControl() {
  // 当前环境是否支持语音识别
  const supported = ref(false)
  // 是否正在持续监听
  const isListening = ref(false)
  // 错误提示（权限被拒、设备不支持等）
  const error = ref('')

  let commandCb = null
  let webRecognition = null
  let endTimer = null
  let resultTimer = null

  // 命令冷却：同一命令短时间内的重复命中（中间结果反复更新）只触发一次
  let lastCmd = null
  let lastCmdAt = 0

  // 启动互斥：原生端在 await 权限/可用性检查期间 isListening 尚未置 true，
  // 快速连点会开出多条识别循环，用 starting 标记挡住并发启动
  let starting = false

  /** 命中命令后回调（去重 + 防抖的统一出口） */
  function dispatch(text, cmd) {
    if (!cmd) cmd = matchCommand(text)
    if (!cmd || !commandCb) return
    const now = Date.now()
    // 冷却窗口：中间结果（interim）与最终结果（final）对同一句话会先后各命中一次，
    // 间隔常在 0.5~2 秒；原生端同段语音也可能被识别器重复返回。3 秒冷却能覆盖这些重复，
    // 而跟练场景下用户不会在 3 秒内连续下达同一命令，不影响体验。
    if (cmd === lastCmd && now - lastCmdAt < 3000) return
    lastCmd = cmd
    lastCmdAt = now
    commandCb(cmd)
  }

  // ---------- 浏览器实现（Web Speech API） ----------

  /** 稳健重启识别器：start 失败（可能仍在 ending 状态）时延迟再试一次，避免识别器静默死掉 */
  function tryStartWeb() {
    if (!webRecognition || !isListening.value) return
    try {
      webRecognition.start()
    } catch {
      endTimer = setTimeout(() => {
        if (!isListening.value) return
        try {
          webRecognition.start()
        } catch {
          /* 连续两次失败则放弃，等待下一次 onend 再重启 */
        }
      }, 400)
    }
  }

  function initWeb() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return false
    const recognition = new SR()
    recognition.lang = 'zh-CN'
    // 持续监听（continuous）：识别器保持运行，避免「说完就 stop/start」的高频循环，
    // 该循环会抢占音频、导致视频播放一卡一卡甚至无声。
    // 历史结果累积问题用 resultIndex（只处理本次新增结果）规避，不重放旧命令。
    recognition.continuous = true
    // 开启中间结果：continuous 模式下 Chrome 的最终结果（isFinal）常常迟迟不来，
    // 必须用中间结果实时匹配；再配合防抖等结果稳定后触发，兼顾响应与准确
    recognition.interimResults = true
    // 返回多个候选文本：用于交叉校验方向，命中任一候选即可，提高召回率（减少漏识别）
    recognition.maxAlternatives = 3
    recognition.onresult = (e) => {
      // 只取最新一条结果（results 末尾）：Chrome 的 continuous 模式 resultIndex 不可靠，
      // 若从 resultIndex 遍历会把历史结果（第一个口令）反复匹配，导致「说一次就锁定」
      const r = e.results[e.results.length - 1]
      if (!r) return
      let firstCmd = null
      let firstText = null
      let prevN = 0
      let nextN = 0
      for (let j = 0; j < r.length; j++) {
        const text = r[j] && r[j].transcript
        const cmd = matchCommand(text)
        if (!cmd) continue
        if (!firstCmd) {
          firstCmd = cmd
          firstText = text
        }
        if (cmd === 'prev') prevN++
        else if (cmd === 'next') nextN++
      }
      if (!firstCmd) return
      // 方向消歧：prev/next 同时出现时按多数票决定，平票则采信最高置信度候选（firstCmd）
      let finalCmd = firstCmd
      if (prevN && nextN && prevN !== nextN) {
        finalCmd = prevN > nextN ? 'prev' : 'next'
      }
      // 防抖：结果稳定 150ms 后触发，兼顾响应速度，并过滤话说一半的半成品
      if (resultTimer) clearTimeout(resultTimer)
      resultTimer = setTimeout(() => dispatch(firstText, finalCmd), 150)
    }
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        error.value = '麦克风权限被拒绝，请在浏览器中允许'
        isListening.value = false // 权限被拒时停止，避免无意义的重启循环
      } else if (e.error === 'no-speech') {
        // 静音超时属于正常，静默忽略，交由 onend 重启
      } else if (e.error === 'aborted') {
        // 主动 stop 或重启导致的打断，忽略
      } else {
        // 网络 / 服务等异常：提示一次，交由 onend 重启重试
        error.value = '语音识别异常，正在重试…'
      }
    }
    // continuous 模式下识别器应持续运行；若因错误/静音意外结束且仍在监听，则延迟重启兜底
    recognition.onend = () => {
      if (endTimer) clearTimeout(endTimer)
      if (isListening.value) {
        endTimer = setTimeout(tryStartWeb, 300)
      }
    }
    webRecognition = recognition
    return true
  }

  // ---------- 原生实现（Capacitor 插件） ----------

  async function nativeLoop() {
    while (isListening.value) {
      try {
        // partialResults 默认 false：识别完一段后 resolve，返回最终匹配结果
        const res = await NativeSpeechRecognition.start({ language: 'zh-CN', popup: false })
        const matches = res?.matches || []
        for (const m of matches) {
          const cmd = matchCommand(m)
          if (cmd) {
            // 统一走 dispatch，让原生端也享受同一套冷却去重，避免一段语音被识别器重复返回时执行多遍
            dispatch(m, cmd)
            break
          }
        }
      } catch {
        // 被 stop() 中断或识别出错，均交由 while 条件判断是否继续
      }
      if (isListening.value) {
        await new Promise((r) => setTimeout(r, 300))
      }
    }
  }

  async function start() {
    if (isListening.value || starting) return
    starting = true
    try {
      if (isNative) {
        try {
          const avail = await NativeSpeechRecognition.available()
          if (!avail.available) {
            error.value = '设备不支持语音识别'
            return
          }
          const perm = await NativeSpeechRecognition.requestPermissions()
          if (perm.speechRecognition !== 'granted') {
            error.value = '未授权麦克风权限'
            return
          }
        } catch {
          error.value = '语音初始化失败'
          return
        }
        isListening.value = true
        nativeLoop()
      } else {
        if (!webRecognition && !initWeb()) {
          error.value = '浏览器不支持语音识别'
          return
        }
        try {
          webRecognition.start()
          isListening.value = true
        } catch (err) {
          // 启动失败（如上次会话未完全结束）：不误设为监听中，提示稍后重试
          console.error('语音启动失败', err)
          error.value = '语音启动失败，请稍后重试'
          isListening.value = false
        }
      }
      error.value = ''
    } finally {
      starting = false
    }
  }

  function stop() {
    if (!isListening.value) return
    isListening.value = false
    if (endTimer) clearTimeout(endTimer)
    if (isNative) {
      NativeSpeechRecognition.stop().catch(() => {})
    } else if (webRecognition) {
      try {
        webRecognition.stop()
      } catch {
        /* 忽略 */
      }
    }
  }

  function onCommand(cb) {
    commandCb = cb
  }

  // 初始化时探测支持性
  if (isNative) {
    supported.value = true
  } else {
    initWeb()
    if (webRecognition) supported.value = true
  }

  return { supported, isListening, error, start, stop, onCommand }
}
