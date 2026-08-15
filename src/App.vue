<script setup>
import { store, toast } from './store'
import LibraryView from './views/LibraryView.vue'
import CategoriesView from './views/CategoriesView.vue'
import CheckinView from './views/CheckinView.vue'
import PlayerView from './views/PlayerView.vue'
import EditorView from './views/EditorView.vue'

const tabs = [
  { key: 'library', label: '视频', icon: '🎬' },
  { key: 'categories', label: '分类', icon: '📁' },
  { key: 'checkin', label: '打卡', icon: '📅' },
]
</script>

<template>
  <div class="app">
    <main class="content">
      <LibraryView v-if="store.tab === 'library'" />
      <CategoriesView v-else-if="store.tab === 'categories'" />
      <CheckinView v-else-if="store.tab === 'checkin'" />
    </main>

    <!-- 底部导航 -->
    <nav class="tabbar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: store.tab === t.key }"
        @click="store.tab = t.key"
      >
        <span class="icon">{{ t.icon }}</span>
        <span class="label">{{ t.label }}</span>
      </button>
    </nav>

    <!-- 全屏覆盖层：播放器 / 编辑器 -->
    <PlayerView v-if="store.playerVideo" />
    <EditorView v-if="store.editorVideo" />

    <!-- 全局提示 -->
    <transition name="toast">
      <div v-if="toast.show" class="toast">{{ toast.message }}</div>
    </transition>
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding-bottom: env(safe-area-inset-bottom);
}

.tabbar {
  flex-shrink: 0;
  display: flex;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0 6px;
  color: var(--text-dim);
  transition: color 0.15s;
}

.tab.active {
  color: var(--primary);
}

.icon {
  font-size: 20px;
  line-height: 1;
}

.label {
  font-size: 11px;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.92);
  color: #1f2937;
  padding: 10px 20px;
  border-radius: 999px;
  font-size: 14px;
  z-index: 300;
  white-space: nowrap;
  border: 1px solid var(--border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>
