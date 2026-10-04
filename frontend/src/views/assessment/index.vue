<template>
  <section class="page" data-module="assessment">
    <header class="page-head">
      <div>
        <h2>合同考核</h2>
        <p class="page-desc">指标是否达标只写「考核结果」，不再单独判定到期；到期结论直接引用合同页的同一份取数。对接人员提交的履约结果落待审清单，审核通过才回写合同。</p>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">考核合格</span>
        <strong class="stat-value" style="color:#1a7f37">{{ passCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">考核不合格</span>
        <strong class="stat-value" style="color:#b42318">{{ failCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">尚未考核</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">履约结果待审</span>
        <strong class="stat-value" style="color:#1f6feb">{{ reviewingCount }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>合同编号</th>
          <th>考核指标</th>
          <th>对接人员</th>
          <th>当前考核结果</th>
          <th>到期结论（引用）</th>
          <th>续签状态（引用）</th>
          <th>提交履约结果</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in views" :key="String(view.row.id)">
          <td>{{ view.row['合同编号'] }}</td>
          <td>{{ view.row['考核指标'] ?? '—' }}</td>
          <td>{{ view.row['对接人员'] ?? '—' }}</td>
          <td>
            <span class="badge" :class="assessmentClass(view.verdict.assessment)">{{ view.verdict.assessment }}</span>
          </td>
          <td>
            <span class="badge" :class="lifeClass(view.verdict.lifeStatus)">{{ view.verdict.lifeStatus }}</span>
            <span v-if="view.verdict.frozen" class="subtle">（留档）</span>
          </td>
          <td><span class="badge" :class="renewalClass(view.verdict.renewalState)">{{ view.verdict.renewalState }}</span></td>
          <td>
            <form v-if="canAssess(view)" class="inline-form" @submit.prevent="submit(view)">
              <select v-model="drafts[Number(view.row.id)].result">
                <option value="合格">合格</option>
                <option value="不合格">不合格</option>
              </select>
              <input
                v-model="drafts[Number(view.row.id)].note"
                placeholder="履约说明（可选）"
                style="width: 180px"
              />
              <button class="btn primary" type="submit">提交</button>
            </form>
            <span v-else-if="view.assessmentDuplicate" class="subtle">履约结果已在待审清单，勿重复提交</span>
            <span v-else-if="view.verdict.lifeStatus === '已终止'" class="subtle">合同已终止，不再考核</span>
            <span v-else-if="view.verdict.lifeStatus === '待签署'" class="subtle">合同未签署，暂不考核</span>
          </td>
        </tr>
        <tr v-if="!views.length">
          <td colspan="7" class="empty-state">暂无可考核的合同</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>考核结果不改变到期判定；同一合同已有待审核履约结果时，重复提交不重复入列。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { listAssessmentViews, submitAssessment, type ContractView } from '@/api/contract-service'
import type {
  AssessmentResult,
  ContractLifeStatus,
  RenewalState,
} from '@/domain/contract-lifecycle'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const views = ref<ContractView[]>([])
const errorMessage = ref('')
const drafts = reactive<Record<number, { result: '合格' | '不合格'; note: string }>>({})

function draftFor(id: number) {
  if (!drafts[id]) {
    drafts[id] = { result: '合格', note: '' }
  }
  return drafts[id]
}

const passCount = computed(() => views.value.filter((v) => v.verdict.assessment === '合格').length)
const failCount = computed(() => views.value.filter((v) => v.verdict.assessment === '不合格').length)
const pendingCount = computed(() => views.value.filter((v) => v.verdict.assessment === '未考核').length)
const reviewingCount = computed(() => views.value.filter((v) => v.assessmentDuplicate).length)

function canAssess(view: ContractView): boolean {
  return (
    view.verdict.lifeStatus !== '已终止' &&
    view.verdict.lifeStatus !== '待签署' &&
    !view.assessmentDuplicate
  )
}

function assessmentClass(result: AssessmentResult): string {
  if (result === '合格') return 'pass'
  if (result === '不合格') return 'fail'
  return 'neutral'
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

function submit(view: ContractView) {
  errorMessage.value = ''
  const draft = draftFor(Number(view.row.id))
  const result = submitAssessment(Number(view.row.id), draft.result, draft.note.trim(), store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  draft.note = ''
  reload()
}

function reload() {
  errorMessage.value = ''
  views.value = listAssessmentViews()
}

onMounted(reload)
</script>
