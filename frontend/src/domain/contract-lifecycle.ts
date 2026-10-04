import type {
  AssessmentResult,
  ContractLifeStatus,
  EntryRow,
  RenewalState,
  ReviewItem,
} from '@/data/types'

// 页面统一从本模块引用判定结论与状态枚举，保证续签状态只有一套写法。
export type {
  AssessmentResult,
  ContractLifeStatus,
  RenewalState,
  ReviewItem,
} from '@/data/types'

// 到期与续签的共用判定：合同页、到期提醒、考核页都从这里取结论，谁也不再各写一套算法。
// 准绳只有一个：合同期限的最后一天（合同期限止）。续签状态只跟踪续签流程；考核指标不参与到期判定。

export const RENEWAL_WINDOW_DAYS = 30 // 到期前 30 天进入续签窗口
export const CERT_GRACE_DAYS = 0 // 证书有效期当天仍算有效，次日才算失效

export const LIFE_STATUSES: ContractLifeStatus[] = ['待签署', '履行中', '待续签', '已过期', '已终止']
export const RENEWAL_STATES: RenewalState[] = ['未到续签窗口', '待续签', '审核中', '已续签', '无需续签']
export const ASSESSMENT_RESULTS: AssessmentResult[] = ['合格', '不合格', '未考核']

// 续签状态的统一写法：历史手工填的各种说法都先收敛到这几档。
const RENEWAL_ALIASES: Record<string, RenewalState> = {
  待续签: '待续签',
  待續签: '待续签',
  申请续签: '审核中',
  续签审核中: '审核中',
  审核中: '审核中',
  已续签: '已续签',
  续签完成: '已续签',
  不续签: '无需续签',
  无需续签: '无需续签',
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 本地日历日，避免 toISOString 的 UTC 偏移。 */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 只按日历日比较：a 晚于 b 返回正数。非法日期返回 null。 */
export function diffDays(fromISO: string, toISO: string): number | null {
  const from = parseDate(fromISO)
  const to = parseDate(toISO)
  if (!from || !to) {
    return null
  }
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

export function parseDate(iso: string | undefined | null): Date | null {
  if (!iso) {
    return null
  }
  const text = String(iso).trim()
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text)
  if (!match) {
    return null
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * 解析合同期限。兼容三种既有写法：
 * - 新结构：合同期限起 / 合同期限止 两栏；
 * - 区间文本「2025-01-01 至 2025-12-31」；
 * - 老合同页只填最后一天的单个日期，按「仅知到期日」回填，起期留空不臆造。
 */
export function parseContractPeriod(
  row: Pick<EntryRow, string> | EntryRow,
): { start: string | null; end: string | null } {
  const rawStart = text(row['合同期限起'])
  const rawEnd = text(row['合同期限止'])
  if (rawStart || rawEnd) {
    return { start: parseDate(rawStart) ? rawStart! : null, end: parseDate(rawEnd) ? rawEnd! : null }
  }
  const legacy = text(row['合同期限']) ?? ''
  const parts = legacy.split(/\s*(?:至|~|—|–|-{2,})\s*/).filter((part) => part.trim() !== '')
  if (parts.length >= 2) {
    return { start: parseDate(parts[0]) ? parts[0].trim() : null, end: parseDate(parts[1]) ? parts[1].trim() : null }
  }
  if (parts.length === 1) {
    return { start: null, end: parseDate(parts[0]) ? parts[0].trim() : null }
  }
  return { start: null, end: null }
}

export function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) {
    return '期限未登记'
  }
  return `${start ?? '—'} 至 ${end ?? '—'}`
}

export function normalizeRenewalState(raw: unknown): RenewalState {
  const value = text(raw)
  if (!value) {
    return '未到续签窗口'
  }
  return RENEWAL_ALIASES[value] ?? '未到续签窗口'
}

export function normalizeAssessmentResult(raw: unknown): AssessmentResult {
  const value = text(raw)
  if (value === '合格' || value === '不合格' || value === '未考核') {
    return value
  }
  // 兼容历史上把指标/结论写成其他字样的情况：非空一律先落「未考核」，由考核页重新给结论。
  return '未考核'
}

function text(value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null
  }
  return String(value).trim()
}

function openReview(row: EntryRow, reviews: ReviewItem[]): ReviewItem | undefined {
  return reviews.find(
    (item) =>
      item.contractId === Number(row.id) && item.kind === '续签申请' && item.status === '待审核',
  )
}

export type ContractVerdict = {
  lifeStatus: ContractLifeStatus // 合同页/提醒/考核共用的到期结论
  renewalState: RenewalState // 续签状态的统一写法
  assessment: AssessmentResult
  end: string | null
  daysToEnd: number | null // 正数=还剩几天，负数=已过期几天
  inRenewalWindow: boolean
  renewed: boolean
  frozen: boolean // 历史已终止：结论按当时留档，不再重算
}

/**
 * 唯一的到期/续签判定入口。
 * @param todayISO 主要为测试/回填留参数，默认今天。
 */
export function assessContract(
  row: EntryRow,
  reviews: ReviewItem[] = [],
  todayISO = toDateString(new Date()),
): ContractVerdict {
  const { end } = parseContractPeriod(row)
  const storedState = normalizeRenewalState(row['续签状态'])
  const assessment = normalizeAssessmentResult(row['考核结果'])
  const daysToEnd = end ? diffDays(todayISO, end) : null

  // 历史已终止的合同：沿用终止时的结论留档，到期日怎么推移都不再翻案。
  if (String(row.status) === '已终止') {
    return {
      lifeStatus: '已终止',
      renewalState: storedState === '已续签' ? '已续签' : '无需续签',
      assessment,
      end,
      daysToEnd,
      inRenewalWindow: false,
      renewed: storedState === '已续签',
      frozen: true,
    }
  }

  if (String(row.status) === '待签署') {
    return {
      lifeStatus: '待签署',
      renewalState: '无需续签',
      assessment,
      end,
      daysToEnd,
      inRenewalWindow: false,
      renewed: storedState === '已续签',
      frozen: false,
    }
  }

  const renewed = storedState === '已续签' || Number(row['续签次数'] ?? 0) > 0
  const pendingRenewal = Boolean(openReview(row, reviews)) || storedState === '审核中'
  const inWindow = daysToEnd !== null && daysToEnd <= RENEWAL_WINDOW_DAYS

  let lifeStatus: ContractLifeStatus
  if (daysToEnd === null) {
    lifeStatus = '履行中' // 期限缺失时不臆断到期，留在履行中由人工补登
  } else if (daysToEnd < 0) {
    lifeStatus = '已过期'
  } else if (daysToEnd <= RENEWAL_WINDOW_DAYS) {
    lifeStatus = '待续签'
  } else {
    lifeStatus = '履行中'
  }

  let renewalState: RenewalState
  if (pendingRenewal) {
    renewalState = '审核中'
  } else if (renewed) {
    renewalState = '已续签'
  } else if (inWindow) {
    renewalState = '待续签'
  } else {
    renewalState = '未到续签窗口'
  }

  return {
    lifeStatus,
    renewalState,
    assessment,
    end,
    daysToEnd,
    inRenewalWindow: inWindow,
    renewed,
    frozen: false,
  }
}

/** 到期提醒：续签窗口内还没走完续签（含已过期仍未续签）的合同。 */
export function isRenewalDue(verdict: ContractVerdict): boolean {
  if (verdict.frozen || verdict.lifeStatus === '待签署') {
    return false
  }
  return verdict.renewalState === '待续签' || verdict.renewalState === '审核中'
}

/** 允许提交续签申请：窗口内（含过期）、没有待审核申请、且未续签/未终止。 */
export function canSubmitRenewal(verdict: ContractVerdict): boolean {
  return (
    !verdict.frozen &&
    verdict.lifeStatus !== '待签署' &&
    verdict.inRenewalWindow &&
    verdict.renewalState !== '审核中' &&
    verdict.renewalState !== '已续签'
  )
}

// ── 运维人员持证 / 在岗 与这份到期结论对账 ──────────────────────────────────

export type CrewCheck = {
  crew: EntryRow
  matchedContract: EntryRow | null
  verdict: ContractVerdict | null
  onPost: boolean
  certValid: boolean
  certExpiry: string | null
  problems: string[]
}

export function checkCrewAgainstContracts(
  crew: EntryRow,
  contracts: EntryRow[],
  reviews: ReviewItem[] = [],
  todayISO = toDateString(new Date()),
): CrewCheck {
  const onPost = String(crew.status) === '在岗'
  const certExpiry = text(crew['证书有效期'])
  const certDate = parseDate(certExpiry)
  const certValid = certDate !== null && (diffDays(todayISO, toDateString(certDate)) ?? -1) >= CERT_GRACE_DAYS

  const matched = contracts.find(
    (contract) =>
      String(contract.status) !== '已终止' &&
      String(contract.status) !== '待签署' &&
      text(contract['对接人员']) === text(crew['姓名']),
  ) ?? null
  const verdict = matched ? assessContract(matched, reviews, todayISO) : null

  const problems: string[] = []
  if (onPost && !certDate) {
    problems.push('在岗但证书有效期缺失')
  } else if (onPost && !certValid) {
    problems.push('在岗但持证已过期')
  } else if (!onPost && matched) {
    problems.push(`登记为合同对接人员，但当前「${String(crew.status)}」已不在岗`)
  }
  if (verdict && (verdict.lifeStatus === '已过期' || verdict.lifeStatus === '待续签') && onPost) {
    problems.push(`对接合同已进入${verdict.lifeStatus}，续签未闭环`)
  }
  if (verdict && verdict.assessment === '不合格' && onPost) {
    problems.push('对接合同最近考核不合格')
  }

  return { crew, matchedContract: matched, verdict, onPost, certValid, certExpiry, problems }
}

/** 合同侧对账：有效合同必须有一名「在岗且持证有效」的对接人员，否则问题会挂到这份合同上。 */
export function unmatchedContractCrews(
  contracts: EntryRow[],
  crew: EntryRow[],
  reviews: ReviewItem[] = [],
  todayISO = toDateString(new Date()),
): Map<number, string[]> {
  const checks = crew.map((person) => checkCrewAgainstContracts(person, contracts, reviews, todayISO))
  const result = new Map<number, string[]>()
  for (const contract of contracts) {
    if (String(contract.status) === '已终止' || String(contract.status) === '待签署') {
      continue
    }
    const contractId = Number(contract.id)
    const linked = checks.filter((check) => Number(check.matchedContract?.id) === contractId)
    const problems: string[] = linked.flatMap((check) => check.problems)
    if (!linked.some((check) => check.onPost && check.certValid)) {
      const contact = text(contract['对接人员'])
      problems.unshift(
        contact ? `对接人员「${contact}」不在岗或持证失效` : '未登记对接人员，履约责任无人认领',
      )
    }
    if (problems.length) {
      result.set(contractId, [...new Set(problems)])
    }
  }
  return result
}
