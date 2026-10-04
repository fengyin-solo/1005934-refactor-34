import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import { allRows } from './data/local-store'
import { listReviews } from './data/review-store'
import { runDataMigrations } from './data/migration'

// 存量合同按合同期限回填一遍（历史已终止的留档不动），之后三个页面共用同一份取数。
runDataMigrations(allRows(), listReviews())

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
