<template>
  <section class="page" data-module="contract">
    <header class="page-head">
      <div>
        <h2>运维合同管理</h2>
        <p class="page-desc">到期与续签结论统一按「合同期限最后一天」推导，合同页、到期提醒、合同考核共用同一份取数；续签状态只由续签流程写入。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记运维合同</button>
        <button class="btn" type="button" @click="exportRows">导出合同结论清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in lifecycleSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>合同编号</span>
        <input v-model="filters['合同编号']" placeholder="按合同编号检索" />
      </label>
      <label class="filter-item">
        <span>服务范围</span>
        <input v-model="filters['服务范围']" placeholder="按服务范围检索" />
      </label>
      <label class="filter-item">
        <span>对接人员</span>
        <input v-model="filters['对接人员']" placeholder="按对接人员检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in rows" :key="String(item.row.id)">
          <td>{{ item.code }}</td>
          <td>{{ item.scope }}</td>
          <td>{{ item.term }}</td>
          <td>{{ item.termEnd }}</td>
          <td>
            <span class="badge" :class="lifecycleClass(item)">{{ item.lifecycle }}</span>
          </td>
          <td>{{ item.renewalStatus }}</td>
          <td>{{ item.fee ? `¥${item.fee.toLocaleString()}` : '—' }}</td>
          <td>{{ item.target || '—' }}</td>
          <td>{{ item.result || '待考核' }}</td>
          <td>{{ item.contact || '—' }}</td>
          <td :class="{ 'error-text': item.gap }">
            {{ item.personnel }}
            <span v-if="item.gap" class="badge danger">持证在岗缺口</span>
          </td>
          <td class="row-actions">
            <template v-if="!item.archived">
              <button v-if="item.row.status === '待签署'" class="link" type="button" @click="run(signContract, item.row.id)">
                确认签署
              </button>
              <button
                v-if="canRenew(item)"
                class="link"
                type="button"
                @click="run(submitRenewal, item.row.id)"
              >
                发起续签
              </button>
              <button v-if="canDecline(item)" class="link danger-text" type="button" @click="run(declineRenewal, item.row.id)">
                放弃续签
              </button>
              <button class="link danger-text" type="button" @click="run(terminateContract, item.row.id)">
                终止合同
              </button>
            </template>
            <span v-else class="muted-text">已留档</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无符合条件的运维合同</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 份合同 · 到期提醒窗口为到期前 {{ remindDays }} 天，唯一判定依据为合同期限最后一天</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  contractStats,
  declineRenewal,
  exportContractCsv,
  listContractViews,
  renewRemindDays,
  signContract,
  submitRenewal,
  terminateContract,
  type ContractView,
} from '@/api/contract-service'
import { LIFECYCLE, RENEWAL } from '@/domain/contract-lifecycle'
import type { ActionResult } from '@/data/types'

const columns = [
  '合同编号',
  '服务范围',
  '合同期限',
  '到期日',
  '统一到期结论',
  '续签状态',
  '年度费用',
  '考核指标',
  '考核结果',
  '对接人员',
  '持证在岗核对',
]
const remindDays = renewRemindDays()

const rows = ref<ContractView[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const statCards = computed(() => {
  const stats = contractStats()
  return [
    { label: '履行中合同', value: stats.active },
    { label: '待续签合同', value: stats.expiring },
    { label: '续签审核中', value: stats.reviewing },
    { label: '持证在岗缺口', value: stats.gap },
    { label: '本年合同金额', value: `${(stats.amountThisYear / 10000).toFixed(1)} 万` },
  ]
})

const lifecycleSummary = computed(() =>
  [LIFECYCLE.ACTIVE, LIFECYCLE.EXPIRING, LIFECYCLE.UNSIGNED, LIFECYCLE.TERMINATED].map((status) => ({
    status,
    count: rows.value.filter((item) => item.lifecycle.startsWith(status) || (status === LIFECYCLE.TERMINATED && item.archived)).length,
  })),
)

function canRenew(item: ContractView): boolean {
  return (
    !item.archived &&
    item.renewalStatus !== RENEWAL.REVIEWING &&
    item.lifecycle !== LIFECYCLE.UNSIGNED &&
    !(item.renewalStatus === RENEWAL.RENEWED && !item.remind)
  )
}

function canDecline(item: ContractView): boolean {
  return (
    !item.archived &&
    item.lifecycle !== LIFECYCLE.UNSIGNED &&
    item.renewalStatus !== RENEWAL.DECLINED &&
    item.renewalStatus !== RENEWAL.REVIEWING
  )
}

function lifecycleClass(item: ContractView): string {
  if (item.archived || item.lifecycle.startsWith(LIFECYCLE.TERMINATED)) {
    return 'muted'
  }
  if (item.lifecycle.startsWith(LIFECYCLE.EXPIRING)) {
    return 'danger'
  }
  if (item.lifecycle.includes('天后到期')) {
    return 'warn'
  }
  if (item.lifecycle === LIFECYCLE.UNSIGNED) {
    return 'muted'
  }
  return 'ok'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const { filename, content } = exportContractCsv()
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

function run(action: (id: number) => ActionResult, id: number) {
  errorMessage.value = ''
  const result = action(id)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  rows.value = listContractViews(filters.value)
}

onMounted(reload)
</script>
