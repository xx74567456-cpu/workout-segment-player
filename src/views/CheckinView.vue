<script setup>
import { ref, onMounted, computed } from 'vue'
import { getAllCheckins, getAllVideos } from '../db'

const checkins = ref([])
const videos = ref([])

onMounted(async () => {
  videos.value = await getAllVideos()
  const all = await getAllCheckins()
  // 过滤掉已删除视频遗留的孤儿打卡记录（视频已删，其打卡不再显示）
  const ids = new Set(videos.value.map((v) => v.id))
  checkins.value = all.filter((c) => ids.has(c.videoId))
})

function pad(n) {
  return String(n).padStart(2, '0')
}
function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const videoName = (id) => videos.value.find((v) => v.id === id)?.name || '已删除视频'

// 统计卡片
const total = computed(() => checkins.value.length)
const todayStrNow = computed(() => dateStr(new Date()))
const today = computed(() => checkins.value.filter((c) => c.date === todayStrNow.value).length)

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

// ---------- 日历 ----------
const monthCursor = ref(new Date())
const year = computed(() => monthCursor.value.getFullYear())
const month = computed(() => monthCursor.value.getMonth())
const monthLabel = computed(() => `${year.value} 年 ${month.value + 1} 月`)

// 每个日期 -> { count, items }
const checkinMap = computed(() => {
  const map = {}
  for (const c of checkins.value) {
    if (!map[c.date]) map[c.date] = { count: 0, items: [] }
    map[c.date].count++
    map[c.date].items.push(c)
  }
  return map
})

// 生成当月日历网格（周一为一周起始，前导/尾部用 null 补齐整行）
const calendar = computed(() => {
  const y = year.value
  const m = month.value
  const first = new Date(y, m, 1)
  const startWeekday = (first.getDay() + 6) % 7 // 周一=0 … 周日=6
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${pad(m + 1)}-${pad(d)}`
    cells.push({ day: d, date, info: checkinMap.value[date] || null })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
})

const weekLabels = ['一', '二', '三', '四', '五', '六', '日']

// 选中某天查看当天打卡记录（按视频聚合，显示每个视频当天打卡了几次）
const selectedDate = ref(null)
const selectedItems = computed(() => {
  const info = selectedDate.value ? checkinMap.value[selectedDate.value] : null
  if (!info) return []
  const map = {}
  for (const c of info.items) map[c.videoId] = (map[c.videoId] || 0) + 1
  return Object.entries(map)
    .map(([id, count]) => ({ id, name: videoName(id), count }))
    .sort((a, b) => b.count - a.count)
})

function selectDay(cell) {
  if (!cell || !cell.info) return
  selectedDate.value = cell.date
}

function closeDetail() {
  selectedDate.value = null
}

// 选中当天打卡总次数
const selectedTotal = computed(() => {
  const info = selectedDate.value ? checkinMap.value[selectedDate.value] : null
  return info ? info.count : 0
})

function prevMonth() {
  monthCursor.value = new Date(year.value, month.value - 1, 1)
}
function nextMonth() {
  monthCursor.value = new Date(year.value, month.value + 1, 1)
}

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

    <!-- 日历 -->
    <section class="section">
      <div class="cal-header">
        <button class="nav" :aria-label="'上个月'" @click="prevMonth">‹</button>
        <div class="cal-title">{{ monthLabel }}</div>
        <button class="nav" :aria-label="'下个月'" @click="nextMonth">›</button>
      </div>

      <div class="week-row">
        <span v-for="w in weekLabels" :key="w" class="week">{{ w }}</span>
      </div>

      <div class="cal-grid">
        <div
          v-for="(cell, i) in calendar"
          :key="i"
          class="cell"
          :class="{
            empty: !cell,
            checkin: cell && cell.info,
            today: cell && cell.date === todayStrNow,
            selected: cell && cell.date === selectedDate,
          }"
          @click="selectDay(cell)"
        >
          <template v-if="cell">
            <span class="day">{{ cell.day }}</span>
            <span v-if="cell.info" class="count">{{ cell.info.count }}</span>
          </template>
        </div>
      </div>
    </section>

    <div v-if="!checkins.length" class="empty">
      <p class="empty-icon">📅</p>
      <p>还没有打卡记录</p>
      <p class="dim">完成一次训练后，在播放器里点 💪 打卡</p>
    </div>

    <!-- 选中日期打卡详情弹窗（居中，右上角 ✕ 关闭） -->
    <teleport to="body">
      <div v-if="selectedDate" class="day-overlay" @click.self="closeDetail">
        <div class="day-sheet">
          <div class="day-sheet-head">
            <div>
              <div class="day-sheet-title">{{ selectedDate }}</div>
              <div class="day-sheet-sub">共打卡 {{ selectedTotal }} 次</div>
            </div>
            <button class="day-close" aria-label="关闭" @click="closeDetail">✕</button>
          </div>
          <div class="day-sheet-body">
            <div class="row" v-for="c in selectedItems" :key="c.id">
              <span class="row-name">{{ c.name }}</span>
              <span class="row-count">{{ c.count }} 次</span>
            </div>
          </div>
        </div>
      </div>
    </teleport>
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

/* 日历 */
.cal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.cal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.nav {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  font-size: 18px;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
}

.week-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-bottom: 4px;
}

.week {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  padding: 2px 0 0;
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.cell {
  height: 40px;
  border-radius: 8px;
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: default;
}

.cell.empty {
  background: transparent;
}

.cell.checkin {
  background: rgba(16, 185, 129, 0.15);
  cursor: pointer;
}

.day {
  font-size: 13px;
  color: var(--text);
}

.cell.checkin .day {
  font-weight: 600;
  color: var(--primary-dark);
}

.count {
  font-size: 9px;
  color: var(--primary);
  font-weight: 700;
  margin-top: 1px;
}

.cell.today {
  box-shadow: inset 0 0 0 2px var(--primary);
}

.cell.selected {
  box-shadow: inset 0 0 0 2px var(--primary-dark);
}

/* 记录列表 */
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

/* 日期详情弹窗 */
.day-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.day-sheet {
  width: 100%;
  max-width: 400px;
  background: var(--bg-elevated);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.day-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.day-sheet-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.day-sheet-sub {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}

.day-close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.day-sheet-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.day-sheet-body .row {
  margin-bottom: 0;
}
</style>
