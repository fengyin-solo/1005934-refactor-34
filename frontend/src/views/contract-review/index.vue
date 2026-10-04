<template>
  <section class="page" data-module="contract-assessment">
    <header class="page-head">
      <div>
        <h2>合同履约考核</h2>
        <p class="page-desc">
          考核页只负责登记考核指标与履约结果：指标是否达标不再参与到期判定，到期结论与合同页、到期提醒完全同源；
          对接人员提交的履约结果统一落到待审清单，审核通过后才写回合同。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/renewal">看到期续签提醒</RouterLink>
        <RouterLink class="btn primary" to="/review">去待审清单审核</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">已考核合同</span>
        <strong class="stat-value">{{ assessedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">履约待审 / 审核中</span>
        <strong class="stat-value">{{ pendingResultCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">合同已到期（统一结论）</span>
        <strong class="stat-value danger-text">{{ expiredCount }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>合同编号</th>
          <th>服务范围</th>
          <th>考核指标</th>
          <th>已确认考核结果</th>
          <th>统一到期结论</th>
          <th>续签状态</th>
          <th>对接人员</th>
          <th>提交履约结果</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in rows" :key="String(item.row.id)">
          <td>{{ item.code }}</td>
          <td>{{ item.scope }}</td>
          <td>{{ item.target || '—' }}</td>
          <td>
            <span v-if="item.result">{{ item.result }}</span>
            <span v-else class="muted-text">尚未确认</span>
          </td>
          <td><span class="badge" :class="badgeClass(item)">{{ item.lifecycle }}</span></td>
          <td>{{ item.renewalStatus }}</td>
          <td>{{ item.contact }}</td>
          <td>
            <div class="result-submit">
              <input
                v-model="drafts[Number(item.row.id)]"
                :disabled="item.archived"
                placeholder="填写达标 / 不达标及简要说明"
              />
              <button
                class="btn primary"
                type="button"
                :disabled="item.archived"
                @click="submit(item.row.id)"
              >
                提交待审
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="8" class="empty-state">暂无合同考核数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      <span>同一份合同已有履约结果在审时，重复提交会被拦截</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  listContractViews,
  listReviews,
  submitPerformance,
  type ContractView,
} from '@/api/contract-service'

const rows = ref<ContractView[]>([])
const drafts = reactive<Record<number, string>>({})
const message = ref('')
const messageOk = ref(false)

const assessedCount = computed(() => rows.value.filter((item) => item.result).length)
const expiredCount = computed(
  () => rows.value.filter((item) => item.daysRemaining !== null && item.daysRemaining < 0 && !item.archived).length,
)
const pendingResultCount = computed(
  () => listReviews({ 事项类型: '履约考核', status: '待审核' }).length,
)

function badgeClass(item: ContractView): string {
  if (item.archived) {
    return 'muted'
  }
  if (item.lifecycle.startsWith('待续签')) {
    return 'danger'
  }
  if (item.lifecycle.includes('天后到期')) {
    return 'warn'
  }
  return 'ok'
}

function submit(id: number) {
  const value = drafts[id] ?? ''
  const result = submitPerformance(id, value)
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    drafts[id] = ''
  }
  reload()
}

function reload() {
  rows.value = listContractViews({})
}

onMounted(reload)
</script>
