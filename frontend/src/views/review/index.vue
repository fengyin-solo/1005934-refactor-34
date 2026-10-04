<template>
  <section class="page" data-module="review">
    <header class="page-head">
      <div>
        <h2>待审清单</h2>
        <p class="page-desc">
          续签申请与对接人员提交的履约考核结果统一在此审核。续签通过自动顺延合同期限并刷新统一结论；
          履约结果通过后写回合同考核页。同一合同的同类事项在途时不允许重复提交。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/renewal">到期续签提醒</RouterLink>
        <RouterLink class="btn" to="/contract">返回合同页</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待审事项</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">续签申请待审</span>
        <strong class="stat-value">{{ renewalPending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">履约考核待审</span>
        <strong class="stat-value">{{ performancePending }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="applyFilter">
      <label class="filter-item">
        <span>事项类型</span>
        <select v-model="kindFilter">
          <option value="">全部</option>
          <option value="续签申请">续签申请</option>
          <option value="履约考核">履约考核</option>
        </select>
      </label>
      <label class="filter-item">
        <span>处理状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option value="待审核">待审核</option>
          <option value="已通过">已通过</option>
          <option value="已驳回">已驳回</option>
        </select>
      </label>
      <label class="filter-item">
        <span>合同编号</span>
        <input v-model="keyword" placeholder="按合同编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilter">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>事项编号</th>
          <th>合同编号</th>
          <th>事项类型</th>
          <th>提交人</th>
          <th>提交日期</th>
          <th>履约结果</th>
          <th>说明</th>
          <th>对应合同统一结论</th>
          <th>状态</th>
          <th>处理</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filtered" :key="String(item.row.id)">
          <td>{{ item.code }}</td>
          <td>{{ item.contractCode }}</td>
          <td>
            <span class="badge" :class="item.kind === '续签申请' ? 'info' : 'warn'">{{ item.kind }}</span>
          </td>
          <td>{{ item.submitter }}</td>
          <td>{{ item.submittedAt }}</td>
          <td>{{ item.result || '—' }}</td>
          <td>{{ item.note }}</td>
          <td>{{ contractLifecycle(item.contractCode) }}</td>
          <td>
            <span class="badge" :class="statusClass(item.status)">{{ item.status }}</span>
          </td>
          <td class="row-actions">
            <template v-if="item.pending">
              <button class="link" type="button" @click="audit(item.id, true)">审核通过</button>
              <button class="link danger-text" type="button" @click="audit(item.id, false)">审核驳回</button>
            </template>
            <span v-else class="muted-text">已处理</span>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="10" class="empty-state">暂无符合条件的待审事项</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      <span>共 {{ rows.length }} 条事项</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  listContractViews,
  listReviews,
  reviewTaskAction,
  type ReviewView,
} from '@/api/contract-service'

const rows = ref<ReviewView[]>([])
const filtered = ref<ReviewView[]>([])
const kindFilter = ref('')
const statusFilter = ref('')
const keyword = ref('')
const message = ref('')
const messageOk = ref(false)

const pendingCount = computed(() => rows.value.filter((item) => item.pending).length)
const renewalPending = computed(() => rows.value.filter((item) => item.pending && item.kind === '续签申请').length)
const performancePending = computed(() => rows.value.filter((item) => item.pending && item.kind === '履约考核').length)

function contractLifecycle(code: string): string {
  const found = listContractViews({}).find((item) => item.code === code)
  return found ? `${found.lifecycle}｜${found.renewalStatus}` : '合同已不存在'
}

function statusClass(status: string): string {
  if (status === '已通过') {
    return 'ok'
  }
  if (status === '已驳回') {
    return 'danger'
  }
  return 'warn'
}

function applyFilter() {
  filtered.value = rows.value.filter((item) => {
    if (kindFilter.value && item.kind !== kindFilter.value) {
      return false
    }
    if (statusFilter.value && item.status !== statusFilter.value) {
      return false
    }
    if (keyword.value.trim() && !item.contractCode.includes(keyword.value.trim())) {
      return false
    }
    return true
  })
}

function resetFilter() {
  kindFilter.value = ''
  statusFilter.value = ''
  keyword.value = ''
  applyFilter()
}

function audit(id: number, pass: boolean) {
  const result = reviewTaskAction(id, pass)
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

function reload() {
  rows.value = listReviews({})
  applyFilter()
}

onMounted(reload)
</script>
