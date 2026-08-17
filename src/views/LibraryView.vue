<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import {
  getAllVideos,
  addVideo,
  deleteVideo,
  updateVideo,
  getAllFolders,
  getAllCheckins,
  addFolder,
  addCheckin,
  uid,
} from '../db'
import { store, openPlayer, openEditor, showToast, showConfirm, showAlert, showPrompt } from '../store'
import { formatTime, todayStr } from '../utils'
import AppIcon from '../components/AppIcon.vue'
import { buildTemplate, parseTemplate, applyTemplate } from '../segmentTemplate'

const videos = ref([])
const folders = ref([])
const checkins = ref([])
const importing = ref(false)
const editingId = ref(null)

// 右键 / 长按操作菜单
const menuVideo = ref(null)
const deleteTarget = ref(null)

// ---------- 搜索 / 排序 ----------
const search = ref('')
const sortKey = ref('created') // created | name | duration | checkin
const sortDesc = ref(true)
const sortMenuOpen = ref(false)
const SORT_OPTIONS = [
  { key: 'created', label: '最近导入' },
  { key: 'name', label: '名称' },
  { key: 'duration', label: '时长' },
  { key: 'checkin', label: '打卡次数' },
]
const sortLabel = computed(() => {
  const o = SORT_OPTIONS.find((x) => x.key === sortKey.value)
  return (o ? o.label : '') + (sortDesc.value ? ' ↓' : ' ↑')
})

function pickSort(key) {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value
  else sortDesc.value = true
  sortKey.value = key
  sortMenuOpen.value = false
}

/** 关闭排序 / 备份下拉菜单（点击遮罩空白处时） */
function closeMenus() {
  sortMenuOpen.value = false
  backupMenuOpen.value = false
}

// ---------- 批量管理 ----------
const batchMode = ref(false)
const selected = ref(new Set())
const batchMoveOpen = ref(false)

function toggleBatch() {
  batchMode.value = !batchMode.value
  selected.value = new Set()
}

function toggleSelect(id) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}

const allSelected = computed(() => {
  const ids = filteredVideos.value.map((v) => v.id)
  return ids.length > 0 && ids.every((id) => selected.value.has(id))
})

function toggleSelectAll() {
  if (allSelected.value) selected.value = new Set()
  else selected.value = new Set(filteredVideos.value.map((v) => v.id))
}

async function deleteSelected() {
  const ids = [...selected.value]
  if (!ids.length) return
  const ok = await showConfirm({
    title: '删除视频',
    message: `删除选中的 ${ids.length} 个视频？此操作不可恢复。`,
    danger: true,
  })
  if (!ok) return
  for (const id of ids) await deleteVideo(id)
  selected.value = new Set()
  batchMode.value = false
  await load()
  showToast('已删除')
}

async function moveSelected(folderId) {
  const ids = new Set(selected.value)
  if (!ids.size) return
  for (const v of videos.value) {
    if (ids.has(v.id)) {
      v.folderId = folderId || null
      await updateVideo(v)
    }
  }
  selected.value = new Set()
  batchMoveOpen.value = false
  batchMode.value = false
  await load()
  showToast('已移动分类')
}

const filteredVideos = computed(() => {
  let list = videos.value
  if (store.activeFolderId) list = list.filter((v) => v.folderId === store.activeFolderId)
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter((v) => (v.name || '').toLowerCase().includes(q))
  const arr = [...list]
  arr.sort((a, b) => {
    let r = 0
    switch (sortKey.value) {
      case 'name':
        r = (a.name || '').localeCompare(b.name || '', 'zh')
        break
      case 'duration':
        r = (a.duration || 0) - (b.duration || 0)
        break
      case 'checkin':
        r = checkinCount(a.id) - checkinCount(b.id)
        break
      default:
        r = (a.createdAt || 0) - (b.createdAt || 0)
    }
    return sortDesc.value ? -r : r
  })
  return arr
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

// ---------- 备份导出 / 导入 ----------
const backupMenuOpen = ref(false)
const backupInput = ref(null)

// ---------- 分段模板导出 / 导入 ----------
const templateTarget = ref(null)
const templateInput = ref(null)

function toggleBackupMenu() {
  backupMenuOpen.value = !backupMenuOpen.value
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function dataURLToBlob(dataURL) {
  const idx = dataURL.indexOf(',')
  const meta = dataURL.slice(0, idx)
  const b64 = dataURL.slice(idx + 1)
  const mime = (meta.match(/:(.*?);/) || [])[1] || ''
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** 导出全部数据（视频含 Blob，转 base64）为 JSON 文件下载 */
async function exportBackup() {
  backupMenuOpen.value = false
  try {
    const [vids, folds, checks] = await Promise.all([
      getAllVideos(),
      getAllFolders(),
      getAllCheckins(),
    ])
    const vidsOut = []
    for (const v of vids) {
      vidsOut.push({
        id: v.id,
        name: v.name,
        duration: v.duration,
        thumbnail: v.thumbnail,
        folderId: v.folderId,
        note: v.note || '',
        weeklyGoal: v.weeklyGoal || 0,
        segments: v.segments || [],
        createdAt: v.createdAt,
        blobDataUrl: v.blob ? await blobToDataURL(v.blob) : null,
      })
    }
    const payload = {
      app: 'fit-segment',
      version: 1,
      exportedAt: Date.now(),
      folders: folds,
      videos: vidsOut,
      checkins: checks,
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fit-segment-备份-${todayStr()}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showToast('已导出备份文件')
  } catch (err) {
    showAlert({ title: '导出失败', message: err.message })
  }
}

function pickBackup() {
  backupMenuOpen.value = false
  backupInput.value.click()
}

/** 从备份 JSON 恢复（按 id 覆盖写入，不会删除现有数据） */
async function onBackupChange(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (!data || data.app !== 'fit-segment' || !Array.isArray(data.videos)) {
      throw new Error('不是有效的备份文件')
    }
    const ok = await showConfirm({
      title: '导入备份',
      message: '导入备份会与现有数据合并（同名 id 覆盖），确定继续？',
    })
    if (!ok) return
    for (const f of data.folders || []) await addFolder(f)
    for (const v of data.videos || []) {
      await addVideo({
        id: v.id,
        name: v.name,
        blob: v.blobDataUrl ? dataURLToBlob(v.blobDataUrl) : null,
        duration: v.duration,
        thumbnail: v.thumbnail,
        folderId: v.folderId,
        note: v.note || '',
        weeklyGoal: v.weeklyGoal || 0,
        segments: v.segments || [],
        createdAt: v.createdAt,
      })
    }
    for (const c of data.checkins || []) await addCheckin(c)
    await load()
    showToast('导入完成')
  } catch (err) {
    showAlert({ title: '导入失败', message: err.message })
  }
}

async function load() {
  videos.value = await getAllVideos()
  folders.value = await getAllFolders()
  checkins.value = await getAllCheckins()
}

onMounted(load)

// 批量模式下点击空白处（非卡片、非底栏）退出批量
function onDocumentClick(e) {
  if (!batchMode.value) return
  const el = e.target
  if (el.closest && (el.closest('.card') || el.closest('.batch-bar') || el.closest('.batch-move') || el.closest('.toolbar'))) return
  batchMode.value = false
  selected.value = new Set()
  batchMoveOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})

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
      note: '',
      weeklyGoal: 0,
      segments: [],
      createdAt: Date.now(),
    }
    await addVideo(video)
    await load()
  } catch (err) {
    showAlert({ title: '视频导入失败', message: err.message })
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

/** 按下开始计时，500ms 后触发长按菜单（批量模式下不唤出菜单） */
function startPress(v) {
  if (batchMode.value) return
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

/** 缩略图/标题点击：长按之后不触发播放；批量模式下切换选中 */
function onThumbClick(v) {
  if (longPressed) {
    longPressed = false
    return
  }
  if (batchMode.value) {
    toggleSelect(v.id)
    return
  }
  openPlayer(v)
}

function onEditClick(v) {
  if (longPressed) {
    longPressed = false
    return
  }
  if (batchMode.value) {
    toggleSelect(v.id)
    return
  }
  openEditor(v)
}

function menuRename() {
  const v = menuVideo.value
  closeMenu()
  if (v) startRename(v)
}

/** 给视频添加备注（目标 / 要点等），存到视频对象的 note 字段 */
async function menuNote() {
  const v = menuVideo.value
  closeMenu()
  if (!v) return
  const note = await showPrompt({
    title: '添加备注',
    message: '给这个视频添加备注（目标、要点等）',
    inputValue: v.note || '',
  })
  if (note === null) return
  v.note = note.trim()
  await updateVideo(v)
  showToast('备注已保存')
}

/** 设置该视频的每周目标次数（0 表示不设目标） */
async function menuWeeklyGoal() {
  const v = menuVideo.value
  closeMenu()
  if (!v) return
  const raw = await showPrompt({
    title: '每周目标',
    message: '设置该视频每周练几次（0 表示不设目标）',
    inputValue: String(v.weeklyGoal || 0),
  })
  if (raw === null) return
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return
  v.weeklyGoal = n
  await updateVideo(v)
  showToast(n > 0 ? `已设置每周 ${n} 次目标` : '已取消周目标')
}

/** 导出当前视频的分段为模板文件，供他人导入套用 */
function menuExportTemplate() {
  const v = menuVideo.value
  closeMenu()
  if (!v) return
  if (!v.segments || !v.segments.length) {
    showToast('该视频还没有分段，先去编辑分段')
    return
  }
  const data = buildTemplate(v)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `分段模板-${v.name}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  showToast('已导出分段模板')
}

/** 导入分段模板并应用到当前选中的视频 */
function menuImportTemplate() {
  const v = menuVideo.value
  closeMenu()
  if (!v) return
  templateTarget.value = v
  templateInput.value.click()
}

async function onTemplateChange(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  const v = templateTarget.value
  templateTarget.value = null
  if (!v) return
  try {
    const template = parseTemplate(await file.text())
    if (Math.abs((template.duration || 0) - (v.duration || 0)) > 2) {
      const ok = await showConfirm({
        title: '应用分段模板',
        message: `模板原视频时长 ${formatTime(template.duration)} 与当前视频时长 ${formatTime(v.duration)} 相差较大，可能不是同一段视频，确定应用吗？`,
      })
      if (!ok) return
    }
    const segs = applyTemplate(v, template)
    await updateVideo(v)
    await load()
    showToast(`已应用分段模板（${segs.length} 段）`)
  } catch (err) {
    showAlert({ title: '导入失败', message: err.message || err })
  }
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

    <!-- 搜索 + 排序 + 批量 + 备份 -->
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon"><AppIcon name="search" :size="15" /></span>
        <input v-model="search" class="search" placeholder="搜索视频名称" />
      </div>
      <div class="tool-actions">
        <div class="tool-group left">
          <button class="tool-btn" :class="{ active: sortMenuOpen }" @click="sortMenuOpen = !sortMenuOpen">
            {{ sortLabel }}
          </button>
          <div v-if="sortMenuOpen" class="tool-menu">
            <button
              v-for="o in SORT_OPTIONS"
              :key="o.key"
              class="tool-menu-item"
              :class="{ active: sortKey === o.key }"
              @click="pickSort(o.key)"
            >
              {{ o.label }}
            </button>
          </div>
        </div>
        <button class="tool-btn" :class="{ active: batchMode }" @click="toggleBatch">
          {{ batchMode ? '完成' : '批量' }}
        </button>
        <div class="tool-group">
          <button class="tool-btn" :class="{ active: backupMenuOpen }" @click="toggleBackupMenu">备份</button>
          <div v-if="backupMenuOpen" class="tool-menu">
            <button class="tool-menu-item" @click="exportBackup">
              <span class="mi"><AppIcon name="download" :size="15" /></span>导出备份
            </button>
            <button class="tool-menu-item" @click="pickBackup">
              <span class="mi"><AppIcon name="upload" :size="15" /></span>导入备份
            </button>
          </div>
        </div>
        <input ref="backupInput" type="file" accept="application/json" hidden @change="onBackupChange" />
        <input ref="templateInput" type="file" accept=".json,application/json" hidden @change="onTemplateChange" />
      </div>

      <!-- 点击空白处关闭下拉菜单 -->
      <div v-if="sortMenuOpen || backupMenuOpen" class="menu-backdrop" @click="closeMenus"></div>
    </div>

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
        :class="{ selected: batchMode && selected.has(v.id) }"
        @pointerdown="startPress(v)"
        @pointerup="cancelPress"
        @pointercancel="cancelPress"
        @pointerleave="cancelPress"
        @contextmenu.prevent="onContextMenu(v)"
      >
        <div class="thumb" @click="onThumbClick(v)">
          <img v-if="v.thumbnail" :src="v.thumbnail" alt="" />
          <div v-else class="thumb-placeholder"><AppIcon name="video" :size="32" /></div>
          <span class="duration">{{ formatTime(v.duration) }}</span>
          <span v-if="v.segments?.length" class="badge">{{ v.segments.length }} 段</span>
          <span class="checkin-badge" :class="{ zero: checkinCount(v.id) === 0 }"><AppIcon name="flag" :size="11" /> {{ checkinCount(v.id) }}</span>
          <span v-if="batchMode" class="select-box" :class="{ on: selected.has(v.id) }">
            <AppIcon v-if="selected.has(v.id)" name="check" :size="14" />
          </span>
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
            <button class="edit-btn" @click="onEditClick(v)"><AppIcon name="scissors" :size="14" /> 编辑分段</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      <p class="empty-icon"><AppIcon name="dumbbell" :size="44" /></p>
      <p>还没有视频</p>
      <p class="dim">点击右上角「导入视频」，选择你下载好的健身视频开始吧</p>
    </div>

    <!-- 批量操作底栏 -->
    <div v-if="batchMode" class="batch-bar">
      <button class="batch-btn" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选' }}</button>
      <span class="batch-count">已选 {{ selected.size }} 项</span>
      <div class="batch-actions">
        <button class="batch-btn" @click="batchMoveOpen = !batchMoveOpen">移动</button>
        <button class="batch-btn danger" @click="deleteSelected">删除</button>
      </div>
    </div>
    <div v-if="batchMoveOpen" class="batch-move">
      <button class="folder-chip" @click="moveSelected(null)">未分类</button>
      <button v-for="f in folders" :key="f.id" class="folder-chip" @click="moveSelected(f.id)">
        {{ f.name }}
      </button>
    </div>

    <!-- 右键 / 长按操作菜单 -->
    <teleport to="body">
      <div v-if="menuVideo" class="sheet-overlay" @click.self="closeMenu">
        <div class="sheet">
          <div class="sheet-name">{{ menuVideo.name }}</div>
          <div v-if="menuVideo.note" class="sheet-note">{{ menuVideo.note }}</div>
          <div class="sheet-menu">
            <button class="menu-item" @click="menuRename">
              <span class="menu-icon"><AppIcon name="edit" :size="20" /></span>
              <span class="menu-text">
                <span class="menu-title">重命名</span>
                <span class="menu-desc">修改视频名称</span>
              </span>
            </button>
            <button class="menu-item" @click="menuNote">
              <span class="menu-icon"><AppIcon name="flag" :size="20" /></span>
              <span class="menu-text">
                <span class="menu-title">备注</span>
                <span class="menu-desc">{{ menuVideo.note ? '修改备注内容' : '添加目标、要点等' }}</span>
              </span>
            </button>
            <button class="menu-item" @click="menuWeeklyGoal">
              <span class="menu-icon"><AppIcon name="dumbbell" :size="20" /></span>
              <span class="menu-text">
                <span class="menu-title">周目标</span>
                <span class="menu-desc">{{ menuVideo.weeklyGoal ? `每周 ${menuVideo.weeklyGoal} 次` : '设置每周练习次数' }}</span>
              </span>
            </button>
            <button class="menu-item" @click="menuExportTemplate">
              <span class="menu-icon"><AppIcon name="download" :size="20" /></span>
              <span class="menu-text">
                <span class="menu-title">导出分段模板</span>
                <span class="menu-desc">分享给他人套用切分</span>
              </span>
            </button>
            <button class="menu-item" @click="menuImportTemplate">
              <span class="menu-icon"><AppIcon name="upload" :size="20" /></span>
              <span class="menu-text">
                <span class="menu-title">导入分段模板</span>
                <span class="menu-desc">套用模板到本视频</span>
              </span>
            </button>
            <div class="menu-item folder-item">
              <span class="menu-icon"><AppIcon name="folder" :size="20" /></span>
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
              <span class="menu-icon"><AppIcon name="trash" :size="20" /></span>
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
  background: var(--bg);
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-dim);
}

.empty-icon {
  display: flex;
  justify-content: center;
  margin-bottom: 10px;
  color: var(--text-dim);
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

.sheet-note {
  font-size: 13px;
  color: var(--text-dim);
  text-align: center;
  line-height: 1.5;
  padding: 0 4px;
  word-break: break-word;
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
  display: flex;
  align-items: center;
  justify-content: center;
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

/* 搜索 + 排序 + 批量 + 备份 工具栏 */
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0 12px;
  height: 38px;
}

.search-icon {
  display: flex;
  align-items: center;
  color: var(--text-dim);
}

.search {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  outline: none;
}

.tool-actions {
  display: flex;
  gap: 8px;
}

.tool-group {
  position: relative;
}

.tool-btn {
  padding: 7px 12px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
}

.tool-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #06281c;
  font-weight: 600;
}

.tool-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 30;
}

/* 靠左的菜单（排序）向右展开，避免向左溢出屏幕 */
.tool-group.left .tool-menu {
  left: 0;
  right: auto;
}

/* 下拉菜单打开时的透明遮罩：点击空白处关闭菜单 */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 29;
}

.tool-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text);
  background: transparent;
  text-align: left;
  white-space: nowrap;
}

.tool-menu-item.active {
  background: rgba(52, 211, 153, 0.14);
  color: var(--primary-dark);
  font-weight: 600;
}

.mi {
  display: inline-flex;
  align-items: center;
  color: var(--text-dim);
}

/* 批量选择 */
.select-box {
  position: absolute;
  left: 6px;
  top: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  z-index: 3;
}

.select-box.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #06281c;
}

.card.selected {
  box-shadow: 0 0 0 2px var(--primary);
}

/* 批量操作底栏（悬浮于底部导航之上） */
.batch-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(62px + env(safe-area-inset-bottom));
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
}

.batch-count {
  flex: 1;
  font-size: 13px;
  color: var(--text-dim);
}

.batch-actions {
  display: flex;
  gap: 8px;
}

.batch-btn {
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
}

.batch-btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
  font-weight: 600;
}

.batch-move {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(128px + env(safe-area-inset-bottom));
  z-index: 41;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.folder-chip {
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text);
}
</style>
