<script setup>
// 全局统一对话框：替代浏览器原生 confirm / alert / prompt。
// 由 store.js 的 showConfirm / showAlert / showPrompt 触发，这里负责渲染与回传结果。
import { dialog, closeDialog } from '../store'

function onConfirm() {
  if (dialog.type === 'prompt') {
    closeDialog(dialog.inputValue)
  } else {
    closeDialog(true)
  }
}

function onCancel() {
  closeDialog(dialog.type === 'prompt' ? null : false)
}
</script>

<template>
  <transition name="dialog">
    <div v-if="dialog.show" class="dialog-mask" @click.self="onCancel">
      <div class="dialog" role="dialog" aria-modal="true">
        <div v-if="dialog.title" class="dialog-title">{{ dialog.title }}</div>
        <div class="dialog-message">{{ dialog.message }}</div>

        <input
          v-if="dialog.type === 'prompt'"
          v-model="dialog.inputValue"
          class="dialog-input"
          :placeholder="dialog.placeholder"
          @keyup.enter="onConfirm"
          @keyup.esc="onCancel"
        />

        <div class="dialog-actions" :class="{ single: dialog.type === 'alert' }">
          <button v-if="dialog.type !== 'alert'" class="dialog-btn cancel" @click="onCancel">
            {{ dialog.cancelText }}
          </button>
          <button
            class="dialog-btn confirm"
            :class="{ danger: dialog.danger }"
            @click="onConfirm"
          >
            {{ dialog.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  backdrop-filter: blur(2px);
}

.dialog {
  width: 100%;
  max-width: 320px;
  background: var(--bg-elevated);
  color: var(--text);
  border-radius: 18px;
  padding: 22px 20px 16px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
  border: 1px solid var(--border);
}

.dialog-title {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 8px;
}

.dialog-message {
  font-size: 15px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-line;
  word-break: break-word;
}

.dialog-input {
  width: 100%;
  margin-top: 14px;
  padding: 10px 12px;
  font-size: 15px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  outline: none;
}

.dialog-input:focus {
  border-color: var(--primary);
}

.dialog-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.dialog-actions.single {
  justify-content: flex-end;
}

.dialog-btn {
  flex: 1;
  padding: 11px 0;
  font-size: 15px;
  font-weight: 600;
  border-radius: 12px;
  transition: opacity 0.15s, transform 0.05s;
}

.dialog-btn:active {
  transform: scale(0.98);
}

.dialog-btn.cancel {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
}

.dialog-btn.confirm {
  background: var(--primary);
  color: #06301f;
}

.dialog-btn.confirm.danger {
  background: var(--danger);
  color: #fff;
}

.dialog-actions.single .dialog-btn.confirm {
  flex: 0 0 auto;
  padding-left: 28px;
  padding-right: 28px;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s;
}

.dialog-enter-active .dialog,
.dialog-leave-active .dialog {
  transition: transform 0.2s;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog,
.dialog-leave-to .dialog {
  transform: scale(0.92);
}
</style>
