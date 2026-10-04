<template>
  <section class="page" data-module="renewal-reminder">
    <header class="page-head">
      <div>
        <h2>到期续签提醒</h2>
        <p class="page-desc">
          提醒名单直接取自统一到期结论：以合同期限最后一天为唯一依据，到期前 {{ remindDays }} 天进入提醒窗口；
          不再读取对接人员手工填的续签状态。续签提交以「提交进待审」为准，重复提交只算一次。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/contract-review">去考核页提交履约结果</RouterLink>
        <RouterLink class="btn" to="/review">看待审清单</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">窗口内（{{ remindDays }} 天内到期）</span>
        <strong class="stat-value">{{ windowCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已超期未续签</span>
        <strong class="stat-value danger-text">{{ overdueCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">续签审核中</span>
        <strong class="stat-value">{{ reviewingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">持证在岗缺口</span>
        <strong class="stat-value" :class="{ 'error-text': gapCount > 0 }">{{ gapCount }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="applyFilter">
      <label class="filter-item">
        <span>范围筛选</span>
        <select v-model="scopeFilter">
          <option value="all">全部提醒</option>
          <option value="window">窗口内</option>
          <option value="overdue">已超期</option>
          <option value="reviewing">审核中</option>
        </select>
      </label>
      <label class="filter-item">
        <span>合同编号 / 服务范围</span>
        <input v-model="keyword" placeholder="按合同编号或服务范围检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilter">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>合同编号</th>
          <th>服务范围</th>
          <th>到期日</th>
          <th>剩余/超期</th>
          <th>统一到期结论</th>
          <th>续签状态</th>
          <th>对接人员</th>
          <th>持证在岗核对</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filtered" :key="String(item.row.id)">
          <td>{{ item.code }}</td>
          <td>{{ item.scope }}</td>
          <td>{{ item.termEnd }}</td>
          <td>
            <span :class="item.daysRemaining !== null && item.daysRemaining < 0 ? 'error-text' : ''">
              {{ daysText(item) }}
            </span>
          </td>
          <td><span class="badge" :class="badgeClass(item)">{{ item.lifecycle }}</span></td>
          <td>{{ item.renewalStatus }}</td>
          <td>{{ item.contact }}</td>
          <td :class="{ 'error-text': item.gap }">
            {{ item.personnel }}
            <span v-if="item.gap" class="badge danger">缺口</span>
          </td>
          <td>
            <button
              v-if="item.renewalStatus === '审核中'"
              class="btn"
              type="button"
              disabled
            >
              已提交待审
            </button>
            <button
              v-else
              class="btn primary"
              type="button"
              @click="submit(item.row.id)"
            >
              提交续签申请
            </button>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="9" class="empty-state">当前没有需要提醒续签的合同</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      <span>提醒与合同页、考核页同源；续签进入审核后请勿重复提交</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  listContractViews,
  renewRemindDays,
  submitRenewal,
  type ContractView,
} from '@/api/contract-service'

const remindDays = renewRemindDays()
const all = ref<ContractView[]>([])
const scopeFilter = ref('all')
const keyword = ref('')
const filtered = ref<ContractView[]>([])
const message = ref('')
const messageOk = ref(false)

const remindList = computed(() => all.value.filter((item) => item.remind || item.renewalStatus === '审核中'))
const windowCount = computed(() => remindList.value.filter((item) => item.daysRemaining !== null && item.daysRemaining >= 0).length)
const overdueCount = computed(() => remindList.value.filter((item) => item.daysRemaining !== null && item.daysRemaining < 0 && item.renewalStatus !== '审核中').length)
const reviewingCount = computed(() => all.value.filter((item) => item.renewalStatus === '审核中').length)
const gapCount = computed(() => remindList.value.filter((item) => item.gap).length)

function matches(item: ContractView): boolean {
  const kw = keyword.value.trim()
  if (kw && !item.code.includes(kw) && !item.scope.includes(kw)) {
    return false
  }
  switch (scopeFilter.value) {
    case 'window':
      return item.daysRemaining !== null && item.daysRemaining >= 0
    case 'overdue':
      return item.daysRemaining !== null && item.daysRemaining < 0 && item.renewalStatus !== '审核中'
    case 'reviewing':
      return item.renewalStatus === '审核中'
    default:
      return true
  }
}

function applyFilter() {
  filtered.value = remindList.value.filter(matches)
}

function resetFilter() {
  scopeFilter.value = 'all'
  keyword.value = ''
  applyFilter()
}

function daysText(item: ContractView): string {
  if (item.daysRemaining === null) {
    return '期限无法解析'
  }
  return item.daysRemaining < 0
    ? `已超期 ${Math.abs(item.daysRemaining)} 天`
    : `剩 ${item.daysRemaining} 天`
}

function badgeClass(item: ContractView): string {
  if (item.daysRemaining !== null && item.daysRemaining < 0) {
    return 'danger'
  }
  return item.renewalStatus === '审核中' ? 'info' : 'warn'
}

function submit(id: number) {
  const result = submitRenewal(id)
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

function reload() {
  all.value = listContractViews({})
  applyFilter()
}

onMounted(reload)
</script>
