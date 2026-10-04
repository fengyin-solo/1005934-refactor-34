<template>
  <section class="page" data-module="crew">
    <header class="page-head">
      <div>
        <h2>运维人员管理</h2>
        <p class="page-desc">维护运维人员，围绕人员编号、姓名、岗位工种、持证类别做登记、筛选与状态流转；持证是否有效按证书有效期推导，并按电站反向核对合同结论。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记运维人员</button>
        <button class="btn" type="button" @click="exportRows">导出运维人员清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在岗人数</span>
        <strong class="stat-value">{{ onPostCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">持证在岗（证书有效）</span>
        <strong class="stat-value">{{ readyCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">证书即将到期（{{ certWarnDays }} 天内）</span>
        <strong class="stat-value" :class="{ 'error-text': certWarnCount > 0 }">{{ certWarnCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">证书已过期 / 待复证</span>
        <strong class="stat-value" :class="{ 'error-text': certExpiredCount > 0 }">{{ certExpiredCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>姓名</span>
        <input v-model="filters['姓名']" placeholder="按姓名检索" />
      </label>
      <label class="filter-item">
        <span>所在电站</span>
        <input v-model="filters['所在电站']" placeholder="按所在电站检索" />
      </label>
      <label class="filter-item">
        <span>岗位工种</span>
        <input v-model="filters['岗位工种']" placeholder="按岗位工种检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>持证结论</th>
          <th>当前状态</th>
          <th>对应合同结论</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="badge" :class="certClass(row)">{{ certStateOf(row) }}</span>
          </td>
          <td>{{ row.status }}</td>
          <td>{{ linkedContracts(row) }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              :class="{ 'danger-text': action === '办理离岗' }"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无运维人员数据，可先登记运维人员</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条运维人员记录 · 持证在岗以「在岗 + 证书有效」为准，用于核对合同页的持证在岗结论</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listContractViews } from '@/api/contract-service'
import { CERT_WARN_DAYS, crewCertState, matchStation } from '@/domain/contract-lifecycle'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('crew')
const columns = ["人员编号", "姓名", "岗位工种", "持证类别", "证书有效期", "所在电站", "进场日期", "带班能力"]
const actions = ["办理进场", "提交复证", "办理离岗"]
const statuses = ["在岗", "培训中", "待复证", "已离岗"]
const certWarnDays = CERT_WARN_DAYS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const onPostCount = computed(() => rows.value.filter((row) => String(row.status) === '在岗').length)
const readyCount = computed(
  () => rows.value.filter((row) => String(row.status) === '在岗' && crewCertState(row) === '有效').length,
)
const certWarnCount = computed(() => rows.value.filter((row) => crewCertState(row) === '即将到期').length)
const certExpiredCount = computed(
  () =>
    rows.value.filter((row) => crewCertState(row) === '已过期' || String(row.status) === '待复证').length,
)

function certStateOf(row: EntryRow): string {
  return crewCertState(row)
}

function certClass(row: EntryRow): string {
  const state = crewCertState(row)
  if (state === '有效') {
    return 'ok'
  }
  if (state === '即将到期') {
    return 'warn'
  }
  return 'danger'
}

/** 反向核对：该人员所在电站对应哪些仍在履行 / 待续签的合同，以及统一结论是什么。 */
function linkedContracts(row: EntryRow): string {
  const station = String(row['所在电站'] ?? '')
  const links = listContractViews({})
    .filter((item) => !item.archived && matchStation(item.scope, station))
    .map((item) => `${item.code} ${item.lifecycle}`)
  return links.length ? links.join('；') : '无在履行合同'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '运维人员登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '运维人员列表读取失败'
  }
}

onMounted(reload)
</script>
