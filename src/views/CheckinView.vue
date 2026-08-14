<script setup>
import { ref, onMounted, computed } from 'vue'
import { getAllCheckins, getAllVideos } from '../db'

const checkins = ref([])
const videos = ref([])

onMounted(async () => {
  checkins.value = await getAllCheckins()
  videos.value = await getAllVideos()
})

function dateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const videoName = (id) => videos.value.find((v) => v.id === id)?.name || '已删除视频'

// 统计卡片
const total = computed(() => checkins.value.length)
const today = computed(() => checkins.value.filter((c) => c.date === dateStr(new Date())).length)

// 连续打卡天数：从今天（今天没打则从昨天）往前数
const streak = computed(() => {
  const dates = new Set(checkins.value.map((c) => c.date))
  const d = new Date()
  if (!dates.has(dateStr(d))) d.setDate(d.getDate() - 1)
  let count = 0
  while (dates.has(dateStr(d))) {
    count++
    d.setDate(d.getDate() - 1)
  }
  return count
})

// 按视频统计
const byVideo = computed(() => {
  const map = {}
  for (const c of checkins.value) map[c.videoId] = (map[c.videoId] || 0) + 1
  return Object.entries(map)
    .map(([id, count]) => ({ name: videoName(id), count }))
    .sort((a, b) => b.count - a.count)
})

// 按日期分组（最近 30 条）
const byDate = computed(() => {
  const map = {}
  for (const c of checkins.value) map[c.date] = (map[c.date] || 0) + 1
  return Object.entries(map)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 30)
})
</script>

<template>
  <div class="checkin">
    <header class="header">
      <h1>打卡</h1>
    </header>

    <!-- 统计卡片 -->
    <div class="stats">
      <div class="stat">
        <div class="num">{{ total }}</div>
        <div class="label">总次数</div>
      </div>
      <div class="stat">
        <div class="num">{{ today }}</div>
        <div class="label">今日</div>
      </div>
      <div class="stat">
        <div class="num">{{ streak }}</div>
        <div class="label">连续天数</div>
      </div>
    </div>

    <!-- 按视频 -->
    <section v-if="byVideo.length" class="section">
      <h2>按视频</h2>
      <div class="row" v-for="b in byVideo" :key="b.name">
        <span class="row-name">{{ b.name }}</span>
        <span class="row-count">{{ b.count }} 次</span>
      </div>
    </section>

    <!-- 历史 -->
    <section v-if="byDate.length" class="section">
      <h2>历史记录</h2>
      <div class="row" v-for="[date, count] in byDate" :key="date">
        <span class="row-name">{{ date }}</span>
        <span class="row-count">{{ count }} 次</span>
      </div>
    </section>

    <div v-if="!checkins.length" class="empty">
      <p class="empty-icon">📅</p>
      <p>还没有打卡记录</p>
      <p class="dim">完成一次训练后，在播放器里点 💪 打卡</p>
    </div>
  </div>
</template>

<style scoped>
.checkin {
  padding: 16px;
}

.header h1 {
  font-size: 20px;
  margin-bottom: 14px;
}

.stats {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.stat {
  flex: 1;
  background: var(--bg-elevated);
  border-radius: var(--radius);
  padding: 16px 8px;
  text-align: center;
}

.num {
  font-size: 28px;
  font-weight: 800;
  color: var(--primary);
}

.label {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
}

.section {
  margin-bottom: 20px;
}

.section h2 {
  font-size: 15px;
  color: var(--text-dim);
  margin-bottom: 10px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-elevated);
  padding: 12px 14px;
  border-radius: var(--radius);
  margin-bottom: 8px;
}

.row-name {
  font-size: 14px;
}

.row-count {
  font-size: 13px;
  color: var(--primary);
  font-weight: 600;
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
