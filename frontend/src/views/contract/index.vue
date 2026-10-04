<template>
  <section class="page" data-module="contract">
    <header class="page-head">
      <div>
        <h2>运维合同管理</h2>
        <p class="page-desc">到期与续签结论统一以「合同期限止」为准，合同页、到期提醒、考核页取自同一份判定；历史已终止合同按当时结论留档。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记运维合同</button>
        <button class="btn" type="button" @click="exportRows">导出合同清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>合同编号 / 服务范围 / 对接人员</span>
        <input v-model="keyword" placeholder="按关键词检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>持证/在岗对账</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in rows" :key="String(view.row.id)">
          <td>{{ view.row['合同编号'] ?? '—' }}</td>
          <td>{{ view.row['服务范围'] ?? '—' }}</td>
          <td>{{ view.合同期限 }}</td>
          <td>{{ formatFee(view.row['年度费用']) }}</td>
          <td>{{ view.row['考核指标'] ?? '—' }}</td>
          <td><span :class="assessmentClass(view.verdict.assessment)">{{ view.verdict.assessment }}</span></td>
          <td>{{ view.row['对接人员'] ?? '—' }}</td>
          <td>
            <span class="badge" :class="lifeClass(view.verdict.lifeStatus)">{{ view.verdict.lifeStatus }}</span>
            <div v-if="!view.verdict.frozen && view.verdict.daysToEnd !== null" class="subtle">
              {{ view.verdict.daysToEnd >= 0 ? `距到期 ${view.verdict.daysToEnd} 天` : `已过期 ${-view.verdict.daysToEnd} 天` }}
            </div>
            <div v-if="view.verdict.frozen" class="subtle">历史终止 · 留档不再重算</div>
          </td>
          <td>
            <span class="badge" :class="renewalClass(view.verdict.renewalState)">{{ view.verdict.renewalState }}</span>
            <div v-if="Number(view.row['续签次数'] ?? 0) > 0" class="subtle">已续签 {{ view.row['续签次数'] }} 次</div>
          </td>
          <td>
            <span v-if="!view.problems.length" class="ok-text">持证在岗一致</span>
            <span v-for="problem in view.problems" :key="problem" class="problem-text">⚠ {{ problem }}<br /></span>
          </td>
          <td class="row-actions">
            <button v-if="view.verdict.lifeStatus === '待签署'" class="link" type="button" @click="act('sign', view)">确认签署</button>
            <button
              v-if="canRenew(view)"
              class="link"
              type="button"
              :disabled="view.renewalDuplicate"
              :title="view.renewalDuplicate ? '续签申请已在待审清单，重复提交只算一次' : ''"
              @click="act('renew', view)"
            >
              {{ view.verdict.renewalState === '审核中' ? '续签审核中' : '发起续签' }}
            </button>
            <button v-if="view.verdict.lifeStatus !== '已终止'" class="link" type="button" @click="act('terminate', view)">终止合同</button>
            <span v-if="view.verdict.lifeStatus === '已终止'" class="subtle">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的运维合同</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 份合同 · 续签窗口为到期前 30 天（含已过期未续签）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  exportContractViews,
  listContractViews,
  signContract,
  submitRenewal,
  terminateContract,
  type ContractView,
} from '@/api/contract-service'
import {
  LIFE_STATUSES,
  type ContractLifeStatus,
  type RenewalState,
  type AssessmentResult,
} from '@/domain/contract-lifecycle'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const columns = ['合同编号', '服务范围', '合同期限', '年度费用', '考核指标', '考核结果', '对接人员', '到期结论', '续签状态']

const all = ref<ContractView[]>([])
const keyword = ref('')
const errorMessage = ref('')

const rows = computed(() => {
  const word = keyword.value.trim()
  if (!word) {
    return all.value
  }
  return all.value.filter((view) =>
    [view.row['合同编号'], view.row['服务范围'], view.row['对接人员']]
      .some((field) => String(field ?? '').includes(word)),
  )
})
const total = computed(() => rows.value.length)

const stats = computed(() => [
  { label: '履行中合同', value: all.value.filter((v) => v.verdict.lifeStatus === '履行中').length },
  { label: '待续签/已过期', value: all.value.filter((v) => isRenewal(v.verdict.renewalState, v.verdict.lifeStatus)).length },
  {
    label: '本年合同金额（万元）',
    value: (all.value
      .filter((v) => v.verdict.lifeStatus === '履行中' || v.verdict.lifeStatus === '待续签')
      .reduce((sum, v) => sum + Number(v.row['年度费用'] ?? 0), 0) / 10000).toFixed(1),
  },
])

const statusSummary = computed(() =>
  LIFE_STATUSES.map((status) => ({
    status,
    count: all.value.filter((view) => view.verdict.lifeStatus === status).length,
  })),
)

function isRenewal(state: RenewalState, life: ContractLifeStatus): boolean {
  return life !== '已终止' && (state === '待续签' || state === '审核中')
}

function canRenew(view: ContractView): boolean {
  return (
    view.verdict.lifeStatus !== '待签署' &&
    view.verdict.lifeStatus !== '已终止' &&
    view.verdict.renewalState !== '已续签' &&
    view.verdict.inRenewalWindow
  )
}

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

function assessmentClass(result: AssessmentResult): string {
  if (result === '合格') return 'badge pass'
  if (result === '不合格') return 'badge fail'
  return 'badge neutral'
}

function formatFee(value: unknown): string {
  const amount = Number(value ?? 0)
  return amount ? `${(amount / 10000).toFixed(2)} 万元` : '—'
}

function resetFilters() {
  keyword.value = ''
}

function exportRows() {
  const { filename, content } = exportContractViews()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openCreate() {
  errorMessage.value = '运维合同登记入口尚未接入审批流'
}

function act(kind: 'sign' | 'renew' | 'terminate', view: ContractView) {
  errorMessage.value = ''
  const id = Number(view.row.id)
  const result =
    kind === 'sign'
      ? signContract(id)
      : kind === 'renew'
        ? submitRenewal(id, store.operator)
        : terminateContract(id)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  all.value = listContractViews()
}

onMounted(reload)
</script>
