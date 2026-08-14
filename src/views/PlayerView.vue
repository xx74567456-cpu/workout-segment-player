<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { addCheckin, getAllCheckins, deleteCheckinsByVideo } from '../db'
import { store, closePlayer } from '../store'
import { formatTime, todayStr } from '../utils'

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
  v.play().catch(() => {})
  playing.value = true
}

function togglePlay() {
  const v = videoEl.value
  if (!v) return
  if (v.paused) {
    v.play().catch(() => {})
    playing.value = true
  } else {
    v.pause()
    playing.value = false
  }
  scheduleAutoHide()
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

/** 点击进度条跳转到指定时间 */
function onSeekClick(e) {
  const track = e.currentTarget
  const rect = track.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  seekTo(ratio * (videoEl.value.duration || duration.value))
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

/** 切换全屏（整个播放器进入系统全屏） */
async function toggleFullscreen() {
  const el = playerEl.value
  if (!el) return
  if (!document.fullscreenElement) {
    await el.requestFullscreen?.().catch(() => {})
  } else {
    await document.exitFullscreen?.().catch(() => {})
  }
  scheduleAutoHide()
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

/** 核心循环逻辑：当前段到末尾时跳回段首，实现单段循环 */
function onTimeUpdate() {
  const v = videoEl.value
  currentTime.value = v.currentTime
  const seg = currentSegment.value
  if (seg) {
    if (v.currentTime >= seg.end) v.currentTime = seg.start
  } else if (v.duration && v.currentTime >= v.duration - 0.1) {
    v.currentTime = 0
  }
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
  } else {
    // 最后一段练完
    finish()
  }
  scheduleAutoHide()
}

function prev() {
  if (currentIndex.value > 0) {
    currentIndex.value--
    playCurrent()
  }
  scheduleAutoHide()
}

function jumpTo(i) {
  currentIndex.value = i
  playCurrent()
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
  document.addEventListener('fullscreenchange', onFullscreenChange)
  loadCheckinCount()
  scheduleAutoHide()
})

onBeforeUnmount(() => {
  // 关闭前保存本次播放记录
  saveProgress()
  if (url.value) URL.revokeObjectURL(url.value)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (clickTimer) clearTimeout(clickTimer)
  if (hideTimer) clearTimeout(hideTimer)
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
              <div class="seek-track" @click="onSeekClick">
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
