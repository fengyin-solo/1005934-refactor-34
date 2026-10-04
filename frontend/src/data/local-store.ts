import { SEED_ROWS } from './seed'
import { LIFECYCLE, RENEWAL, normalizeRenewalFlow, parseTermDate, todayIso, diffDays } from '@/domain/contract-lifecycle'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pv-plant-ops:entries:v2'
// 旧版（三处入口各算各的时代）数据键：首次打开 v2 时做一次迁移回填。
const LEGACY_STORAGE_KEY = 'pv-plant-ops:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 存量合同回填（只在从旧版数据升级时执行一次）：
 * - 历史已终止的合同不再重算，按当时的续签写法折成「留档结论」封存；
 * - 其余合同一律按合同期限最后一天回填：已过到期日 -> 待续签（状态快照），
 *   未到期 -> 履行中；续签状态只保留流程态（审核中/已续签/不续签），
 *   手工填的「待续签」之类窗口态不再入库，改由统一推导。
 */
function migrateContractRow(row: EntryRow, today: string): EntryRow {
  const next: EntryRow = { ...row }
  const rawStatus = String(row.status ?? '')
  const flow = normalizeRenewalFlow(row['续签状态'])

  if (rawStatus === LIFECYCLE.TERMINATED) {
    next.status = LIFECYCLE.TERMINATED
    next.pending = false
    next['续签状态'] = RENEWAL.DECLINED
    if (!next['留档结论']) {
      next['留档结论'] = String(row['续签状态'] ?? '').trim() || '历史终止留档'
    }
    return next
  }

  next['续签状态'] = flow
  const termEnd = parseTermDate(String(row['合同期限'] ?? ''))
  if (termEnd) {
    const expired = diffDays(termEnd, today) < 0
    if (expired) {
      next.status = LIFECYCLE.EXPIRING
      next.pending = true
      next.abnormal = true
    } else {
      next.status = rawStatus === LIFECYCLE.UNSIGNED ? LIFECYCLE.UNSIGNED : LIFECYCLE.ACTIVE
      next.pending = next.status !== LIFECYCLE.UNSIGNED
    }
  }
  return next
}

function migrateV1(legacy: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const today = todayIso()
  const merged: Record<string, EntryRow[]> = {}
  for (const [key, seedRows] of Object.entries(SEED_ROWS)) {
    const oldRows = legacy[key]
    if (!oldRows || oldRows.length === 0) {
      merged[key] = clone(seedRows)
    } else if (key === 'contract') {
      merged[key] = oldRows.map((row) => migrateContractRow(row, today))
    } else {
      merged[key] = oldRows
    }
  }
  return merged
}

function seedData(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedData()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
      // 后加的模块对老缓存做补齐。
      return { ...seedData(), ...parsed }
    } catch {
      // 落到下方重新播种
    }
  }

  const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  let data: Record<string, EntryRow[]>
  if (legacyRaw) {
    try {
      data = migrateV1(JSON.parse(legacyRaw) as Record<string, EntryRow[]>)
    } catch {
      data = seedData()
    }
  } else {
    data = seedData()
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  return data
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
