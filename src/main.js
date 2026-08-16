import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import { initTheme } from './store'

initTheme()

createApp(App).mount('#app')
