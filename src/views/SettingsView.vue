<script setup>
import { ref, onMounted } from 'vue'
import { theme, toggleTheme, showToast } from '../store'
import { getAllVideos, getAllFolders, getAllCheckins, clearAllData } from '../db'
import AppIcon from '../components/AppIcon.vue'

const usage = ref('')
const counts = ref({ videos: 0, folders: 0, checkins: 0 })

function formatBytes(bytes) {
  if (bytes == null) return '未知'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

async function refreshUsage() {
  counts.value.videos = (await getAllVideos()).length
  counts.value.folders = (await getAllFolders()).length
  counts.value.checkins = (await getAllCheckins()).length
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate()
      usage.value = `${formatBytes(est.usage)} / ${formatBytes(est.quota)}`
    } else {
      usage.value = '浏览器不支持统计'
    }
  } catch {
    usage.value = '无法获取存储信息'
  }
}

onMounted(refreshUsage)

async function onClearAll() {
  if (!confirm('确定清空全部数据（视频 / 文件夹 / 打卡）吗？此操作不可恢复，建议先导出备份。')) return
  await clearAllData()
  await refreshUsage()
  showToast('已清空全部数据')
}
</script>

<template>
  <div class="settings">
    <header class="header">
      <h1>设置</h1>
    </header>

    <!-- 外观 -->
    <section class="section">
      <h2>外观</h2>
      <div class="card">
        <div class="row" @click="toggleTheme">
          <span class="row-icon"><AppIcon name="moon" :size="20" /></span>
          <span class="row-body">
            <span class="row-name">深色模式</span>
            <span class="row-desc">{{ theme.dark ? '已开启' : '已关闭' }}</span>
          </span>
          <span class="switch" :class="{ on: theme.dark }"><span class="knob"></span></span>
        </div>
      </div>
    </section>

    <!-- 存储 -->
    <section class="section">
      <h2>存储</h2>
      <div class="card">
        <div class="row">
          <span class="row-icon"><AppIcon name="storage" :size="20" /></span>
          <span class="row-body">
            <span class="row-name">存储占用</span>
            <span class="row-desc">{{ usage }}</span>
          </span>
        </div>
        <div class="row sub">
          <span class="row-name">数据量</span>
          <span class="row-desc">{{ counts.videos }} 视频 · {{ counts.folders }} 文件夹 · {{ counts.checkins }} 打卡</span>
        </div>
      </div>
      <button class="danger-btn" @click="onClearAll">清空所有数据</button>
    </section>

    <p class="tip">提示：清空数据前建议先在「视频」页导出备份。</p>
  </div>
</template>

<style scoped>
.settings {
  padding: 16px;
}

.header h1 {
  font-size: 20px;
  margin-bottom: 14px;
}

.section {
  margin-bottom: 20px;
}

.section h2 {
  font-size: 14px;
  color: var(--text-dim);
  margin-bottom: 8px;
}

.card {
  background: var(--bg-elevated);
  border-radius: var(--radius);
  overflow: hidden;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
}

.row.sub {
  cursor: default;
  border-top: 1px solid var(--border);
  padding-top: 12px;
  padding-bottom: 12px;
}

.row-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(52, 211, 153, 0.14);
  color: var(--primary-dark);
  flex-shrink: 0;
}

.row-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}

.row-desc {
  font-size: 12px;
  color: var(--text-dim);
}

/* 开关 */
.switch {
  width: 46px;
  height: 26px;
  border-radius: 999px;
  background: var(--border);
  position: relative;
  flex-shrink: 0;
  transition: background 0.2s;
}

.switch .knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.switch.on {
  background: var(--primary);
}

.switch.on .knob {
  transform: translateX(20px);
}

.danger-btn {
  width: 100%;
  margin-top: 12px;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--danger);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}

.tip {
  font-size: 12px;
  color: var(--text-dim);
  padding: 0 4px;
}
</style>
