<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { addCheckin } from '../db'
import { store, closePlayer } from '../store'
import { formatTime, todayStr } from '../utils'

const video = computed(() => store.playerVideo)
const segments = computed(() => video.value?.segments || [])

const videoEl = ref(null)
const url = ref('')
const currentIndex = ref(0)
const currentTime = ref(0)
const playing = ref(false)

const currentSegment = computed(() =>
  segments.value.length ? segments.value[currentIndex.value] : null
)

const hasSegments = computed(() => segments.value.length > 0)

/** 当前段（或整段）的播放进度 0~1 */
const progress = computed(() => {
  const v = videoEl.value
  const seg = currentSegment.value
  if (seg) {
    const dur = seg.end - seg.start
    return dur > 0 ? (currentTime.value - seg.start) / dur : 0
  }
  return v && v.duration ? currentTime.value / v.duration : 0
})

function playCurrent() {
  const v = videoEl.value
  if (!v) return
  const seg = currentSegment.value
  v.currentTime = seg ? seg.start : 0
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
    return
  }
  if (currentIndex.value < segments.value.length - 1) {
    currentIndex.value++
    playCurrent()
  } else {
    // 最后一段练完
    finish()
  }
}

function prev() {
  if (currentIndex.value > 0) {
    currentIndex.value--
    playCurrent()
  }
}

function jumpTo(i) {
  currentIndex.value = i
  playCurrent()
}

async function finish() {
  const name = video.value?.name || '视频'
  if (confirm(`「${name}」本次训练完成，打卡一次？`)) {
    await addCheckin({ videoId: video.value.id, date: todayStr(), timestamp: Date.now() })
    alert('已打卡！干得漂亮 💪')
  }
}

onMounted(() => {
  if (video.value?.blob) {
    url.value = URL.createObjectURL(video.value.blob)
    // 等 video 可播放后再定位到第一段
    videoEl.value.addEventListener('loadedmetadata', () => playCurrent(), { once: true })
  }
})

onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>

<template>
  <div class="player" @click.self="togglePlay">
    <!-- 顶部栏 -->
    <header class="topbar">
      <button class="icon-btn" @click="closePlayer">✕</button>
      <div class="title">
        <div class="video-name">{{ video?.name }}</div>
        <div class="seg-name">
          {{ hasSegments ? `动作 ${currentIndex + 1}/${segments.length} · ${currentSegment.name}` : '整段循环' }}
        </div>
      </div>
      <button class="icon-btn" @click="finish">💪</button>
    </header>

    <!-- 视频 -->
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
      ></video>

      <!-- 段内进度条 -->
      <div class="progressbar">
        <div class="progress-fill" :style="{ width: progress * 100 + '%' }"></div>
      </div>

      <!-- 动作段列表（有分段时显示，可快速跳转） -->
      <div v-if="hasSegments" class="seg-list">
        <button
          v-for="(s, i) in segments"
          :key="s.id"
          class="seg-chip"
          :class="{ active: i === currentIndex }"
          @click="jumpTo(i)"
        >
          {{ i + 1 }}. {{ s.name }}
        </button>
      </div>
    </div>

    <!-- 底部控制 -->
    <footer class="controls">
      <button class="round-btn" @click="prev" :disabled="!hasSegments || currentIndex === 0">⏮</button>
      <button class="round-btn big" @click="togglePlay">
        {{ playing ? '⏸' : '▶️' }}
      </button>
      <button class="round-btn next" @click="next">
        {{ hasSegments && currentIndex === segments.length - 1 ? '🏁' : '⏭' }}
      </button>
    </footer>
    <p class="hint">
      {{
        hasSegments
          ? currentIndex === segments.length - 1
            ? '最后一个动作，练完点 🏁 打卡'
            : '练完点 ⏭ 切下一个动作'
          : '点击画面或 ▶️ 播放/暂停'
      }}
    </p>
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
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  padding-top: calc(12px + env(safe-area-inset-top));
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
}

.icon-btn {
  font-size: 20px;
  padding: 6px 10px;
  color: var(--text);
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
  justify-content: center;
  position: relative;
  min-height: 0;
}

.video {
  width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #000;
}

.progressbar {
  height: 4px;
  background: var(--border);
  margin: 8px 16px;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.15s linear;
}

.seg-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 16px 8px;
}

.seg-chip {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 13px;
  white-space: nowrap;
}

.seg-chip.active {
  background: var(--primary);
  color: #06281c;
  font-weight: 700;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 12px 0;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
}

.round-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.round-btn.big {
  width: 72px;
  height: 72px;
  font-size: 28px;
  background: var(--primary);
  color: #06281c;
}

.round-btn.next {
  background: #d1fae5;
  border-color: var(--primary);
  color: var(--primary-dark);
}

.round-btn:disabled {
  opacity: 0.35;
}

.hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  padding-bottom: 10px;
}
</style>
