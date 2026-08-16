<script setup>
import { ref, onMounted, computed } from 'vue'
import { getAllCheckins, getAllVideos } from '../db'
import AppIcon from '../components/AppIcon.vue'

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

// ---------- 数据统计：时长 / 周目标 / 热力图 / 里程碑 ----------

function formatDuration(sec) {
  sec = Math.round(sec || 0)
  if (sec < 60) return `${sec} 秒`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h} 小时 ${mm} 分`
}

// 累计跟练时长：按打卡次数累加对应视频的总时长（近似估计）
const totalDuration = computed(() => {
  const durMap = {}
  for (const v of videos.value) durMap[v.id] = v.duration || 0
  return checkins.value.reduce((sum, c) => sum + (durMap[c.videoId] || 0), 0)
})

function startOfWeek(d) {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7 // 周一=0 … 周日=6
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}

// 每个视频的本周目标进度（仅展示设置了周目标的视频）
const weeklyProgress = computed(() => {
  const start = startOfWeek(new Date())
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  const countMap = {}
  for (const c of checkins.value) {
    const t = new Date(c.date + 'T00:00:00')
    if (t >= start && t < end) countMap[c.videoId] = (countMap[c.videoId] || 0) + 1
  }
  return videos.value
    .filter((v) => (v.weeklyGoal || 0) > 0)
    .map((v) => ({
      id: v.id,
      name: v.name,
      goal: v.weeklyGoal,
      count: countMap[v.id] || 0,
      percent: Math.min(100, Math.round(((countMap[v.id] || 0) / v.weeklyGoal) * 100)),
    }))
    .sort((a, b) => b.percent - a.percent)
})

// 热力图：最近 16 周（周一为列起点），颜色深浅按当天打卡次数
const HEAT_WEEKS = 16
const heatmap = computed(() => {
  const counts = {}
  for (const c of checkins.value) counts[c.date] = (counts[c.date] || 0) + 1
  const weeks = []
  const thisWeek = startOfWeek(new Date())
  const first = new Date(thisWeek)
  first.setDate(first.getDate() - (HEAT_WEEKS - 1) * 7)
  const cursor = new Date(first)
  while (cursor <= thisWeek) {
    const week = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(cursor)
      day.setDate(cursor.getDate() + d)
      const date = dateStr(day)
      week.push({
        date,
        count: counts[date] || 0,
        future: day.getTime() > Date.now(),
      })
    }
    weeks.push(week)
    cursor.setDate(cursor.getDate() + 7)
  }
  return weeks
})

function heatLevel(count) {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count === 3) return 3
  return 4
}

// 里程碑：按累计次数 / 连续天数解锁
const milestones = computed(() => [
  { key: 'first', label: '初次打卡', icon: 'flag', desc: '完成 1 次打卡', reached: checkins.value.length >= 1 },
  { key: 'ten', label: '小有成就', icon: 'flag', desc: '累计 10 次打卡', reached: checkins.value.length >= 10 },
  { key: 'fifty', label: '坚持达人', icon: 'flag', desc: '累计 50 次打卡', reached: checkins.value.length >= 50 },
  { key: 'hundred', label: '百炼成钢', icon: 'flag', desc: '累计 100 次打卡', reached: checkins.value.length >= 100 },
  { key: 'streak7', label: '连续 7 天', icon: 'calendar', desc: '连续打卡 7 天', reached: streak.value >= 7 },
  { key: 'streak30', label: '连续 30 天', icon: 'calendar', desc: '连续打卡 30 天', reached: streak.value >= 30 },
])

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

    <!-- 累计跟练时长 -->
    <div class="duration-strip">
      <span class="ds-label">累计跟练时长</span>
      <span class="ds-value">{{ formatDuration(totalDuration) }}</span>
    </div>

    <!-- 本周目标（每个视频独立设置） -->
    <section class="section goal-card">
      <div class="goal-head">
        <h2>本周目标</h2>
        <span class="goal-hint">长按视频可设置周目标</span>
      </div>
      <div v-if="weeklyProgress.length" class="goal-list">
        <div v-for="g in weeklyProgress" :key="g.id" class="goal-item">
          <div class="goal-item-head">
            <span class="goal-name">{{ g.name }}</span>
            <span class="goal-num">{{ g.count }} / {{ g.goal }} 次</span>
          </div>
          <div class="goal-track">
            <div class="goal-fill" :style="{ width: g.percent + '%' }"></div>
          </div>
        </div>
      </div>
      <div v-else class="goal-empty">还没有设置周目标，长按视频即可设置</div>
    </section>

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

    <!-- 活跃热力图 -->
    <section class="section">
      <h2>活跃热力图</h2>
      <div class="heatmap">
        <div v-for="(week, wi) in heatmap" :key="wi" class="heat-col">
          <div
            v-for="(day, di) in week"
            :key="di"
            class="heat-cell"
            :class="['lv' + heatLevel(day.count), { future: day.future }]"
            :title="day.future ? '' : day.date + '：' + day.count + ' 次'"
          ></div>
        </div>
      </div>
      <div class="heat-legend">
        <span class="hl-label">少</span>
        <span class="heat-cell lv0"></span>
        <span class="heat-cell lv1"></span>
        <span class="heat-cell lv2"></span>
        <span class="heat-cell lv3"></span>
        <span class="heat-cell lv4"></span>
        <span class="hl-label">多</span>
      </div>
    </section>

    <!-- 里程碑 -->
    <section class="section">
      <h2>里程碑</h2>
      <div class="milestones">
        <div v-for="m in milestones" :key="m.key" class="mile" :class="{ reached: m.reached }">
          <span class="mile-icon"><AppIcon :name="m.icon" :size="18" /></span>
          <span class="mile-body">
            <span class="mile-label">{{ m.label }}</span>
            <span class="mile-desc">{{ m.desc }}</span>
          </span>
        </div>
      </div>
    </section>

    <div v-if="!checkins.length" class="empty">
      <p class="empty-icon"><AppIcon name="calendar" :size="44" /></p>
      <p>还没有打卡记录</p>
      <p class="dim">完成一次训练后，在播放器里点打卡即可记录</p>
    </div>

    <!-- 选中日期打卡详情弹窗（居中，右上角关闭按钮） -->
    <teleport to="body">
      <div v-if="selectedDate" class="day-overlay" @click.self="closeDetail">
        <div class="day-sheet">
          <div class="day-sheet-head">
            <div>
              <div class="day-sheet-title">{{ selectedDate }}</div>
              <div class="day-sheet-sub">共打卡 {{ selectedTotal }} 次</div>
            </div>
            <button class="day-close" aria-label="关闭" @click="closeDetail"><AppIcon name="close" :size="16" /></button>
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
  line-height: 1;
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
  background: rgba(52, 211, 153, 0.15);
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

/* 累计跟练时长 */
.duration-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-elevated);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 20px;
}

.ds-label {
  font-size: 13px;
  color: var(--text-dim);
}

.ds-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--primary-dark);
}

/* 本周目标 */
.goal-card {
  background: var(--bg-elevated);
  border-radius: var(--radius);
  padding: 14px 16px;
}

.goal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.goal-head h2 {
  margin-bottom: 0;
  color: var(--text);
  font-size: 14px;
}

.goal-hint {
  font-size: 12px;
  color: var(--text-dim);
}

.goal-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.goal-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.goal-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 12px;
}

.goal-num {
  font-size: 12px;
  color: var(--text-dim);
  flex-shrink: 0;
}

.goal-track {
  height: 10px;
  border-radius: 999px;
  background: var(--bg);
  overflow: hidden;
}

.goal-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--primary), var(--primary-dark));
  transition: width 0.4s ease;
}

.goal-empty {
  font-size: 13px;
  color: var(--text-dim);
  padding: 4px 0;
}

/* 热力图 */
.heatmap {
  display: flex;
  gap: 3px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.heat-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.heat-cell {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--border);
  flex-shrink: 0;
}

.heat-cell.lv1 {
  background: #a7f3d0;
}

.heat-cell.lv2 {
  background: #6ee7b7;
}

.heat-cell.lv3 {
  background: #34d399;
}

.heat-cell.lv4 {
  background: #10b981;
}

.heat-cell.future {
  background: transparent;
}

.heat-legend {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-dim);
}

.heat-legend .heat-cell {
  width: 12px;
  height: 12px;
}

.hl-label {
  margin: 0 4px;
}

/* 里程碑 */
.milestones {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.mile {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-elevated);
  border-radius: var(--radius);
  padding: 12px;
  opacity: 0.5;
}

.mile.reached {
  opacity: 1;
}

.mile-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--bg);
  color: var(--text-dim);
  flex-shrink: 0;
}

.mile.reached .mile-icon {
  background: rgba(52, 211, 153, 0.16);
  color: var(--primary-dark);
}

.mile-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mile-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.mile-desc {
  font-size: 11px;
  color: var(--text-dim);
}
</style>
