<template>
  <section class="page" data-module="review">
    <header class="page-head">
      <div>
        <h2>待审清单</h2>
        <p class="page-desc">续签申请与对接人员提交的履约考核结果统一在此审批；通过后续签一年并回写合同，驳回后回到续签窗口可重新发起。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待审核</span>
        <strong class="stat-value">{{ pending.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">其中续签申请</span>
        <strong class="stat-value">{{ pendingRenewal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">其中履约考核</span>
        <strong class="stat-value">{{ pendingAssessment }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已闭环（全部）</span>
        <strong class="stat-value">{{ closed.length }}</strong>
      </article>
    </div>

    <h3 style="font-size:14px">待审核</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>单号</th>
          <th>类型</th>
          <th>合同编号</th>
          <th>提交人</th>
          <th>提交时间</th>
          <th>申请/结论</th>
          <th>审核</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in pending" :key="item.id">
          <td>R-{{ item.id }}</td>
          <td><span class="badge reviewing">{{ item.kind }}</span></td>
          <td>{{ item.合同编号 }}</td>
          <td>{{ item.提交人 }}</td>
          <td>{{ formatTime(item.submittedAt) }}</td>
          <td>
            <template v-if="item.kind === '续签申请'">
              申请续签至 <strong>{{ item.申请期限止 }}</strong>
            </template>
            <template v-else>
              履约考核：<span class="badge" :class="item.考核结果 === '合格' ? 'pass' : 'fail'">{{ item.考核结果 }}</span>
              <span v-if="item.考核说明" class="subtle">（{{ item.考核说明 }}）</span>
            </template>
          </td>
          <td>
            <div class="inline-form">
              <input v-model="notes[item.id]" placeholder="审核备注（可选）" style="width: 180px" />
              <button class="btn primary" type="button" @click="decide(item.id, true)">通过</button>
              <button class="btn" type="button" @click="decide(item.id, false)">驳回</button>
            </div>
          </td>
        </tr>
        <tr v-if="!pending.length">
          <td colspan="7" class="empty-state">待审清单已清空</td>
        </tr>
      </tbody>
    </table>

    <h3 style="font-size:14px;margin-top:18px">历史记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>单号</th>
          <th>类型</th>
          <th>合同编号</th>
          <th>提交人</th>
          <th>结果</th>
          <th>审核时间</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in closed" :key="item.id">
          <td>R-{{ item.id }}</td>
          <td>{{ item.kind }}</td>
          <td>{{ item.合同编号 }}</td>
          <td>{{ item.提交人 }}</td>
          <td><span class="badge" :class="item.status === '已通过' ? 'pass' : 'fail'">{{ item.status }}</span></td>
          <td>{{ item.reviewedAt ? formatTime(item.reviewedAt) : '—' }}</td>
          <td>{{ item.审核备注 ?? '—' }}</td>
        </tr>
        <tr v-if="!closed.length">
          <td colspan="7" class="empty-state">暂无历史记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { approveReview, listPendingReviews, rejectReview } from '@/api/contract-service'
import { listReviews } from '@/data/review-store'
import type { ReviewItem } from '@/data/types'

const pending = ref<ReviewItem[]>([])
const closed = ref<ReviewItem[]>([])
const notes = reactive<Record<number, string>>({})
const errorMessage = ref('')

const pendingRenewal = computed(() => pending.value.filter((item) => item.kind === '续签申请').length)
const pendingAssessment = computed(() => pending.value.filter((item) => item.kind === '履约考核').length)

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function decide(id: number, approve: boolean) {
  errorMessage.value = ''
  const result = approve
    ? approveReview(id, notes[id]?.trim() ?? '')
    : rejectReview(id, notes[id]?.trim() ?? '')
  if (!result.ok) {
    errorMessage.value = result.message
  }
  delete notes[id]
  reload()
}

function reload() {
  pending.value = listPendingReviews()
  closed.value = listReviews().filter((item) => item.status !== '待审核')
}

onMounted(reload)
</script>
