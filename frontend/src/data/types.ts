/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ── 运维合同：到期与续签的共用结论 ─────────────────────────────────────────
// 合同生命周期以「合同期限止」这一栏为唯一准绳，续签状态只描述续签流程，考核结果不再参与到期判定。
export type ContractLifeStatus = '待签署' | '履行中' | '待续签' | '已过期' | '已终止'
export type RenewalState = '未到续签窗口' | '待续签' | '审核中' | '已续签' | '无需续签'
export type AssessmentResult = '合格' | '不合格' | '未考核'

// 对接人员（运维班组）的履约结果与续签申请统一落进这份待审清单。
export type ReviewKind = '续签申请' | '履约考核'
export type ReviewStatus = '待审核' | '已通过' | '已驳回'

export type ReviewItem = {
  id: number
  kind: ReviewKind
  contractId: number
  合同编号: string
  提交人: string
  submittedAt: string
  status: ReviewStatus
  申请期限止?: string
  考核结果?: Exclude<AssessmentResult, '未考核'>
  考核说明?: string
  reviewedAt?: string
  审核备注?: string
}
