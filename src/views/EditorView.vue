<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { updateVideo, uid } from '../db'
import { store, closeEditor, showToast } from '../store'
import { formatTime } from '../utils'
import AppIcon from '../components/AppIcon.vue'
import { buildTemplate } from '../segmentTemplate'

const video = computed(() => store.editorVideo)

const videoEl = ref(null)
const barEl = ref(null)
const url = ref('')
const duration = ref(0)
const currentTime = ref(0)
const segments = ref([])
const saving = ref(false)
const selectedIndex = ref(-1)
const dragging = ref(false)
const playing = ref(false)
const editingIndex = ref(-1)
const rate = ref(1)
const RATES = [0.75, 1, 1.5, 2, 3, 4, 5]
const rateMenuOpen = ref(false)
const speedPressing = ref(false)

const hasSegments = computed(() => segments.value.length > 0)
const selectedSegment = computed(() => segments.value[selectedIndex.value] || null)

/** 播放头在进度条上的位置（0~100） */
const playPercent = computed(() =>
  duration.value ? (currentTime.value / duration.value) * 100 : 0
)

function initSegments() {
  const existing = video.value?.segments || []
  segments.value = existing.length
    ? existing.map((s) => ({ ...s }))
    : [{ id: uid(), name: '动作 1', start: 0, end: duration.value }]
  selectedIndex.value = -1
}

onMounted(() => {
  if (video.value?.blob) {
    url.value = URL.createObjectURL(video.value.blob)
    videoEl.value.addEventListener(
      'loadedmetadata',
      () => {
        duration.value = videoEl.value.duration
        initSegments()
      },
      { once: true }
    )
  }
})

onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})

function onTimeUpdate() {
  currentTime.value = videoEl.value.currentTime
}

function togglePlay() {
  const v = videoEl.value
  if (v.paused) v.play().catch(() => {})
  else v.pause()
}

/** 前进/后退指定秒数 */
function seekBy(seconds) {
  const v = videoEl.value
  if (!v || !duration.value) return
  v.currentTime = Math.max(0, Math.min(duration.value, v.currentTime + seconds))
  currentTime.value = v.currentTime
}

/** 设置播放倍速 */
function setRate(r) {
  rate.value = r
  videoEl.value.playbackRate = r
  rateMenuOpen.value = false
}

function toggleRateMenu() {
  rateMenuOpen.value = !rateMenuOpen.value
}

/** 长按期间以 3 倍速播放 */
function onSpeedPress(e) {
  e.target.setPointerCapture(e.pointerId)
  speedPressing.value = true
  videoEl.value.playbackRate = 3
}

function onSpeedRelease() {
  speedPressing.value = false
  videoEl.value.playbackRate = rate.value
}

// ---------- 可拖动进度条 ----------

function onPointerDown(e) {
  dragging.value = true
  barEl.value.setPointerCapture(e.pointerId)
  seekToClientX(e.clientX)
  videoEl.value.pause()
}

function onPointerMove(e) {
  if (!dragging.value) return
  seekToClientX(e.clientX)
}

function onPointerUp() {
  dragging.value = false
}

function seekToClientX(clientX) {
  const rect = barEl.value.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  videoEl.value.currentTime = ratio * duration.value
  currentTime.value = videoEl.value.currentTime
}

// ---------- 分段操作 ----------

/** 选中一个动作段（只选中，不移动播放位置） */
function selectSegment(i) {
  selectedIndex.value = i
}

/** 开始重命名某个动作段 */
async function startEdit(i) {
  editingIndex.value = i
  await nextTick()
  document.querySelector('.seg-name')?.focus()
}

/** 结束重命名 */
function stopEdit() {
  editingIndex.value = -1
}

/** 气泡在时间轴上的位置（分段中点，0~100） */
function bubbleLeft(s) {
  return duration.value ? (((s.start + s.end) / 2 / duration.value) * 100) : 0
}

/** 分段左边界在进度条上的位置（0~100） */
function segLeft(s) {
  return duration.value ? (s.start / duration.value) * 100 : 0
}

/** 分段在进度条上的宽度百分比 */
function segWidth(s) {
  return duration.value ? ((s.end - s.start) / duration.value) * 100 : 0
}

/**
 * 每个气泡的错位行号：用贪心算法，当前气泡与前面某行最后一个气泡不重叠时复用该行，
 * 否则新开一行。气泡过密时上下错开，尽量都显示。
 */
const bubbleLanes = computed(() => {
  const d = duration.value
  const segs = segments.value
  if (!d || !segs.length) return []
  const bubbleWidth = 8 // 气泡占进度条宽度的百分比（近似）
  const laneRights = []
  const lanes = []
  for (const s of segs) {
    const center = ((s.start + s.end) / 2 / d) * 100
    const left = center - bubbleWidth / 2
    const right = center + bubbleWidth / 2
    let lane = -1
    for (let i = 0; i < laneRights.length; i++) {
      if (laneRights[i] <= left) {
        lane = i
        break
      }
    }
    if (lane === -1) {
      lane = laneRights.length
      laneRights.push(right)
    } else {
      laneRights[lane] = right
    }
    lanes.push(lane)
  }
  return lanes
})

/** 气泡层高度：随最大行数动态变化 */
const bubbleLayerHeight = computed(() => {
  const lanes = bubbleLanes.value
  const max = lanes.length ? Math.max(...lanes) : 0
  return (max + 1) * 18 + 'px'
})

/** 按时间顺序给「未命名」的动作段重编号为「动作 N」（数组已按时间先后排序） */
function renumberSegments() {
  segments.value = segments.value.map((s, i) =>
    !s.name || /^动作\s*\d+$/.test(s.name.trim()) ? { ...s, name: `动作 ${i + 1}` } : s
  )
}

/** 在当前播放位置切分 */
function splitAtCurrent() {
  const t = videoEl.value.currentTime
  const idx = segments.value.findIndex((s) => t > s.start && t < s.end)
  if (idx === -1) {
    alert('当前时间不在任何动作段内')
    return
  }
  const seg = segments.value[idx]
  const left = { ...seg, end: t }
  const right = { id: uid(), name: `动作 ${segments.value.length + 1}`, start: t, end: seg.end }
  segments.value.splice(idx, 1, left, right)
  renumberSegments()
  selectedIndex.value = idx
}

/** 删除指定段（合并到相邻段） */
function removeSegment(i) {
  if (segments.value.length <= 1) {
    alert('至少保留一个动作段')
    return
  }
  const segs = segments.value
  if (i === 0) {
    segs[1].start = 0
    segs.splice(0, 1)
  } else {
    segs[i - 1].end = segs[i].end
    segs.splice(i, 1)
  }
  renumberSegments()
  selectedIndex.value = -1
}

/** 删除当前选中的段 */
function removeSelected() {
  if (selectedIndex.value < 0) return
  removeSegment(selectedIndex.value)
}

/** 一键清除所有分段，恢复为整段（需用户确认，绝不自动清空） */
function clearSegments() {
  if (!segments.value.length) return
  if (!confirm('确定清除所有分段？将恢复为整段视频，可重新切分。')) return
  segments.value = [{ id: uid(), name: '动作 1', start: 0, end: duration.value }]
  selectedIndex.value = -1
}

async function save() {
  if (saving.value) return
  const valid = segments.value.filter((s) => s.end - s.start > 0.5)
  if (!valid.length) {
    alert('请先切分出一个有效动作段')
    return
  }
  // 按时间先后排序，并重编号「未命名」的动作名（用户自定义名保留）
  const sorted = [...valid].sort((a, b) => a.start - b.start)
  const normalized = sorted.map((s, i) =>
    !s.name || /^动作\s*\d+$/.test(s.name.trim()) ? { ...s, name: `动作 ${i + 1}` } : s
  )
  saving.value = true
  try {
    video.value.segments = normalized
    await updateVideo(video.value)
    showToast('保存成功')
    // 短暂停留让用户看到提示，再关闭编辑器
    setTimeout(() => closeEditor(), 500)
  } catch (err) {
    console.error('保存失败', err)
    saving.value = false
    alert('保存失败：' + (err.message || err))
  }
}

/** 导出当前编辑中的分段为模板文件（无需先保存） */
function exportTemplate() {
  const segs = segments.value.filter((s) => s.end - s.start > 0.5)
  if (!segs.length) {
    showToast('请先切分出分段')
    return
  }
  const data = buildTemplate({
    name: video.value?.name || '',
    duration: duration.value,
    segments: segs,
  })
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `分段模板-${data.sourceName}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  showToast('已导出分段模板')
}
</script>

<template>
  <div class="editor">
    <header class="topbar">
      <button class="icon-btn" @click="closeEditor"><AppIcon name="close" :size="20" /></button>
      <h1>编辑分段</h1>
      <button class="icon-btn" title="导出分段模板" @click="exportTemplate"><AppIcon name="download" :size="20" /></button>
      <button class="save-btn" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </header>

    <!-- 预览 -->
    <div class="preview">
      <div class="video-wrap">
        <video
          ref="videoEl"
          class="video"
          :src="url"
          playsinline
          webkit-playsinline
          @timeupdate="onTimeUpdate"
          @play="playing = true"
          @pause="playing = false"
          @click="togglePlay"
        ></video>
        <button class="play-overlay" :class="{ 'is-playing': playing }" @click="togglePlay">
          <span v-if="playing" class="icon-pause"></span>
          <span v-else class="icon-play"></span>
        </button>
      </div>

      <!-- 播放控制：后退/前进、倍速、长按加速 -->
      <div class="play-controls">
        <button class="ctrl-btn seek-btn" @click="seekBy(-10)">
          <svg class="seek-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
          </svg>
          <span>10s</span>
        </button>
        <div class="rate-wrap">
          <button class="ctrl-btn" @click="toggleRateMenu">倍速 {{ rate }}x</button>
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
        <button
          class="ctrl-btn speed-btn"
          :class="{ pressing: speedPressing }"
          @pointerdown="onSpeedPress"
          @pointerup="onSpeedRelease"
          @pointercancel="onSpeedRelease"
        >
          长按 3x
        </button>
        <button class="ctrl-btn seek-btn" @click="seekBy(10)">
          <span>10s</span>
          <svg class="seek-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
          </svg>
        </button>
      </div>

      <!-- 时间轴：可拖动进度条 + 气泡分段序号 -->
      <div class="timeline">
        <div
          ref="barEl"
          class="seekbar"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div class="seekbar-track"></div>
          <div class="seekbar-fill" :style="{ width: playPercent + '%' }"></div>
          <!-- 分段边界线（仅提示，不阻挡拖动） -->
          <div
            v-for="(s, i) in segments"
            :key="'cut-' + s.id"
            v-show="i > 0"
            class="cut-line"
            :style="{ left: (s.start / duration) * 100 + '%' }"
          ></div>
          <!-- 选中的分段高亮（亮黄色） -->
          <div
            v-if="selectedSegment"
            class="seg-highlight"
            :style="{ left: segLeft(selectedSegment) + '%', width: segWidth(selectedSegment) + '%' }"
          ></div>
          <div class="seekbar-thumb" :style="{ left: playPercent + '%' }"></div>
        </div>

        <!-- 气泡层：每个分段一个气泡，点击选中；过密时上下错位 -->
        <div class="bubble-layer" :style="{ height: bubbleLayerHeight }">
          <button
            v-for="(s, i) in segments"
            :key="s.id"
            class="bubble"
            :class="{ active: selectedIndex === i }"
            :style="{ left: bubbleLeft(s) + '%', top: bubbleLanes[i] * 18 + 'px', '--line-h': bubbleLanes[i] * 18 + 'px' }"
            :title="`${i + 1}. ${s.name}（${formatTime(s.start)} - ${formatTime(s.end)}）`"
            @click="selectSegment(i)"
          >
            {{ i + 1 }}
          </button>
        </div>

        <div class="time-label">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</div>
      </div>

      <!-- 操作区 -->
      <div class="toolbar">
        <button class="split-btn" @click="splitAtCurrent">
          <AppIcon name="scissors" :size="14" /> 在此切分（{{ formatTime(currentTime) }}）
        </button>
        <button v-if="selectedSegment" class="del-seg-btn" @click="removeSelected">
          <AppIcon name="trash" :size="14" /> 删除选中段
        </button>
      </div>
    </div>

    <!-- 段列表 -->
    <div class="seg-header">
      <span class="seg-title">动作分段（{{ segments.length }}）</span>
      <button class="clear-btn" @click="clearSegments"><AppIcon name="trash" :size="12" /> 清除分段</button>
    </div>
    <div class="seg-list">
      <div
        v-for="(s, i) in segments"
        :key="s.id"
        class="seg-item"
        :class="{ active: selectedIndex === i }"
        @click="selectSegment(i)"
      >
        <span class="seg-index">{{ i + 1 }}</span>
        <div class="seg-info">
          <input
            v-if="editingIndex === i"
            v-model="s.name"
            class="seg-name"
            placeholder="动作名"
            @keyup.enter="stopEdit"
            @blur="stopEdit"
            @click.stop
          />
          <div v-else class="seg-name-text">{{ s.name }}</div>
          <div class="seg-time">{{ formatTime(s.start) }} - {{ formatTime(s.end) }}</div>
        </div>
        <button v-if="selectedIndex === i" class="rename-btn" @click.stop="startEdit(i)">
          <AppIcon name="edit" :size="13" /> 重命名
        </button>
        <button class="del-btn" @click.stop="removeSegment(i)"><AppIcon name="trash" :size="16" /></button>
      </div>
      <p v-if="!hasSegments" class="empty">暂无动作段</p>
    </div>
  </div>
</template>

<style scoped>
.editor {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  color: var(--text);
}

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  padding-top: calc(12px + env(safe-area-inset-top));
  background: var(--bg-elevated);
}

.topbar h1 {
  flex: 1;
  font-size: 18px;
  text-align: center;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  color: var(--text);
}

.save-btn {
  background: var(--primary);
  color: #06281c;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 14px;
}

.save-btn:disabled {
  opacity: 0.6;
}

.preview {
  padding: 12px 16px;
}

.video-wrap {
  position: relative;
}

.video {
  width: 100%;
  max-height: 36vh;
  object-fit: contain;
  background: #000;
  border-radius: var(--radius);
  display: block;
}

.play-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
}

.play-overlay.is-playing {
  opacity: 0.5;
}

/* 播放控制行 */
.play-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.ctrl-btn {
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 211, 153, 0.1);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.seek-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.seek-icon {
  width: 14px;
  height: 14px;
  display: block;
  color: var(--primary-dark);
}

.rate-wrap {
  position: relative;
}

.rate-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 10;
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

.speed-btn.pressing {
  background: var(--primary);
  color: #06281c;
  border-color: var(--primary);
}

/* 播放：白色三角形 */
.icon-play {
  width: 0;
  height: 0;
  border-left: 17px solid #fff;
  border-top: 10px solid transparent;
  border-bottom: 10px solid transparent;
  margin-left: 4px;
}

/* 暂停：白色双竖线 */
.icon-pause {
  width: 15px;
  height: 20px;
  border-left: 5px solid #fff;
  border-right: 5px solid #fff;
}

.timeline {
  margin-top: 16px;
}

/* 可拖动进度条 */
.seekbar {
  position: relative;
  height: 20px;
  cursor: pointer;
  touch-action: none;
}

.seekbar-track {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 6px;
  transform: translateY(-50%);
  background: var(--bg-elevated);
  border-radius: 3px;
}

.seekbar-fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: 6px;
  transform: translateY(-50%);
  background: var(--primary);
  border-radius: 3px;
}

.cut-line {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 14px;
  background: rgba(245, 158, 11, 0.75);
  pointer-events: none;
  border-radius: 1px;
}

.seg-highlight {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(250, 204, 21, 0.4);
  border-radius: 3px;
  pointer-events: none;
}

.seekbar-thumb {
  position: absolute;
  top: 50%;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  background: var(--primary);
  border: 2px solid #fff;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

/* 气泡层 */
.bubble-layer {
  position: relative;
  margin-top: 8px;
}

.bubble {
  position: absolute;
  transform: translateX(-50%);
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s;
}

.bubble.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #06281c;
}

/* 引线：从气泡顶部连到进度条 */
.bubble::before {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  width: 1px;
  height: var(--line-h, 0px);
  background: var(--text-dim);
  opacity: 0.45;
  pointer-events: none;
}

.bubble.active::before {
  background: var(--primary);
  opacity: 0.8;
}

.time-label {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}

.toolbar {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.split-btn {
  flex: 1;
  padding: 12px;
  background: var(--primary);
  border: none;
  color: #06281c;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.del-seg-btn {
  padding: 12px 14px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.seg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  margin-bottom: 8px;
}

.seg-title {
  font-size: 13px;
  color: var(--text-dim);
}

.clear-btn {
  font-size: 12px;
  color: var(--danger);
  padding: 5px 10px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  opacity: 0.85;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.seg-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.seg-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-elevated);
  padding: 10px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 1px solid transparent;
}

.seg-item.active {
  border-color: var(--primary);
}

.seg-index {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg);
  color: var(--text-dim);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}

.seg-item.active .seg-index {
  background: var(--primary);
  color: #06281c;
}

.seg-info {
  flex: 1;
  min-width: 0;
}

.seg-name {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  outline: none;
  border-bottom: 1px solid transparent;
}

.seg-name:focus {
  border-bottom-color: var(--primary);
}

.seg-name-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.rename-btn {
  flex-shrink: 0;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 6px;
  background: rgba(52, 211, 153, 0.1);
  border: 1px solid var(--primary);
  color: var(--primary-dark);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.seg-time {
  font-size: 12px;
  color: var(--text-dim);
}

.del-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  color: var(--danger);
}

.empty {
  text-align: center;
  padding: 30px;
  color: var(--text-dim);
}
</style>
