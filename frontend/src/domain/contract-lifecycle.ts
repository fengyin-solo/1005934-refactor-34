/**
 * 合同到期与续签的唯一判定处。
 *
 * 合同页、到期提醒、合同考核三处过去各算各的：合同页只看合同期限最后一天，
 * 到期提醒看对接人员手工填的续签状态，考核页又拿考核指标是否达标另判一次，
 * 同一份合同能在三个入口得出三种结论。现在统一收口到本文件：
 *
 * 判定基准（唯一事实来源）：合同期限的最后一天。
 * - 是否到期、是否进入续签提醒窗口，只由合同期限推导；
 * - 续签状态只允许由续签流程（发起 / 审核 / 放弃）写入，不再手工填写；
 * - 考核指标是否达标只决定履约结果，不参与到期判断；
 * - 历史已终止的合同不再重算，按当时的结论留档。
 */
import type { EntryRow } from '@/data/types'

/** 到期提醒提前量：距到期日小于等于该天数即进入续签窗口。 */
export const RENEW_REMIND_DAYS = 30
/** 续签通过后默认顺延的合同年限。 */
export const RENEW_EXTEND_DAYS = 365
/** 证书距到期小于等于该天数时提示即将到期（仍算持证在岗）。 */
export const CERT_WARN_DAYS = 30

/** 续签状态的统一写法：全系统只允许出现这五个值，页面不得自造写法。 */
export const RENEWAL = {
  NOT_STARTED: '未启动',
  PENDING: '待续签',
  REVIEWING: '审核中',
  RENEWED: '已续签',
  DECLINED: '不续签',
} as const

/** 合同（到期）结论的统一写法：合同页、到期提醒、考核页共用这一栏。 */
export const LIFECYCLE = {
  UNSIGNED: '待签署',
  ACTIVE: '履行中',
  EXPIRING: '待续签',
  TERMINATED: '已终止',
} as const

export type RenewalStatus = (typeof RENEWAL)[keyof typeof RENEWAL]
export type LifecycleStatus = (typeof LIFECYCLE)[keyof typeof LIFECYCLE]

/** 存量数据里对接人员手工填过的续签写法，迁移时统一折到标准值。 */
const RENEWAL_SYNONYMS: Record<string, string> = {
  '': RENEWAL.NOT_STARTED,
  未启动: RENEWAL.NOT_STARTED,
  无需续签: RENEWAL.NOT_STARTED,
  待续签: RENEWAL.NOT_STARTED, // 待续签是按期限推导出的窗口态，不入库
  续签中: RENEWAL.REVIEWING,
  审核中: RENEWAL.REVIEWING,
  续签审核中: RENEWAL.REVIEWING,
  已续签: RENEWAL.RENEWED,
  续签完成: RENEWAL.RENEWED,
  不续签: RENEWAL.DECLINED,
  终止续签: RENEWAL.DECLINED,
  已终止: RENEWAL.DECLINED,
}

export type CertState = '有效' | '即将到期' | '已过期' | '无证'

export interface ContractConclusion {
  /** 统一到期结论，三处入口都展示这一栏。 */
  lifecycle: LifecycleStatus
  /** 统一续签状态。 */
  renewalStatus: RenewalStatus
  termStart: string | null
  termEnd: string | null
  /** 距到期日的天数：负数表示已超期天数；无法解析期限时为 null。 */
  daysRemaining: number | null
  expired: boolean
  inWindow: boolean
  /** 是否需要进到期提醒（窗口内或已超期，且仍可能续签）。 */
  remind: boolean
  unsigned: boolean
  /** 存量已终止封存行：按当时结论留档，不参与重新判定。 */
  archived: boolean
  archiveConclusion: string
}

const DATE_RE = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g

/** 从「2026-01-01 至 2026-12-31」这类期限文本里取出一个日期；不传 index 取最后一个（到期日）。 */
export function parseTermDate(term: string, last = true): string | null {
  const matches = [...String(term ?? '').matchAll(DATE_RE)]
  if (matches.length === 0) {
    return null
  }
  const picked = last ? matches[matches.length - 1] : matches[0]
  const [, y, m, d] = picked
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dayValue(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function diffDays(targetIso: string, baseIso: string): number {
  return Math.round((dayValue(targetIso) - dayValue(baseIso)) / 86_400_000)
}

/** 续签通过后顺延期限：保留起始日，到期日往后推一年。 */
export function extendTerm(term: string, days: number = RENEW_EXTEND_DAYS): string {
  const start = parseTermDate(term, false)
  const end = parseTermDate(term, true) ?? start
  if (!end) {
    return term
  }
  const next = new Date(dayValue(end) + days * 86_400_000)
  const y = next.getUTCFullYear()
  const m = String(next.getUTCMonth() + 1).padStart(2, '0')
  const d = String(next.getUTCDate()).padStart(2, '0')
  const newEnd = `${y}-${m}-${d}`
  return start && start !== end ? `${start} 至 ${newEnd}` : `${end} 至 ${newEnd}`
}

/** 把存量续签写法折到标准值；无法识别的一律视为「未启动」，交由期限重新推导。 */
export function normalizeRenewalFlow(raw: unknown): RenewalStatus {
  const key = String(raw ?? '').trim()
  const mapped = RENEWAL_SYNONYMS[key]
  return (mapped as RenewalStatus) ?? RENEWAL.NOT_STARTED
}

/**
 * 唯一的到期 / 续签判定。所有入口只读这个结论，不允许在页面里再算。
 */
export function deriveContract(row: EntryRow, today: string = todayIso()): ContractConclusion {
  const term = String(row['合同期限'] ?? '')
  const termStart = parseTermDate(term, false)
  const termEnd = parseTermDate(term, true)
  const daysRemaining = termEnd ? diffDays(termEnd, today) : null
  const expired = daysRemaining !== null && daysRemaining < 0
  const inWindow = daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= RENEW_REMIND_DAYS
  const rawStatus = String(row.status ?? '')
  const archived = rawStatus === LIFECYCLE.TERMINATED
  const unsigned = rawStatus === LIFECYCLE.UNSIGNED
  const flow = normalizeRenewalFlow(row['续签状态'])

  const base: ContractConclusion = {
    lifecycle: LIFECYCLE.ACTIVE,
    renewalStatus: RENEWAL.NOT_STARTED,
    termStart,
    termEnd,
    daysRemaining,
    expired,
    inWindow,
    remind: false,
    unsigned,
    archived,
    archiveConclusion: archived ? String(row['留档结论'] ?? '历史终止留档') : '',
  }

  if (archived) {
    return { ...base, lifecycle: LIFECYCLE.TERMINATED, renewalStatus: RENEWAL.DECLINED }
  }
  if (unsigned) {
    return { ...base, lifecycle: LIFECYCLE.UNSIGNED, renewalStatus: RENEWAL.NOT_STARTED }
  }

  switch (flow) {
    case RENEWAL.REVIEWING:
      return {
        ...base,
        lifecycle: expired ? LIFECYCLE.EXPIRING : LIFECYCLE.ACTIVE,
        renewalStatus: RENEWAL.REVIEWING,
      }
    case RENEWAL.RENEWED:
      // 续签顺延过的期限再次走完，才重新进入待续签。
      return {
        ...base,
        lifecycle: expired ? LIFECYCLE.EXPIRING : LIFECYCLE.ACTIVE,
        renewalStatus: expired || inWindow ? RENEWAL.PENDING : RENEWAL.RENEWED,
        remind: expired || inWindow,
      }
    case RENEWAL.DECLINED:
      // 明确不续签：到期日一过即按「到期不续签」收口终止。
      return expired
        ? { ...base, lifecycle: LIFECYCLE.TERMINATED, renewalStatus: RENEWAL.DECLINED, archiveConclusion: '到期不续签' }
        : { ...base, lifecycle: LIFECYCLE.ACTIVE, renewalStatus: RENEWAL.DECLINED }
    case RENEWAL.NOT_STARTED:
    default:
      return {
        ...base,
        lifecycle: expired ? LIFECYCLE.EXPIRING : LIFECYCLE.ACTIVE,
        renewalStatus: expired || inWindow ? RENEWAL.PENDING : RENEWAL.NOT_STARTED,
        remind: expired || inWindow,
      }
  }
}

/** 运维人员持证结论：证书有效期只看日期栏，与在不在岗分开记。 */
export function crewCertState(row: EntryRow, today: string = todayIso()): CertState {
  const validUntil = parseTermDate(String(row['证书有效期'] ?? ''))
  if (!validUntil) {
    return '无证'
  }
  const days = diffDays(validUntil, today)
  if (days < 0) {
    return '已过期'
  }
  if (days <= CERT_WARN_DAYS) {
    return '即将到期'
  }
  return '有效'
}

/** 合同服务范围与人员所在电站的匹配：双向包含即可对上（种子数据按电站全称维护）。 */
export function matchStation(scope: string, station: string): boolean {
  const a = String(scope ?? '').trim()
  const b = String(station ?? '').trim()
  if (!a || !b) {
    return false
  }
  return a.includes(b) || b.includes(a)
}

export interface PersonnelMatch {
  /** 持证有效且在岗的人数：合同结论要求至少 1 人。 */
  ready: number
  /** 在岗但证书 30 日内到期的人数。 */
  warn: number
  /** 在岗但证书已过期 / 已离岗 / 待复证等对不上合同结论的人数。 */
  invalid: number
  gap: boolean
  label: string
}

/**
 * 运维人员持证与在岗情况，必须对得上这份合同结论：
 * 履行中 / 待续签的合同，至少要有 1 名「在岗 + 证书有效」且电站对得上的人员。
 */
export function personnelMatch(
  contract: EntryRow,
  conclusion: ContractConclusion,
  crewRows: EntryRow[],
  today: string = todayIso(),
): PersonnelMatch {
  const serviceable =
    conclusion.lifecycle === LIFECYCLE.ACTIVE || conclusion.lifecycle === LIFECYCLE.EXPIRING
  if (!serviceable) {
    return { ready: 0, warn: 0, invalid: 0, gap: false, label: '—' }
  }
  const scope = String(contract['服务范围'] ?? '')
  let ready = 0
  let warn = 0
  let invalid = 0
  for (const crew of crewRows) {
    if (!matchStation(scope, String(crew['所在电站'] ?? ''))) {
      continue
    }
    const onPost = String(crew.status ?? '') === '在岗'
    const cert = crewCertState(crew, today)
    if (onPost && cert === '有效') {
      ready += 1
    } else if (onPost && cert === '即将到期') {
      warn += 1
    } else {
      invalid += 1
    }
  }
  const gap = ready === 0
  const parts = [`持证在岗 ${ready} 人`]
  if (warn > 0) {
    parts.push(`证件临期 ${warn} 人`)
  }
  if (invalid > 0) {
    parts.push(`不符 ${invalid} 人`)
  }
  return { ready, warn, invalid, gap, label: parts.join('，') }
}

/** 统一的到期结论文案：三个入口直接展示，不再各自拼。 */
export function conclusionLabel(c: ContractConclusion): string {
  if (c.archived || (c.lifecycle === LIFECYCLE.TERMINATED && c.archiveConclusion)) {
    return `${LIFECYCLE.TERMINATED}（${c.archiveConclusion}）`
  }
  if (c.unsigned) {
    return LIFECYCLE.UNSIGNED
  }
  if (c.daysRemaining === null) {
    return c.lifecycle
  }
  if (c.expired) {
    return `${LIFECYCLE.EXPIRING}（已超期 ${Math.abs(c.daysRemaining)} 天）`
  }
  if (c.inWindow) {
    return `${LIFECYCLE.ACTIVE}（${c.daysRemaining} 天后到期）`
  }
  return `${LIFECYCLE.ACTIVE}（剩余 ${c.daysRemaining} 天）`
}
