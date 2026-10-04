<template>
  <section class="page" data-module="renewal">
    <header class="page-head">
      <div>
        <h2>到期提醒</h2>
        <p class="page-desc">提醒结论与合同页、考核页同源，均以「合同期限止」为准；手工续签状态只表示续签流程走到哪一步。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新提醒</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待处理续签提醒</span>
        <strong class="stat-value">{{ reminders.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">其中已过期未续签</span>
        <strong class="stat-value" style="color:#b42318">{{ overdueCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">续签审核中</span>
        <strong class="stat-value" style="color:#1f6feb">{{ reviewingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">对接人员持证在岗异常</span>
        <strong class="stat-value" style="color:#b45309">{{ problemCount }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>合同编号</th>
          <th>服务范围</th>
          <th>对接人员</th>
          <th>合同期限止</th>
          <th>剩余/超期</th>
          <th>到期结论</th>
          <th>续签状态</th>
          <th>持证/在岗对账</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in reminders" :key="String(view.row.id)">
          <td>{{ view.row['合同编号'] }}</td>
          <td>{{ view.row['服务范围'] }}</td>
          <td>{{ view.row['对接人员'] }}</td>
          <td>{{ view.verdict.end ?? '期限未登记' }}</td>
          <td>
            <span v-if="view.verdict.daysToEnd === null" class="subtle">—</span>
            <span v-else-if="view.verdict.daysToEnd < 0" class="problem-text">已超期 {{ -view.verdict.daysToEnd }} 天</span>
            <span v-else-if="view.verdict.daysToEnd <= 7" class="problem-text">仅剩 {{ view.verdict.daysToEnd }} 天</span>
            <span v-else>剩 {{ view.verdict.daysToEnd }} 天</span>
          </td>
          <td><span class="badge" :class="lifeClass(view.verdict.lifeStatus)">{{ view.verdict.lifeStatus }}</span></td>
          <td>
            <span class="badge" :class="renewalClass(view.verdict.renewalState)">{{ view.verdict.renewalState }}</span>
            <div v-if="view.openRenewal" class="subtle">待审单号 R-{{ view.openRenewal.id }}</div>
          </td>
          <td>
            <span v-if="!view.problems.length" class="ok-text">一致</span>
            <span v-for="problem in view.problems" :key="problem" class="problem-text">⚠ {{ problem }}<br /></span>
          </td>
          <td>
            <button
              v-if="view.verdict.renewalState !== '审核中'"
              class="link"
              type="button"
              @click="renew(view)"
            >提交续签申请</button>
            <span v-else class="subtle">已在待审清单，勿重复提交</span>
          </td>
        </tr>
        <tr v-if="!reminders.length">
          <td colspan="9" class="empty-state">续签窗口内暂无待处理合同</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>续签窗口为到期前 30 天；同一合同重复提交续签申请只算一次，以待审清单中的待审核记录为准。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listReminders, submitRenewal, type ContractView } from '@/api/contract-service'
import type { ContractLifeStatus, RenewalState } from '@/domain/contract-lifecycle'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const reminders = ref<ContractView[]>([])
const errorMessage = ref('')

const overdueCount = computed(
  () => reminders.value.filter((view) => view.verdict.lifeStatus === '已过期').length,
)
const reviewingCount = computed(
  () => reminders.value.filter((view) => view.verdict.renewalState === '审核中').length,
)
const problemCount = computed(() => reminders.value.filter((view) => view.problems.length > 0).length)

function lifeClass(status: ContractLifeStatus): string {
  return {
    履行中: 'performing',
    待签署: 'neutral',
    待续签: 'due',
    已过期: 'overdue',
    已终止: 'done',
  }[status]
}

function renewalClass(state: RenewalState): string {
  return {
    未到续签窗口: 'neutral',
    待续签: 'due',
    审核中: 'reviewing',
    已续签: 'performing',
    无需续签: 'done',
  }[state]
}

function renew(view: ContractView) {
  errorMessage.value = ''
  const result = submitRenewal(Number(view.row.id), store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  reminders.value = listReminders()
}

onMounted(reload)
</script>
