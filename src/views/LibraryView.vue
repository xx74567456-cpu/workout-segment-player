<script setup>
import { ref, onMounted, computed } from 'vue'
import {
  getAllVideos,
  addVideo,
  deleteVideo,
  updateVideo,
  getAllFolders,
  uid,
} from '../db'
import { store, openPlayer, openEditor } from '../store'
import { formatTime } from '../utils'

const videos = ref([])
const folders = ref([])
const importing = ref(false)

const filteredVideos = computed(() => {
  if (!store.activeFolderId) return videos.value
  return videos.value.filter((v) => v.folderId === store.activeFolderId)
})

async function load() {
  videos.value = await getAllVideos()
  folders.value = await getAllFolders()
}

onMounted(load)

// ---------- 导入 ----------
const fileInput = ref(null)

function pickFile() {
  fileInput.value.click()
}

async function onFileChange(e) {
  const file = e.target.files[0]
  e.target.value = '' // 允许再次选择同一文件
  if (!file) return
  importing.value = true
  try {
    const { duration, thumbnail } = await readVideoMeta(file)
    const video = {
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ''),
      blob: file,
      duration,
      thumbnail,
      folderId: store.activeFolderId,
      segments: [],
      createdAt: Date.now(),
    }
    await addVideo(video)
    await load()
  } catch (err) {
    alert('视频导入失败：' + err.message)
  } finally {
    importing.value = false
  }
}

/** 读取视频时长并截取首帧缩略图 */
function readVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url

    video.onloadedmetadata = () => {
      // 跳到 10% 处截取一张非黑屏的缩略图
      video.currentTime = Math.min(1, video.duration * 0.1)
    }

    video.onseeked = () => {
      let thumbnail = null
      try {
        const canvas = document.createElement('canvas')
        const scale = 320 / video.videoWidth
        canvas.width = 320
        canvas.height = Math.round(video.videoHeight * scale)
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        thumbnail = canvas.toDataURL('image/jpeg', 0.7)
      } catch {
        // 截帧失败不阻断导入，缩略图留空
      }
      URL.revokeObjectURL(url)
      resolve({ duration: video.duration, thumbnail })
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取该视频文件'))
    }
  })
}

// ---------- 操作 ----------
async function removeVideo(v) {
  if (!confirm(`确定删除「${v.name}」？删除后不可恢复。`)) return
  await deleteVideo(v.id)
  await load()
}

async function changeFolder(v, folderId) {
  v.folderId = folderId || null
  await updateVideo(v)
}
</script>

<template>
  <div class="library">
    <header class="header">
      <h1>我的视频</h1>
      <button class="import-btn" :disabled="importing" @click="pickFile">
        {{ importing ? '导入中…' : '＋ 导入视频' }}
      </button>
      <input ref="fileInput" type="file" accept="video/*" hidden @change="onFileChange" />
    </header>

    <!-- 文件夹筛选 -->
    <div class="filters">
      <button
        class="chip"
        :class="{ active: !store.activeFolderId }"
        @click="store.activeFolderId = null"
      >
        全部
      </button>
      <button
        v-for="f in folders"
        :key="f.id"
        class="chip"
        :class="{ active: store.activeFolderId === f.id }"
        @click="store.activeFolderId = f.id"
      >
        {{ f.name }}
      </button>
    </div>

    <!-- 视频列表 -->
    <div v-if="filteredVideos.length" class="grid">
      <div v-for="v in filteredVideos" :key="v.id" class="card">
        <div class="thumb" @click="openPlayer(v)">
          <img v-if="v.thumbnail" :src="v.thumbnail" alt="" />
          <div v-else class="thumb-placeholder">🎬</div>
          <span class="duration">{{ formatTime(v.duration) }}</span>
          <span v-if="v.segments?.length" class="badge">{{ v.segments.length }} 段</span>
        </div>
        <div class="card-body">
          <div class="name" @click="openPlayer(v)">{{ v.name }}</div>
          <div class="actions">
            <button class="action-btn" @click="openEditor(v)">✂️ 编辑</button>
            <select
              class="folder-select"
              :value="v.folderId || ''"
              @change="changeFolder(v, $event.target.value)"
            >
              <option value="">未分类</option>
              <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
            <button class="action-btn danger" @click="removeVideo(v)">🗑</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      <p class="empty-icon">🏃</p>
      <p>还没有视频</p>
      <p class="dim">点击右上角「导入视频」，选择你下载好的健身视频开始吧</p>
    </div>
  </div>
</template>

<style scoped>
.library {
  padding: 16px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.header h1 {
  font-size: 20px;
}

.import-btn {
  background: var(--primary);
  color: #06281c;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 14px;
}

.import-btn:disabled {
  opacity: 0.6;
}

.filters {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 14px;
}

.chip {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-dim);
}

.chip.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #06281c;
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
}

.card {
  background: var(--bg-elevated);
  border-radius: var(--radius);
  overflow: hidden;
}

.thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #e9f1ec;
  cursor: pointer;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
}

.duration {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.7);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.badge {
  position: absolute;
  left: 6px;
  top: 6px;
  background: var(--primary);
  color: #06281c;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.card-body {
  padding: 8px 10px;
}

.name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  margin-bottom: 6px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.action-btn {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
}

.action-btn.danger {
  color: var(--danger);
}

.folder-select {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 4px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-dim);
}

.empty-icon {
  font-size: 44px;
  margin-bottom: 10px;
}

.empty .dim {
  font-size: 13px;
  margin-top: 6px;
  opacity: 0.7;
}
</style>
