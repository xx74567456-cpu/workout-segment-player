<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { addCheckin, getAllCheckins, deleteCheckinsByVideo } from '../db'
import { store, closePlayer, showToast } from '../store'
import { formatTime, todayStr } from '../utils'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { StatusBar } from '@capacitor/status-bar'
import { useVoiceControl } from '../composables/useVoiceControl'

const video = computed(() => store.playerVideo)
const segments = computed(() => video.value?.segments || [])

/** 用于气泡显示的段：未命名的动作按时间顺序重编号为「动作 N」 */
const displaySegments = computed(() =>
  segments.value.map((s, i) => ({
    ...s,
    displayName: !s.name || /^动作\s*\d+$/.test(s.name.trim()) ? `动作 ${i + 1}` : s.name,
  }))
)

const videoEl = ref(null)
const url = ref('')
const currentIndex = ref(0)
const currentTime = ref(0)
const playing = ref(false)
const rate = ref(1)
const RATES = [0.75, 1, 1.5, 2, 3, 4, 5]
const rateMenuOpen = ref(false)
// 音量（0~1），由进度条旁的音量按钮调节；持久化到 localStorage 记忆上次设置
const VOLUME_KEY = 'fit-segment:volume'
function readVolume() {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY))
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1
  } catch {
    return 1
  }
}
const volume = ref(readVolume())
const volumeMenuOpen = ref(false)
const duration = ref(0)
const playerEl = ref(null)
const isFullscreen = ref(false)
const controlsVisible = ref(true)
const segListEl = ref(null)

// 缓存视频 id（组件卸载时 video.value 已为 null，保存播放记录需要用到）
let videoId = null

// 打卡次数
const checkinCount = ref(0)

// 设置菜单
const settingsMenuOpen = ref(false)

async function loadCheckinCount() {
  try {
    const all = await getAllCheckins()
    checkinCount.value = all.filter((c) => c.videoId === videoId).length
  } catch {
    checkinCount.value = 0
  }
}

const currentSegment = computed(() =>
  segments.value.length ? segments.value[currentIndex.value] : null
)

const hasSegments = computed(() => segments.value.length > 0)

function playCurrent() {
  const v = videoEl.value
  if (!v) return
  const seg = currentSegment.value
  v.currentTime = seg ? seg.start : 0
  currentTime.value = v.currentTime
  // 播放状态交由 @play/@pause 事件同步；自动播放可能被浏览器拦截（非静音视频需用户手势）
  v.play().catch(() => {})
}

function togglePlay() {
  const v = videoEl.value
  if (!v) return
  if (v.paused) {
    v.play().catch((err) => {
      // 用户主动点播放仍失败，说明视频本身有问题（编码不支持 / 数据损坏）
      console.error('播放失败', err)
      showToast('视频无法播放，请重新导入该视频', 2500)
    })
  } else {
    v.pause()
  }
  scheduleAutoHide()
}

/** 视频加载失败时给出明确提示，便于区分「加载失败」和「自动播放被拦截」 */
function onVideoError() {
  showToast('视频加载失败，请重新导入该视频', 2500)
}

let clickTimer = null
let hideTimer = null

/** 单击/双击区分：单击切换控制条显隐，双击播放/暂停 */
function onVideoClick() {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
    togglePlay()
  } else {
    clickTimer = setTimeout(() => {
      clickTimer = null
      toggleControls()
    }, 250)
  }
}

function toggleControls() {
  controlsVisible.value = !controlsVisible.value
  if (controlsVisible.value) {
    scheduleAutoHide()
  } else if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleAutoHide() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    controlsVisible.value = false
  }, 5000)
}

/** 跳转到指定时间点（有分段时自动定位到所在片段） */
function seekTo(t) {
  const v = videoEl.value
  if (!v) return
  const total = v.duration || duration.value || 0
  t = Math.max(0, Math.min(total, t))
  if (hasSegments.value) {
    let idx = segments.value.findIndex((s) => t >= s.start && t < s.end)
    if (idx === -1) {
      // 落在片段间隙：跳转到落点之后的第一个片段起点，否则最后一段
      idx = segments.value.findIndex((s) => s.start >= t)
      if (idx === -1) idx = segments.value.length - 1
      t = segments.value[idx].start
    }
    currentIndex.value = idx
  }
  v.currentTime = t
  currentTime.value = t
}

// 拖动进度条状态
const dragging = ref(false)

/** 由指针位置换算目标时间（秒） */
function timeFromPointer(e) {
  const track = e.currentTarget
  const rect = track.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  return ratio * (videoEl.value.duration || duration.value || 0)
}

/** 按下：开始拖动，实时预览进度 */
function onSeekPointerDown(e) {
  dragging.value = true
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    /* 某些环境不支持 pointer capture，忽略 */
  }
  currentTime.value = timeFromPointer(e)
}

/** 拖动中：更新预览进度 */
function onSeekPointerMove(e) {
  if (!dragging.value) return
  currentTime.value = timeFromPointer(e)
}

/** 松手：定位到最终时间点 */
function onSeekPointerUp(e) {
  if (!dragging.value) return
  dragging.value = false
  seekTo(timeFromPointer(e))
  scheduleAutoHide()
}

/** 设置播放倍速 */
function setRate(r) {
  rate.value = r
  videoEl.value.playbackRate = r
  rateMenuOpen.value = false
  scheduleAutoHide()
}

function toggleRateMenu() {
  rateMenuOpen.value = !rateMenuOpen.value
  scheduleAutoHide()
}

function toggleVolumeMenu() {
  volumeMenuOpen.value = !volumeMenuOpen.value
  scheduleAutoHide()
}

/** 把当前音量应用到视频元素 */
function applyVolume() {
  const v = videoEl.value
  if (!v) return
  v.volume = volume.value
  v.muted = volume.value === 0
}

/** 拖动音量滑块时实时应用到视频，并记忆到 localStorage */
function onVolumeInput() {
  applyVolume()
  try {
    localStorage.setItem(VOLUME_KEY, String(volume.value))
  } catch {
    /* localStorage 不可用时静默失败 */
  }
}

/** 判断视频是否为横屏（宽 > 高） */
function videoIsLandscape() {
  const v = videoEl.value
  if (v && v.videoWidth && v.videoHeight) return v.videoWidth > v.videoHeight
  return true
}

/** 切换全屏：横屏视频锁横屏、竖屏视频锁竖屏，并隐藏状态栏实现沉浸全屏 */
async function toggleFullscreen() {
  if (!isFullscreen.value) {
    const landscape = videoIsLandscape()
    try {
      await ScreenOrientation.lock({ orientation: landscape ? 'landscape' : 'portrait' })
    } catch {}
    try {
      await StatusBar.hide()
    } catch {}
    isFullscreen.value = true
  } else {
    try {
      await ScreenOrientation.unlock()
    } catch {}
    try {
      await StatusBar.show()
    } catch {}
    isFullscreen.value = false
  }
  scheduleAutoHide()
}

/** 核心循环逻辑：当前段到末尾时跳回段首，实现单段循环 */
function onTimeUpdate() {
  const v = videoEl.value
  // 拖动进度条期间暂停自动更新，避免预览位置被播放进度覆盖
  if (dragging.value) return
  currentTime.value = v.currentTime
  const seg = currentSegment.value
  if (seg) {
    if (v.currentTime >= seg.end) {
      v.currentTime = seg.start
      playReplayBeep() // 单段循环：当前动作重播
    }
  } else if (v.duration && v.currentTime >= v.duration - 0.1) {
    v.currentTime = 0
    playReplayBeep() // 无分段：整段重播
  }
}

// ---------- 音效 ----------

let audioCtx = null

/** 获取（并唤醒）共用的 AudioContext，不可用时返回 null */
function ensureAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      audioCtx = new AC()
    }
    if (audioCtx.state === 'suspended') audioCtx.resume()
    return audioCtx
  } catch {
    return null
  }
}

/** 合成一个短促提示音（delay 秒后响起，可叠加实现双音） */
function tone(freq, { duration = 0.12, type = 'sine', volume = 0.18, delay = 0 } = {}) {
  const ctx = ensureAudio()
  if (!ctx) return
  try {
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.setValueAtTime(volume, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + duration)
  } catch {
    // 音频不可用时静默失败
  }
}

/** 切换动作：单声「滴」，音调随方向（上高下低） */
function playSwitchBeep(freq) {
  tone(freq)
}

/** 动作重播：两个短促「滴滴」，三角波音色，与切换的单声区分 */
function playReplayBeep() {
  tone(523, { duration: 0.07, type: 'triangle' })
  tone(523, { duration: 0.07, type: 'triangle', delay: 0.15 })
}

function next() {
  if (!hasSegments.value) {
    // 无分段：整段循环，下一个就是重播
    playCurrent()
    scheduleAutoHide()
    return
  }
  if (currentIndex.value < segments.value.length - 1) {
    currentIndex.value++
    playCurrent()
    playSwitchBeep(880) // 下一个动作：上行音
  } else {
    // 最后一段练完
    finish()
  }
  scheduleAutoHide()
}

function prev() {
  if (!hasSegments.value) {
    // 无分段：整段循环，「后退」等价于重播当前，保证有响应
    playCurrent()
    scheduleAutoHide()
    return
  }
  if (currentIndex.value > 0) {
    currentIndex.value--
  } else {
    // 已在第一个动作：循环到最后一个，保证「后退」始终有响应
    currentIndex.value = segments.value.length - 1
  }
  playCurrent()
  playSwitchBeep(660) // 上一个动作：下行音
  scheduleAutoHide()
}

function jumpTo(i) {
  const changed = i !== currentIndex.value
  currentIndex.value = i
  playCurrent()
  if (changed) playSwitchBeep(760) // 点击跳转：中性音
  scheduleAutoHide()
}

/** 当前动作变化时，把对应气泡滚动到列表水平居中，方便查看前后动作 */
watch(currentIndex, () => {
  nextTick(centerActiveChip)
})

function centerActiveChip() {
  const list = segListEl.value
  if (!list) return
  const chip = list.children[currentIndex.value]
  if (!chip) return
  const target = chip.offsetLeft + chip.offsetWidth / 2 - list.clientWidth / 2
  list.scrollTo({ left: target, behavior: 'smooth' })
}

async function finish() {
  const name = video.value?.name || '视频'
  if (confirm(`「${name}」本次训练完成，打卡一次？`)) {
    await addCheckin({ videoId: video.value.id, date: todayStr(), timestamp: Date.now() })
    checkinCount.value++
    alert('已打卡！干得漂亮 💪')
  }
}

// ---------- 设置菜单 ----------

function toggleSettingsMenu() {
  settingsMenuOpen.value = !settingsMenuOpen.value
  scheduleAutoHide()
}

async function clearCheckins() {
  settingsMenuOpen.value = false
  if (!confirm('确定清除当前视频的全部打卡次数吗？此操作不可恢复。')) return
  try {
    await deleteCheckinsByVideo(videoId)
    checkinCount.value = 0
  } catch (err) {
    alert('清除失败：' + err.message)
  }
}

// ---------- 语音控制 ----------

const voice = useVoiceControl()
const voiceListening = computed(() => voice.isListening.value)
const voiceSupported = computed(() => voice.supported.value)
const VOICE_LABEL = { next: '前进', prev: '后退', play: '播放', pause: '暂停' }

/** 语音命令命中后，复用现有的 next / prev / togglePlay 逻辑 */
function handleVoiceCommand(cmd) {
  if (cmd === 'next') {
    next()
  } else if (cmd === 'prev') {
    prev()
  } else if (cmd === 'play') {
    if (videoEl.value?.paused) togglePlay()
  } else if (cmd === 'pause') {
    if (!videoEl.value?.paused) togglePlay()
  }
  showToast(`🎤 ${VOICE_LABEL[cmd]}`)
  scheduleAutoHide()
}

// 语音开启前的音量：语音识别期间临时调低视频音量、关闭时恢复，
// 减少视频背景音被麦克风拾取导致的误识别（非静音，只是变小声）
let volumeBeforeVoice = null

/** 顶栏麦克风按钮：手动开关持续监听 */
async function toggleVoice() {
  if (voice.isListening.value) {
    voice.stop()
    if (volumeBeforeVoice !== null) {
      volume.value = volumeBeforeVoice
      applyVolume()
      volumeBeforeVoice = null
    }
    showToast('🎤 语音已关闭')
  } else {
    await voice.start()
    // 仅当语音真正开启成功时才降低视频音量，避免启动失败时音量被误降
    if (voice.isListening.value) {
      volumeBeforeVoice = volume.value
      volume.value = Math.min(volume.value, 0.4)
      applyVolume()
      showToast('🎤 语音已开启')
    }
  }
}

voice.onCommand(handleVoiceCommand)
watch(
  () => voice.error.value,
  (err) => {
    if (err) showToast(err, 2500)
  }
)

// ---------- 播放记录（localStorage 轻量持久化） ----------

function progressKey(id) {
  return `fit-segment:progress:${id}`
}

/** 读取某个视频上次的播放记录（动作段位置 + 时间） */
function loadProgress(id) {
  try {
    const raw = localStorage.getItem(progressKey(id))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** 保存本次播放记录 */
function saveProgress() {
  if (!videoId) return
  try {
    localStorage.setItem(
      progressKey(videoId),
      JSON.stringify({ index: currentIndex.value, time: currentTime.value })
    )
  } catch {
    // localStorage 不可用时静默失败，不影响关闭
  }
}

onMounted(() => {
  videoId = video.value?.id || null
  if (video.value?.blob) {
    url.value = URL.createObjectURL(video.value.blob)
    // 等视频可播放后记录时长并定位到第一段
    videoEl.value.addEventListener(
      'loadedmetadata',
      () => {
        duration.value = videoEl.value.duration
        // 应用记忆的音量（默认 1，若上次调过则恢复）
        videoEl.value.volume = volume.value
        videoEl.value.muted = volume.value === 0
        // 恢复上次播放记录：有分段则定位到上次动作段
        const p = loadProgress(videoId)
        if (p && hasSegments.value && p.index >= 0 && p.index < segments.value.length) {
          currentIndex.value = p.index
        }
        playCurrent()
        // 无分段时恢复到上次整段播放时间
        if (p && !hasSegments.value && typeof p.time === 'number' && p.time > 0) {
          const t = Math.min(p.time, duration.value - 0.1)
          videoEl.value.currentTime = t
          currentTime.value = t
        }
      },
      { once: true }
    )
  }
  loadCheckinCount()
  scheduleAutoHide()
  // 语音默认关闭：持续监听会一直占用麦克风采集，容易干扰视频播放（卡顿/无声），
  // 需要时再点顶栏麦克风按钮手动开启。
})

onBeforeUnmount(() => {
  // 关闭前保存本次播放记录
  saveProgress()
  // 退出播放器时恢复屏幕方向与状态栏，避免 App 停留在横屏
  ScreenOrientation.unlock().catch(() => {})
  StatusBar.show().catch(() => {})
  if (url.value) URL.revokeObjectURL(url.value)
  if (clickTimer) clearTimeout(clickTimer)
  if (hideTimer) clearTimeout(hideTimer)
  voice.stop()
})
</script>

<template>
  <div ref="playerEl" class="player" :class="{ fullscreen: isFullscreen }" @click.self="onVideoClick">
    <!-- 视频 -->
    <div ref="wrapEl" class="video-wrap">
      <div class="video-stage">
        <video
          ref="videoEl"
          class="video"
          :src="url"
          playsinline
          webkit-playsinline
          @timeupdate="onTimeUpdate"
          @play="playing = true"
          @pause="playing = false"
          @error="onVideoError"
          @click="onVideoClick"
        ></video>

        <!-- 顶部栏：覆盖在视频上，半透明，随控制条一起呼出/消失 -->
        <header class="topbar" :class="{ hidden: !controlsVisible }">
          <button class="icon-btn" @click="closePlayer">✕</button>
          <div class="title">
            <div class="video-name">{{ video?.name }}</div>
            <div class="seg-name">
              {{ hasSegments ? `动作 ${currentIndex + 1}/${segments.length} · ${currentSegment.name}` : '整段循环' }}
            </div>
          </div>
          <button
            class="icon-btn"
            :aria-label="isFullscreen ? '退出全屏' : '全屏'"
            @click="toggleFullscreen"
          >
            <svg class="fs-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path
                v-if="isFullscreen"
                d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
              />
              <path v-else d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          </button>
          <button
            class="icon-btn mic-btn"
            :class="{ active: voiceListening, off: !voiceSupported }"
            :disabled="!voiceSupported"
            :aria-label="voiceListening ? '关闭语音' : '开启语音'"
            :title="voiceListening ? '语音监听中，点击关闭' : '开启语音控制'"
            @click="toggleVoice"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          </button>
          <button class="icon-btn" aria-label="打卡" @click="finish">
        <span class="checkin-pill">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" fill-rule="evenodd" aria-hidden="true">
            <path d="M5 3h2v18H5zM7 3h12v12H7zM11 3h4v4h-4zM7 7h4v4H7zM15 7h4v4h-4zM11 11h4v4h-4z" />
          </svg>
          <span class="checkin-num">{{ checkinCount }}</span>
        </span>
      </button>
          <div class="settings-wrap">
            <button class="icon-btn" aria-label="设置" @click="toggleSettingsMenu">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.49.49 0 0 0-.49-.42h-3.84c-.24 0-.45.17-.49.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.61.22L2.74 8.87c-.12.21-.07.47.12.64l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.31.61.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.42.49.42h3.84c.24 0 .45-.17.49-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.09.49 0 .61-.22l1.92-3.32c.12-.22.07-.47-.12-.64l-2.02-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
            </button>
            <div v-if="settingsMenuOpen" class="settings-menu">
              <button class="settings-option danger" @click="clearCheckins">清除打卡次数</button>
            </div>
          </div>
        </header>

        <!-- 底部覆盖层：动作选择 + 进度条，随控制条一起呼出/消失 -->
        <div class="video-overlay" :class="{ hidden: !controlsVisible }">
          <p class="hint">
            {{
              hasSegments
                ? currentIndex === segments.length - 1
                  ? '最后一个动作，练完点 🏁 打卡'
                  : '练完点 ⏭ 切下一个动作'
                : '单击显示进度条，双击播放/暂停'
            }}
          </p>
          <div v-if="hasSegments" ref="segListEl" class="seg-list">
            <button
              v-for="(s, i) in displaySegments"
              :key="s.id"
              class="seg-chip"
              :class="{ active: i === currentIndex }"
              @click="jumpTo(i)"
            >
              {{ i + 1 }}. {{ s.displayName }}
            </button>
          </div>
          <div v-if="duration" class="seek-bar">
            <div class="seek-row">
              <div
                class="seek-track"
                @pointerdown="onSeekPointerDown"
                @pointermove="onSeekPointerMove"
                @pointerup="onSeekPointerUp"
                @pointercancel="onSeekPointerUp"
              >
                <div class="seek-played" :style="{ width: (currentTime / duration) * 100 + '%' }"></div>
                <div
                  v-for="(s, i) in segments"
                  :key="s.id"
                  class="seg-block"
                  :class="{ active: i === currentIndex }"
                  :style="{
                    left: (s.start / duration) * 100 + '%',
                    width: Math.max(((s.end - s.start) / duration) * 100, 2) + '%'
                  }"
                ></div>
                <template v-for="s in segments" :key="'divider-' + s.id">
                  <div
                    v-if="s.start > 0"
                    class="seg-divider"
                    :style="{ left: (s.start / duration) * 100 + '%' }"
                  ></div>
                </template>
                <div class="seek-thumb" :style="{ left: (currentTime / duration) * 100 + '%' }"></div>
              </div>
              <div class="volume-wrap">
                <button
                  class="volume-btn"
                  :aria-label="'音量 ' + Math.round(volume * 100) + '%'"
                  @click="toggleVolumeMenu"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path
                      v-if="volume > 0"
                      d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                    />
                    <path
                      v-else
                      d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
                    />
                  </svg>
                </button>
                <div v-if="volumeMenuOpen" class="volume-menu">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    v-model.number="volume"
                    class="volume-slider"
                    @input="onVolumeInput"
                  />
                  <span class="volume-num">{{ Math.round(volume * 100) }}%</span>
                </div>
              </div>
              <div class="rate-wrap">
                <button class="rate-btn" @click="toggleRateMenu">倍速 {{ rate }}x</button>
                <div v-if="rateMenuOpen" class="rate-menu">
                  <button
                    v-for="r in RATES"
                    :key="r"
                    class="rate-option"
                    :class="{ active: rate === r }"
                    @click="setRate(r)"
                  >
                    {{ r }}x
                  </button>
                </div>
              </div>
            </div>
            <div class="seek-time">
              <span>{{ formatTime(currentTime) }}</span>
              <span>{{ formatTime(duration) }}</span>
            </div>
          </div>
        </div>

        <!-- 视频中央控制按钮：半透明，单击唤出 -->
        <div class="video-controls" :class="{ hidden: !controlsVisible }">
          <button class="v-btn" :disabled="!hasSegments || currentIndex === 0" @click="prev">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>
          <button class="v-btn big" @click="togglePlay">
            <svg v-if="playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button class="v-btn" @click="next">
            <svg
              v-if="hasSegments && currentIndex === segments.length - 1"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  color: var(--text);
}

.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  padding-top: calc(10px + env(safe-area-inset-top));
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(4px);
  transition: opacity 0.25s ease;
}

.topbar.hidden {
  opacity: 0;
  pointer-events: none;
}

.icon-btn {
  font-size: 20px;
  padding: 6px 10px;
  color: var(--text);
}

/* 语音麦克风按钮：监听中高亮并呼吸闪烁，不支持时置灰 */
.mic-btn {
  display: flex;
  align-items: center;
  justify-content: center;
}

.mic-btn svg {
  display: block;
}

.mic-btn.active {
  color: var(--primary);
}

.mic-btn.active svg {
  animation: mic-pulse 1.6s ease-in-out infinite;
}

.mic-btn.off {
  opacity: 0.4;
}

@keyframes mic-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.18);
    opacity: 0.55;
  }
}

.checkin-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--primary);
  color: #06281c;
}

.checkin-num {
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.settings-wrap {
  position: relative;
}

.settings-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 20;
  min-width: 140px;
}

.settings-option {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text);
  background: transparent;
  text-align: left;
  white-space: nowrap;
}

.settings-option.danger {
  color: var(--danger);
}

.fs-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.title {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.video-name {
  font-size: 14px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seg-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--primary);
}

.video-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
}

.video-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video {
  width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #000;
  transition: transform 0.3s ease;
}

.seg-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 4px;
}

.seg-chip {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #000;
  font-size: 13px;
  white-space: nowrap;
  backdrop-filter: blur(4px);
}

.seg-chip.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #06281c;
  font-weight: 700;
}

/* 底部覆盖层：动作选择 + 进度条，随控制条一起呼出/消失 */
.video-overlay {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: opacity 0.25s ease;
}

.video-overlay.hidden {
  opacity: 0;
  pointer-events: none;
}

.seek-bar {
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  backdrop-filter: blur(4px);
}

.seek-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.seek-track {
  flex: 1;
  position: relative;
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  cursor: pointer;
  /* 触摸拖动时禁止页面滚动/缩放，保证拖动流畅 */
  touch-action: none;
}

.seek-played {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: rgba(52, 211, 153, 0.5);
  border-radius: 3px;
  pointer-events: none;
  z-index: 2;
}

.seg-block {
  position: absolute;
  top: 0;
  bottom: 0;
  background: #d1fae5;
  border-radius: 3px;
  cursor: pointer;
  z-index: 1;
}

.seg-block.active {
  background: #fde68a;
}

.seg-divider {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: #fff;
  border-radius: 1px;
  z-index: 2;
  pointer-events: none;
}

.seek-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--primary);
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  pointer-events: none;
  z-index: 3;
}

.seek-time {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 11px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

/* 视频中央控制按钮：半透明，单击唤出 */
.video-controls {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 32px;
  transition: opacity 0.25s ease;
}

.video-controls.hidden {
  opacity: 0;
  pointer-events: none;
}

.v-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
}

.v-btn.big {
  width: 74px;
  height: 74px;
}

.v-btn svg {
  width: 24px;
  height: 24px;
}

.v-btn.big svg {
  width: 34px;
  height: 34px;
}

.v-btn:disabled {
  opacity: 0.35;
}

/* 全屏时放大中央控制按钮 */
.player.fullscreen .v-btn {
  width: 72px;
  height: 72px;
}

.player.fullscreen .v-btn.big {
  width: 96px;
  height: 96px;
}

.player.fullscreen .v-btn svg {
  width: 32px;
  height: 32px;
}

.player.fullscreen .v-btn.big svg {
  width: 46px;
  height: 46px;
}

/* 音量按钮（进度条右侧，倍速按钮旁） */
.volume-wrap {
  position: relative;
  flex-shrink: 0;
}

.volume-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.28);
  color: #000;
}

.volume-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 20;
}

.volume-slider {
  width: 120px;
  accent-color: var(--primary);
}

.volume-num {
  font-size: 12px;
  color: var(--text);
  min-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 倍速按钮（进度条右侧） */
.rate-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.28);
  color: #000;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.rate-wrap {
  position: relative;
}

.rate-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  display: flex;
  gap: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 20;
  flex-wrap: wrap;
  max-width: 220px;
}

.rate-option {
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  background: transparent;
}

.rate-option.active {
  background: var(--primary);
  color: #06281c;
  font-weight: 700;
}

.hint {
  align-self: flex-start;
  width: fit-content;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: #000;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  backdrop-filter: blur(4px);
}
</style>
