import {
  assessContract,
  canSubmitRenewal,
  checkCrewAgainstContracts,
  formatPeriod,
  isRenewalDue,
  parseContractPeriod,
  toDateString,
  unmatchedContractCrews,
  type ContractVerdict,
  type CrewCheck,
} from '@/domain/contract-lifecycle'
import { listRows, saveRows } from '@/data/local-store'
import {
  addReview,
  findOpenReview,
  listReviews,
  updateReview,
} from '@/data/review-store'
import type {
  ActionResult,
  AssessmentResult,
  EntryRow,
  ReviewItem,
} from '@/data/types'

// 合同页 / 到期提醒 / 考核页的唯一取数入口：结论一律来自 domain/contract-lifecycle，
// 页面拿到的「合同结论」字段是同一份，不再有三处各算各的情况。

export type ContractView = {
  row: EntryRow
  verdict: ContractVerdict
  合同期限: string
  openRenewal: ReviewItem | undefined
  renewalDuplicate: boolean
  assessmentDuplicate: boolean
  problems: string[] // 持证 / 在岗对账结论
}

function buildView(
  row: EntryRow,
  reviews: ReviewItem[],
  contractProblems: Map<number, string[]>,
): ContractView {
  const verdict = assessContract(row, reviews)
  const { start, end } = parseContractPeriod(row)
  const openRenewal = reviews.find(
    (item) => item.contractId === Number(row.id) && item.kind === '续签申请' && item.status === '待审核',
  )
  const assessmentDuplicate = Boolean(
    reviews.find(
      (item) => item.contractId === Number(row.id) && item.kind === '履约考核' && item.status === '待审核',
    ),
  )
  return {
    row,
    verdict,
    合同期限: formatPeriod(start, end),
    openRenewal,
    renewalDuplicate: Boolean(openRenewal),
    assessmentDuplicate,
    problems: contractProblems.get(Number(row.id)) ?? [],
  }
}

export function listContractViews(): ContractView[] {
  const reviews = listReviews()
  const contracts = listRows('contract')
  const crew = listRows('crew')
  const contractProblems = unmatchedContractCrews(contracts, crew, reviews)
  return contracts.map((row) => buildView(row, reviews, contractProblems))
}

export function listReminders(): ContractView[] {
  return listContractViews()
    .filter((view) => isRenewalDue(view.verdict))
    .sort((a, b) => (a.verdict.daysToEnd ?? 0) - (b.verdict.daysToEnd ?? 0))
}

export function listAssessmentViews(): ContractView[] {
  // 考核页直接展示共用结论；指标是否达标只影响「考核结果」，到期结论不从这里另判。
  return listContractViews().sort((a, b) => Number(a.row.id) - Number(b.row.id))
}

export function listCrewChecks(): CrewCheck[] {
  const reviews = listReviews()
  return listRows('crew').map((crew) =>
    checkCrewAgainstContracts(crew, listRows('contract'), reviews),
  )
}

function persist(row: EntryRow, patch: Record<string, string | number | boolean>): void {
  const rows = listRows('contract')
  const index = rows.findIndex((item) => Number(item.id) === Number(row.id))
  if (index < 0) {
    return
  }
  rows[index] = { ...rows[index], ...patch }
  saveRows('contract', rows)
}

// ── 合同动作 ────────────────────────────────────────────────────────────────

export function signContract(id: number): ActionResult {
  const rows = listRows('contract')
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: '没有找到这份合同' }
  }
  if (String(row.status) !== '待签署') {
    return { ok: false, message: `合同当前为「${row.status}」，无需再签署` }
  }
  persist(row, { status: '履行中', pending: false })
  return { ok: true, message: `合同 ${row['合同编号']} 已签署，进入履行` }
}

export function terminateContract(id: number): ActionResult {
  const rows = listRows('contract')
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: '没有找到这份合同' }
  }
  if (String(row.status) === '已终止') {
    return { ok: false, message: '合同已终止并留档，不能重复终止' }
  }
  // 终止即冻结：此后到期判定一律沿用本结论。
  persist(row, { status: '已终止', pending: false, abnormal: true })
  return { ok: true, message: `合同 ${row['合同编号']} 已终止，按终止时结论留档` }
}

/**
 * 提交续签申请。重复提交（已有待审核的续签申请）只算一次：直接返回原申请，不再产生新待办。
 */
export function submitRenewal(id: number, operator: string): ActionResult {
  const rows = listRows('contract')
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: '没有找到这份合同' }
  }
  const verdict = assessContract(row, listReviews())
  const existing = findOpenReview(id, '续签申请')
  if (existing) {
    return { ok: false, message: `续签申请已提交（待审核单号 R-${existing.id}），无需重复提交` }
  }
  if (!canSubmitRenewal(verdict)) {
    return {
      ok: false,
      message: verdict.frozen
        ? '合同已终止留档，不能再续签'
        : verdict.lifeStatus === '待签署'
          ? '合同尚未签署，不能发起续签'
          : verdict.renewalState === '已续签'
            ? '本周期已续签完成'
            : `尚未进入续签窗口（到期前 30 天才可发起，当前剩余 ${verdict.daysToEnd ?? '—'} 天）`,
    }
  }
  const review = addReview({
    kind: '续签申请',
    contractId: id,
    合同编号: String(row['合同编号'] ?? ''),
    提交人: operator || String(row['对接人员'] ?? ''),
    申请期限止: proposedRenewalEnd(verdict.end),
  })
  persist(row, { '续签状态': '审核中', pending: true })
  return { ok: true, message: `续签申请已提交（待审核单号 R-${review.id}），审核通过后续签一年` }
}

function proposedRenewalEnd(end: string | null): string {
  // 默认续签一年：以当前期限止顺延；期限缺失时从今天起算。
  const base = new Date(end ?? toDateString(new Date()))
  if (Number.isNaN(base.getTime())) {
    return toDateString(new Date())
  }
  base.setFullYear(base.getFullYear() + 1)
  return toDateString(base)
}

/**
 * 对接人员提交履约结果：考核结论直接落待审清单，不直接改合同。
 * 同一合同已有待审核履约结果时，重复提交不重复入列。
 */
export function submitAssessment(
  id: number,
  result: Exclude<AssessmentResult, '未考核'>,
  note: string,
  operator: string,
): ActionResult {
  const rows = listRows('contract')
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: '没有找到这份合同' }
  }
  if (String(row.status) === '已终止') {
    return { ok: false, message: '合同已终止留档，考核结果不再受理' }
  }
  if (String(row.status) === '待签署') {
    return { ok: false, message: '合同尚未签署，暂无履约结果可提交' }
  }
  const existing = findOpenReview(id, '履约考核')
  if (existing) {
    return { ok: false, message: `履约结果已提交（待审核单号 R-${existing.id}），请勿重复提交` }
  }
  const review = addReview({
    kind: '履约考核',
    contractId: id,
    合同编号: String(row['合同编号'] ?? ''),
    提交人: operator || String(row['对接人员'] ?? ''),
    考核结果: result,
    考核说明: note,
  })
  return { ok: true, message: `履约考核（${result}）已进入待审清单，单号 R-${review.id}` }
}

// ── 待审清单 ────────────────────────────────────────────────────────────────

export function listPendingReviews(): ReviewItem[] {
  return listReviews('待审核')
}

export function approveReview(reviewId: number, note: string): ActionResult {
  const review = listReviews().find((item) => item.id === reviewId)
  if (!review) {
    return { ok: false, message: '没有找到这条待审记录' }
  }
  if (review.status !== '待审核') {
    return { ok: false, message: `该申请已是「${review.status}」，不能再审` }
  }
  const rows = listRows('contract')
  const row = rows.find((item) => Number(item.id) === review.contractId)
  if (review.kind === '续签申请') {
    if (!row) {
      return { ok: false, message: '关联合同已不存在' }
    }
    if (String(row.status) === '已终止') {
      updateReview(reviewId, {
        status: '已驳回',
        reviewedAt: new Date().toISOString(),
        审核备注: '合同已终止留档',
      })
      return { ok: false, message: '合同已终止留档，续签申请驳回' }
    }
    // 续签通过：期限止顺延到申请的新期限，续签状态写「已续签」——统一结论由共用判定重算。
    const newEnd = review.申请期限止 ?? proposedRenewalEnd(parseContractPeriod(row).end)
    const count = Number(row['续签次数'] ?? 0) + 1
    persist(row, {
      合同期限止: newEnd,
      '续签状态': '已续签',
      '续签次数': count,
      pending: false,
    })
  } else if (row) {
    // 履约考核通过审核：结论落到合同上，后续到期/考核共用这一份结果。
    persist(row, {
      考核结果: review.考核结果 ?? '未考核',
    })
  }
  updateReview(reviewId, {
    status: '已通过',
    reviewedAt: new Date().toISOString(),
    审核备注: note,
  })
  return { ok: true, message: `单号 R-${reviewId} 已通过` }
}

export function rejectReview(reviewId: number, note: string): ActionResult {
  const review = listReviews().find((item) => item.id === reviewId)
  if (!review) {
    return { ok: false, message: '没有找到这条待审记录' }
  }
  if (review.status !== '待审核') {
    return { ok: false, message: `该申请已是「${review.status}」，不能再审` }
  }
  if (review.kind === '续签申请') {
    const row = listRows('contract').find((item) => Number(item.id) === review.contractId)
    if (row && String(row.status) !== '已终止') {
      // 驳回续签：申请作废后回到由合同期限推导的窗口态（仍在窗口内即「待续签」，可重新发起）。
      const remaining = listReviews().filter(
        (item) => item.id !== reviewId && item.contractId === review.contractId,
      )
      const verdict = assessContract({ ...row, '续签状态': '未到续签窗口' }, remaining)
      persist(row, {
        '续签状态': verdict.renewalState === '已续签' ? '已续签' : verdict.renewalState,
        pending: verdict.lifeStatus === '待续签' || verdict.lifeStatus === '已过期',
      })
    }
  }
  updateReview(reviewId, {
    status: '已驳回',
    reviewedAt: new Date().toISOString(),
    审核备注: note,
  })
  return { ok: true, message: `单号 R-${reviewId} 已驳回` }
}

// ── 合同导出（沿用统一结论）──────────────────────────────────────────────────

export function exportContractViews(): { filename: string; content: string } {
  const header = [
    '编号', '合同编号', '服务范围', '合同期限', '合同期限止', '年度费用',
    '考核指标', '考核结果', '对接人员', '到期结论', '续签状态', '续签次数', '持证在岗对账',
  ]
  const lines = [header.join(',')]
  for (const view of listContractViews()) {
    const row = view.row
    lines.push(
      [
        row.id,
        row['合同编号'] ?? '',
        row['服务范围'] ?? '',
        view.合同期限,
        view.verdict.end ?? '',
        row['年度费用'] ?? '',
        row['考核指标'] ?? '',
        view.verdict.assessment,
        row['对接人员'] ?? '',
        view.verdict.lifeStatus,
        view.verdict.renewalState,
        row['续签次数'] ?? 0,
        view.problems.join('；') || '正常',
      ].join(','),
    )
  }
  return { filename: '运维合同-到期续签清单.csv', content: `﻿${lines.join('\n')}` }
}
