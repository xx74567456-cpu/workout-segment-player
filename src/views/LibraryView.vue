<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import {
  getAllVideos,
  addVideo,
  deleteVideo,
  updateVideo,
  getAllFolders,
  getAllCheckins,
  uid,
} from '../db'
import { store, openPlayer, openEditor, showToast } from '../store'
import { formatTime } from '../utils'

const videos = ref([])
const folders = ref([])
const checkins = ref([])
const importing = ref(false)
const editingId = ref(null)

// 右键 / 长按操作菜单
const menuVideo = ref(null)
const deleteTarget = ref(null)

const filteredVideos = computed(() => {
  if (!store.activeFolderId) return videos.value
  return videos.value.filter((v) => v.folderId === store.activeFolderId)
})

// 每个视频的打卡次数（videoId → 次数），一次性预计算避免模板里反复遍历
const checkinCountMap = computed(() => {
  const map = {}
  for (const c of checkins.value) {
    map[c.videoId] = (map[c.videoId] || 0) + 1
  }
  return map
})

function checkinCount(videoId) {
  return checkinCountMap.value[videoId] || 0
}

async function load() {
  videos.value = await getAllVideos()
  folders.value = await getAllFolders()
  checkins.value = await getAllCheckins()
}

onMounted(load)

// 关闭播放器后刷新打卡次数（刚打完卡可能已新增）
watch(
  () => store.playerVideo,
  (nv, ov) => {
    if (ov && !nv) {
      getAllCheckins().then((list) => {
        checkins.value = list
      })
    }
  }
)

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
  await deleteVideo(v.id)
  await load()
}

async function changeFolder(v, folderId) {
  v.folderId = folderId || null
  await updateVideo(v)
}

// ---------- 右键 / 长按菜单 ----------

let pressTimer = null
let longPressed = false

/** 按下开始计时，500ms 后触发长按菜单 */
function startPress(v) {
  longPressed = false
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    longPressed = true
    openMenu(v)
  }, 500)
}

function cancelPress() {
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = null
}

function openMenu(v) {
  menuVideo.value = v
}

function closeMenu() {
  menuVideo.value = null
}

function onContextMenu(v) {
  openMenu(v)
}

/** 缩略图/标题点击：长按之后不触发播放 */
function onThumbClick(v) {
  if (longPressed) {
    longPressed = false
    return
  }
  openPlayer(v)
}

function onEditClick(v) {
  if (longPressed) {
    longPressed = false
    return
  }
  openEditor(v)
}

function menuRename() {
  const v = menuVideo.value
  closeMenu()
  if (v) startRename(v)
}

async function moveToFolder(folderId) {
  const v = menuVideo.value
  if (!v) return
  await changeFolder(v, folderId)
  showToast('已移动分类')
}

function askDelete() {
  const v = menuVideo.value
  closeMenu()
  deleteTarget.value = v
}

async function doDelete() {
  const v = deleteTarget.value
  deleteTarget.value = null
  if (v) await removeVideo(v)
}

function cancelDelete() {
  deleteTarget.value = null
}

// ---------- 重命名 ----------
function startRename(v) {
  editingId.value = v.id
}

async function saveRename(v) {
  editingId.value = null
  v.name = (v.name || '').trim() || '未命名'
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
      <div
        v-for="v in filteredVideos"
        :key="v.id"
        class="card"
        @pointerdown="startPress(v)"
        @pointerup="cancelPress"
        @pointercancel="cancelPress"
        @pointerleave="cancelPress"
        @contextmenu.prevent="onContextMenu(v)"
      >
        <div class="thumb" @click="onThumbClick(v)">
          <img v-if="v.thumbnail" :src="v.thumbnail" alt="" />
          <div v-else class="thumb-placeholder">🎬</div>
          <span class="duration">{{ formatTime(v.duration) }}</span>
          <span v-if="v.segments?.length" class="badge">{{ v.segments.length }} 段</span>
          <span class="checkin-badge" :class="{ zero: checkinCount(v.id) === 0 }">🏁 {{ checkinCount(v.id) }}</span>
        </div>
        <div class="card-body">
          <input
            v-if="editingId === v.id"
            v-model="v.name"
            class="name-input"
            placeholder="视频名"
            autofocus
            @keyup.enter="saveRename(v)"
            @blur="saveRename(v)"
            @pointerdown.stop
            @click.stop
          />
          <div v-else class="name" @click="onThumbClick(v)">{{ v.name }}</div>
          <div class="actions">
            <button class="edit-btn" @click="onEditClick(v)">✂️ 编辑分段</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      <p class="empty-icon">🏃</p>
      <p>还没有视频</p>
      <p class="dim">点击右上角「导入视频」，选择你下载好的健身视频开始吧</p>
    </div>

    <!-- 右键 / 长按操作菜单 -->
    <teleport to="body">
      <div v-if="menuVideo" class="sheet-overlay" @click.self="closeMenu">
        <div class="sheet">
          <div class="sheet-name">{{ menuVideo.name }}</div>
          <div class="sheet-menu">
            <button class="menu-item" @click="menuRename">
              <span class="menu-icon">✏️</span>
              <span class="menu-text">
                <span class="menu-title">重命名</span>
                <span class="menu-desc">修改视频名称</span>
              </span>
            </button>
            <div class="menu-item folder-item">
              <span class="menu-icon">📁</span>
              <span class="menu-text">
                <span class="menu-title">移动到分类</span>
                <span class="menu-desc">选择目标文件夹</span>
              </span>
            </div>
            <div class="folder-options">
              <button
                class="folder-opt"
                :class="{ active: menuVideo.folderId == null }"
                @click="moveToFolder(null)"
              >
                未分类
              </button>
              <button
                v-for="f in folders"
                :key="f.id"
                class="folder-opt"
                :class="{ active: menuVideo.folderId === f.id }"
                @click="moveToFolder(f.id)"
              >
                {{ f.name }}
              </button>
            </div>
            <button class="menu-item danger" @click="askDelete">
              <span class="menu-icon">🗑</span>
              <span class="menu-text">
                <span class="menu-title">删除视频</span>
                <span class="menu-desc">删除后不可恢复</span>
              </span>
            </button>
          </div>
          <button class="sheet-cancel" @click="closeMenu">取消</button>
        </div>
      </div>

      <!-- 删除二次确认 -->
      <div v-if="deleteTarget" class="sheet-overlay" @click.self="cancelDelete">
        <div class="sheet confirm">
          <div class="sheet-name">删除视频？</div>
          <p class="confirm-text">「{{ deleteTarget.name }}」删除后不可恢复，确定删除吗？</p>
          <button class="confirm-danger" @click="doDelete">确认删除</button>
          <button class="sheet-cancel" @click="cancelDelete">取消</button>
        </div>
      </div>
    </teleport>
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
  /* 长按唤起菜单时避免选中文本 / 弹系统菜单 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
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

/* 打卡次数角标：右上角，金色表示已打卡、灰色表示 0 次 */
.checkin-badge {
  position: absolute;
  right: 6px;
  top: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #fbbf24;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.checkin-badge.zero {
  color: #94a3b8;
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

.name-input {
  width: 100%;
  font-size: 14px;
  font-weight: 500;
  padding: 4px 6px;
  border: 1px solid var(--primary);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  margin-bottom: 6px;
}

.actions {
  display: flex;
}

.edit-btn {
  flex: 1;
  padding: 8px;
  border-radius: 8px;
  background: var(--primary);
  color: #06281c;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
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

/* 右键/长按菜单与删除确认面板（居中） */
.sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.sheet {
  width: 100%;
  max-width: 400px;
  background: var(--bg-elevated);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sheet-name {
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 每个功能项：统一为「图标 + 标题 + 描述」的列表项 */
.sheet-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  text-align: left;
}

.menu-item.danger {
  border-color: var(--danger);
}

.menu-icon {
  flex-shrink: 0;
  width: 30px;
  font-size: 20px;
  text-align: center;
}

.menu-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}

.menu-item.danger .menu-title {
  color: var(--danger);
}

.menu-desc {
  font-size: 12px;
  color: var(--text-dim);
}

.folder-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 6px 4px;
}

.folder-opt {
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text);
}

.folder-opt.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #06281c;
  font-weight: 600;
}

.sheet-cancel {
  padding: 12px;
  border-radius: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 15px;
  color: var(--text-dim);
}

.confirm-text {
  text-align: center;
  font-size: 14px;
  color: var(--text-dim);
  padding: 0 4px 4px;
}

.confirm-danger {
  padding: 12px;
  border-radius: 10px;
  background: var(--danger);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
</style>
