import { saveRows } from './local-store'
import {
  assessContract,
  normalizeAssessmentResult,
  normalizeRenewalState,
  parseContractPeriod,
  toDateString,
} from '@/domain/contract-lifecycle'
import type { EntryRow, ReviewItem } from '@/data/types'

// 存量合同的一次性回填：把老结构收敛到统一取数所依赖的字段上。
// 历史已终止的合同仍按当时结论留档；其余合同按合同期限重新算一遍到期/续签结论。

const MIGRATION_KEY = 'pv-plant-ops:schema-version'
const SCHEMA_VERSION = 2

function migrationDone(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false
    }
    return window.localStorage.getItem(MIGRATION_KEY) === String(SCHEMA_VERSION)
  } catch {
    return false
  }
}

function markMigrationDone(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(MIGRATION_KEY, String(SCHEMA_VERSION))
    }
  } catch {
    // 无 localStorage（SSR 等）时跳过标记，回填本身仍是幂等的。
  }
}

function migrateContracts(rows: EntryRow[], reviews: ReviewItem[], todayISO: string): EntryRow[] {
  return rows.map((row) => {
    const next: EntryRow = { ...row }
    const { start, end } = parseContractPeriod(row)
    if (start) {
      next['合同期限起'] = start
    }
    if (end) {
      next['合同期限止'] = end
    }

    // 续签状态只保留统一写法，历史手工填的占位文本（如「运维合同样例1」）一并清掉。
    // 例外：历史已终止的合同按当时结论留档，手工写过的续签状态原样保留不覆盖。
    if (String(row.status) !== '已终止') {
      next['续签状态'] = normalizeRenewalState(row['续签状态'])
    }
    next['考核结果'] = normalizeAssessmentResult(row['考核结果'])
    if (next['续签次数'] === undefined || Number.isNaN(Number(next['续签次数']))) {
      next['续签次数'] = 0
    }

    if (String(row.status) === '已终止') {
      // 历史终止：冻结，不按期限重算，留档当时的结论。
      next.pending = false
      return next
    }

    {
      const verdict = assessContract(next, reviews, todayISO)
      next.status = verdict.lifeStatus
      next['续签状态'] = verdict.renewalState
      // 续签审核以待审清单为准；审核中的合同保持待处理，其余按是否进入续签窗口挂待办。
      next.pending =
        verdict.lifeStatus === '待续签' ||
        verdict.lifeStatus === '待签署' ||
        verdict.renewalState === '审核中'
    }
    return next
  })
}

/** 幂等：只在旧版本数据上跑一次，已回填过的库不再改动。 */
export function runDataMigrations(
  all: Record<string, EntryRow[]>,
  reviews: ReviewItem[],
): Record<string, EntryRow[]> {
  if (migrationDone()) {
    return all
  }
  const todayISO = toDateString(new Date())
  const migrated = {
    ...all,
    contract: migrateContracts(all.contract ?? [], reviews, todayISO),
  }
  saveRows('contract', migrated.contract)
  markMigrationDone()
  return migrated
}
