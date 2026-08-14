<script setup>
import { ref, onMounted } from 'vue'
import {
  getAllFolders,
  addFolder,
  updateFolder,
  deleteFolder,
  getAllVideos,
  updateVideo,
  uid,
} from '../db'
import { store } from '../store'

const folders = ref([])
const videos = ref([])
const newName = ref('')

async function load() {
  folders.value = await getAllFolders()
  videos.value = await getAllVideos()
}

onMounted(load)

function videoCount(folderId) {
  return videos.value.filter((v) => v.folderId === folderId).length
}

async function create() {
  const name = newName.value.trim()
  if (!name) return
  await addFolder({ id: uid(), name, createdAt: Date.now() })
  newName.value = ''
  await load()
}

async function rename(f) {
  const name = prompt('重命名文件夹', f.name)
  if (!name || !name.trim()) return
  f.name = name.trim()
  await updateFolder(f)
  await load()
}

async function remove(f) {
  const count = videoCount(f.id)
  if (!confirm(`删除文件夹「${f.name}」？${count ? `里面有 ${count} 个视频会变成未分类。` : ''}`)) return
  for (const v of videos.value) {
    if (v.folderId === f.id) {
      v.folderId = null
      await updateVideo(v)
    }
  }
  await deleteFolder(f.id)
  await load()
}

/** 点击文件夹 → 跳到视频库并按该文件夹筛选 */
function goFolder(f) {
  store.activeFolderId = f.id
  store.tab = 'library'
}
</script>

<template>
  <div class="categories">
    <header class="header">
      <h1>分类</h1>
    </header>

    <div class="create-row">
      <input
        v-model="newName"
        class="input"
        placeholder="新建文件夹，如「肩背」「核心」"
        @keyup.enter="create"
      />
      <button class="create-btn" @click="create">新建</button>
    </div>

    <div v-if="folders.length" class="list">
      <div v-for="f in folders" :key="f.id" class="item" @click="goFolder(f)">
        <span class="folder-icon">📁</span>
        <span class="folder-name">{{ f.name }}</span>
        <span class="count">{{ videoCount(f.id) }} 个视频</span>
        <button class="action" @click.stop="rename(f)">✏️</button>
        <button class="action danger" @click.stop="remove(f)">🗑</button>
      </div>
    </div>
    <div v-else class="empty">
      <p>还没有文件夹</p>
      <p class="dim">为不同的运动视频建文件夹，方便归类</p>
    </div>
  </div>
</template>

<style scoped>
.categories {
  padding: 16px;
}

.header h1 {
  font-size: 20px;
  margin-bottom: 14px;
}

.create-row {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.input {
  flex: 1;
  padding: 10px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 14px;
}

.create-btn {
  padding: 0 18px;
  background: var(--primary);
  color: #06281c;
  font-weight: 700;
  border-radius: var(--radius);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-elevated);
  padding: 14px;
  border-radius: var(--radius);
  cursor: pointer;
}

.folder-icon {
  font-size: 20px;
}

.folder-name {
  flex: 1;
  font-size: 15px;
  font-weight: 500;
}

.count {
  font-size: 12px;
  color: var(--text-dim);
}

.action {
  font-size: 16px;
  padding: 4px;
}

.action.danger {
  color: var(--danger);
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-dim);
}

.empty .dim {
  font-size: 13px;
  margin-top: 6px;
  opacity: 0.7;
}
</style>
