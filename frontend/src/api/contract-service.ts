/**
 * 运维合同领域服务：合同页、到期提醒、合同考核、待审清单唯一的读写入口。
 *
 * 到期 / 续签的判定规则在 domain/contract-lifecycle.ts 里只有一份；
 * 本文件负责把统一结论接到本地数据上，并约束状态只能由流程写入：
 * - 续签申请同一份合同同时只算一次（有待审 / 已通过未走完期限的即拦截）；
 * - 履约考核结果提交即落待审清单，同一合同只保留一份待审履约事项；
 * - 续签审核通过自动顺延合同期限，驳回退回续签窗口；
 * - 终止合同按「主动终止」留档，到期不续签由统一推导自然收口。
 */
import {
  LIFECYCLE,
  RENEWAL,
  RENEW_REMIND_DAYS,
  conclusionLabel,
  deriveContract,
  extendTerm,
  personnelMatch,
  todayIso,
} from '@/domain/contract-lifecycle'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { filterRows } from './local-service'

export const CONTRACT_KEY = 'contract'
export const REVIEW_KEY = 'review'

export const REVIEW_TYPE = {
  RENEWAL: '续签申请',
  PERFORMANCE: '履约考核',
} as const

export interface ContractView {
  row: EntryRow
  code: string
  scope: string
  term: string
  fee: number
  target: string
  result: string
  contact: string
  termEnd: string
  /** 统一到期结论（合同页 / 提醒 / 考核三处完全一致）。 */
  lifecycle: string
  renewalStatus: string
  daysRemaining: number | null
  remind: boolean
  archived: boolean
  archiveConclusion: string
  personnel: string
  gap: boolean
  abnormal: boolean
}

function buildViews(rows: EntryRow[]): ContractView[] {
  const today = todayIso()
  const crewRows = listRows('crew')
  return rows.map((row) => {
    const conclusion = deriveContract(row, today)
    const match = personnelMatch(row, conclusion, crewRows, today)
    return {
      row,
      code: String(row['合同编号'] ?? ''),
      scope: String(row['服务范围'] ?? ''),
      term: String(row['合同期限'] ?? ''),
      fee: Number(row['年度费用'] ?? 0),
      target: String(row['考核指标'] ?? ''),
      result: String(row['考核结果'] ?? ''),
      contact: String(row['对接人员'] ?? ''),
      termEnd: conclusion.termEnd ?? '—',
      lifecycle: conclusionLabel(conclusion),
      renewalStatus: conclusion.renewalStatus,
      daysRemaining: conclusion.daysRemaining,
      remind: conclusion.remind,
      archived: conclusion.archived,
      archiveConclusion: conclusion.archiveConclusion,
      personnel: match.label,
      gap: match.gap,
      abnormal: conclusion.lifecycle === LIFECYCLE.EXPIRING || match.gap,
    }
  })
}

export function listContractViews(filters: Record<string, string> = {}): ContractView[] {
  const rows = filterRows(listRows(CONTRACT_KEY), filters)
  return buildViews(rows)
}

export interface ContractStats {
  active: number
  expiring: number
  reviewing: number
  gap: number
  amountThisYear: number
}

export function contractStats(): ContractStats {
  const views = buildViews(listRows(CONTRACT_KEY))
  const today = todayIso()
  const yearPrefix = today.slice(0, 4)
  return {
    active: views.filter((v) => !v.archived && v.lifecycle.startsWith(LIFECYCLE.ACTIVE)).length,
    // 以统一结论为准：已超期（待续签）都算待续签，哪怕续签申请正在审核中。
    expiring: views.filter((v) => !v.archived && v.lifecycle.startsWith(LIFECYCLE.EXPIRING)).length,
    reviewing: views.filter((v) => v.renewalStatus === RENEWAL.REVIEWING).length,
    gap: views.filter((v) => v.gap).length,
    // 本年合同金额：期限覆盖今年的履行类合同年度费用合计（万元展示时页面自行换算）。
    amountThisYear: views
      .filter((v) => !v.archived && v.term.includes(yearPrefix) && v.lifecycle !== LIFECYCLE.UNSIGNED)
      .reduce((sum, v) => sum + v.fee, 0),
  }
}

// ---------- 待审清单 ----------

export interface ReviewView {
  row: EntryRow
  id: number
  code: string
  contractCode: string
  kind: string
  submitter: string
  submittedAt: string
  result: string
  note: string
  status: string
  pending: boolean
}

export function listReviews(filters: Record<string, string> = {}): ReviewView[] {
  return filterRows(listRows(REVIEW_KEY), filters)
    .slice()
    .sort((a, b) => {
      // 待审核优先，其次按提交日期倒序。
      const pa = a.status === '待审核' ? 0 : 1
      const pb = b.status === '待审核' ? 0 : 1
      if (pa !== pb) {
        return pa - pb
      }
      return String(b['提交日期'] ?? '').localeCompare(String(a['提交日期'] ?? ''))
    })
    .map((row) => ({
      row,
      id: Number(row.id),
      code: String(row['事项编号'] ?? ''),
      contractCode: String(row['合同编号'] ?? ''),
      kind: String(row['事项类型'] ?? ''),
      submitter: String(row['提交人'] ?? ''),
      submittedAt: String(row['提交日期'] ?? ''),
      result: String(row['履约结果'] ?? ''),
      note: String(row['说明'] ?? ''),
      status: String(row.status ?? ''),
      pending: row.status === '待审核',
    }))
}

function openReviewOf(contractCode: string, kind: string): EntryRow | undefined {
  return listRows(REVIEW_KEY).find(
    (item) =>
      String(item['合同编号']) === contractCode &&
      String(item['事项类型']) === kind &&
      item.status === '待审核',
  )
}

function nextReviewId(rows: EntryRow[]): number {
  return rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

function nextReviewCode(rows: EntryRow[]): string {
  const seq = rows.reduce((max, item) => {
    const m = /REV-\d{4}-(\d+)/.exec(String(item['事项编号'] ?? ''))
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return `REV-${todayIso().slice(0, 4)}-${String(seq + 1).padStart(3, '0')}`
}

interface NewReview {
  事项编号: string
  合同编号: string
  事项类型: string
  提交人: string
  提交日期: string
  履约结果: string
  说明: string
}

function appendReview(task: NewReview): void {
  const rows = listRows(REVIEW_KEY).slice()
  const entry: EntryRow = {
    id: nextReviewId(rows),
    status: '待审核',
    pending: true,
    abnormal: false,
    '事项编号': task['事项编号'] || nextReviewCode(rows),
    '合同编号': task['合同编号'],
    '事项类型': task['事项类型'],
    '提交人': task['提交人'],
    '提交日期': task['提交日期'],
    '履约结果': task['履约结果'],
    '说明': task['说明'],
  }
  rows.push(entry)
  saveRows(REVIEW_KEY, rows)
}

function findContract(
  id: number,
): ActionResult | { rows: EntryRow[]; index: number } {
  const rows = listRows(CONTRACT_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的运维合同` }
  }
  return { rows, index }
}

function updateContract(rows: EntryRow[], index: number, patch: Partial<EntryRow>): EntryRow[] {
  const next = rows.slice()
  const merged: EntryRow = Object.assign({}, next[index], patch)
  next[index] = merged
  saveRows(CONTRACT_KEY, next)
  return next
}

// ---------- 合同动作 ----------

export function signContract(id: number): ActionResult {
  const found = findContract(id)
  if ('ok' in found) {
    return found
  }
  const { rows, index } = found
  if (String(rows[index].status) !== LIFECYCLE.UNSIGNED) {
    return { ok: false, message: '只有待签署的合同才能确认签署' }
  }
  updateContract(rows, index, { status: LIFECYCLE.ACTIVE, pending: true, abnormal: false })
  return { ok: true, message: '合同已确认签署，进入履行中' }
}

/**
 * 发起续签：同一合同重复提交只算一次。
 * 有待审续签、或审核中的续签在途，一律幂等拦截；已通过的续签会顺延期限，
 * 在新期限内也不允许再次发起。
 */
export function submitRenewal(id: number): ActionResult {
  const found = findContract(id)
  if ('ok' in found) {
    return found
  }
  const { rows, index } = found
  const row = rows[index]
  const code = String(row['合同编号'] ?? '')
  const conclusion = deriveContract(row)

  if (conclusion.archived) {
    return { ok: false, message: '合同已终止留档，不能再发起续签' }
  }
  if (conclusion.unsigned) {
    return { ok: false, message: '合同尚未签署，不能发起续签' }
  }
  if (conclusion.renewalStatus === RENEWAL.RENEWED && !conclusion.expired && !conclusion.inWindow) {
    return { ok: false, message: '该合同已续签过，新期限仍在履行中，不用重复提交' }
  }
  if (conclusion.renewalStatus === RENEWAL.DECLINED && !conclusion.expired) {
    return { ok: false, message: '该合同已标记不续签，请先确认续签意向' }
  }
  if (openReviewOf(code, REVIEW_TYPE.RENEWAL)) {
    return { ok: false, message: '这份合同的续签申请已在待审清单里，重复提交只算一次' }
  }

  updateContract(rows, index, { '续签状态': RENEWAL.REVIEWING })
  appendReview({
    事项编号: '',
    合同编号: code,
    事项类型: REVIEW_TYPE.RENEWAL,
    提交人: String(row['对接人员'] ?? ''),
    提交日期: todayIso(),
    履约结果: '',
    说明: `合同 ${conclusion.termEnd ?? ''} 到期，申请续签一年`,
  })
  return { ok: true, message: '续签申请已提交，进入待审清单；重复提交不会重复受理' }
}

export function declineRenewal(id: number): ActionResult {
  const found = findContract(id)
  if ('ok' in found) {
    return found
  }
  const { rows, index } = found
  const row = rows[index]
  if (String(row.status) === LIFECYCLE.TERMINATED) {
    return { ok: false, message: '合同已终止留档' }
  }
  if (String(row.status) === LIFECYCLE.UNSIGNED) {
    return { ok: false, message: '待签署合同还谈不上续签' }
  }
  updateContract(rows, index, { '续签状态': RENEWAL.DECLINED })
  return { ok: true, message: '已标记为不续签；到期日后统一结论自动收口为到期不续签' }
}

export function terminateContract(id: number): ActionResult {
  const found = findContract(id)
  if ('ok' in found) {
    return found
  }
  const { rows, index } = found
  const row = rows[index]
  if (String(row.status) === LIFECYCLE.TERMINATED) {
    return { ok: false, message: '合同已经是已终止状态' }
  }
  updateContract(rows, index, {
    status: LIFECYCLE.TERMINATED,
    '续签状态': RENEWAL.DECLINED,
    '留档结论': '主动终止',
    pending: false,
    abnormal: false,
  })
  return { ok: true, message: '合同已终止，按当时结论留档，后续不再重新判定' }
}

/**
 * 对接人员提交履约（考核）结果：落待审清单，同一合同同时只保留一条待审履约事项。
 * 考核是否达标不影响到期判定，只影响续签审核时的参考。
 */
export function submitPerformance(id: number, result: string): ActionResult {
  const trimmed = result.trim()
  if (!trimmed) {
    return { ok: false, message: '请先填写履约考核结果（达标 / 不达标及说明）' }
  }
  const found = findContract(id)
  if ('ok' in found) {
    return found
  }
  const { rows, index } = found
  const row = rows[index]
  const code = String(row['合同编号'] ?? '')
  if (openReviewOf(code, REVIEW_TYPE.PERFORMANCE)) {
    return { ok: false, message: '这份合同已有一条履约结果在待审，请勿重复提交' }
  }
  appendReview({
    事项编号: '',
    合同编号: code,
    事项类型: REVIEW_TYPE.PERFORMANCE,
    提交人: String(row['对接人员'] ?? ''),
    提交日期: todayIso(),
    履约结果: trimmed,
    说明: '对接人员提交，待审核确认后写回合同考核结果',
  })
  return { ok: true, message: '履约结果已进入待审清单' }
}

/** 待审清单处置：续签申请通过则顺延期限，驳回则退回续签窗口；履约事项通过才写回合同。 */
export function reviewTaskAction(taskId: number, pass: boolean): ActionResult {
  const reviewRows = listRows(REVIEW_KEY)
  const reviewIndex = reviewRows.findIndex((item) => Number(item.id) === taskId)
  if (reviewIndex < 0) {
    return { ok: false, message: `没有找到编号为 ${taskId} 的待审事项` }
  }
  const task = reviewRows[reviewIndex]
  if (task.status !== '待审核') {
    return { ok: false, message: `该事项已${task.status === '已通过' ? '通过' : '驳回'}，不能重复审核` }
  }

  const targetStatus = pass ? '已通过' : '已驳回'
  const nextReviews = reviewRows.slice()
  nextReviews[reviewIndex] = {
    ...task,
    status: targetStatus,
    pending: false,
    abnormal: !pass,
  }
  saveRows(REVIEW_KEY, nextReviews)

  const contractCode = String(task['合同编号'] ?? '')
  const contractRows = listRows(CONTRACT_KEY)
  const contractIndex = contractRows.findIndex(
    (item) => String(item['合同编号']) === contractCode,
  )
  if (contractIndex < 0) {
    return { ok: true, message: `事项已${pass ? '通过' : '驳回'}（对应合同已不存在）` }
  }
  const contract = contractRows[contractIndex]

  if (String(task['事项类型']) === REVIEW_TYPE.RENEWAL) {
    if (pass) {
      updateContract(contractRows, contractIndex, {
        '合同期限': extendTerm(String(contract['合同期限'] ?? '')),
        '续签状态': RENEWAL.RENEWED,
        status: LIFECYCLE.ACTIVE,
        pending: true,
        abnormal: false,
      })
      return { ok: true, message: '续签审核通过，合同期限已顺延一年，统一结论已更新' }
    }
    updateContract(contractRows, contractIndex, { '续签状态': RENEWAL.NOT_STARTED })
    return { ok: true, message: '续签申请已驳回，合同回到续签窗口，可修改后重新提交' }
  }

  if (pass) {
    updateContract(contractRows, contractIndex, {
      '考核结果': String(task['履约结果'] ?? ''),
    })
    return { ok: true, message: '履约结果审核通过，已写回合同考核结果' }
  }
  return { ok: true, message: '履约结果已驳回，可由对接人员修正后重新提交' }
}

export function renewRemindDays(): number {
  return RENEW_REMIND_DAYS
}

export function exportContractCsv(): { filename: string; content: string } {
  const header = [
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
    '留档结论',
  ]
  const lines = [header.join(',')]
  for (const v of buildViews(listRows(CONTRACT_KEY))) {
    lines.push(
      [
        v.code,
        v.scope,
        v.term,
        v.termEnd,
        v.lifecycle,
        v.renewalStatus,
        v.fee,
        v.target,
        v.result,
        v.contact,
        v.personnel,
        v.archiveConclusion,
      ]
        .map((cell) => String(cell ?? '').replace(/,/g, '，'))
        .join(','),
    )
  }
  return { filename: '运维合同-统一到期结论.csv', content: `﻿${lines.join('\n')}` }
}
