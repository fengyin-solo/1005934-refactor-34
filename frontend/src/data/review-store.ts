import { SEED_REVIEWS } from './seed'
import type { ReviewItem, ReviewStatus } from './types'

// 待审清单：对接人员的履约结果与续签申请都落在这里，页面只做读取和审批动作。
const REVIEW_KEY = 'pv-plant-ops:reviews'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: ReviewItem[] | null = null

function read(): ReviewItem[] {
  if (cache) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = clone(SEED_REVIEWS)
    return cache
  }
  const raw = window.localStorage.getItem(REVIEW_KEY)
  if (!raw) {
    cache = clone(SEED_REVIEWS)
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(cache))
    return cache
  }
  try {
    cache = JSON.parse(raw) as ReviewItem[]
  } catch {
    cache = clone(SEED_REVIEWS)
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(cache))
  }
  return cache!
}

function persist(items: ReviewItem[]): void {
  cache = items
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(items))
  }
}

export function listReviews(status?: ReviewStatus): ReviewItem[] {
  const items = read()
  return status ? items.filter((item) => item.status === status) : [...items]
}

export function addReview(item: Omit<ReviewItem, 'id' | 'submittedAt' | 'status'> & {
  status?: ReviewStatus
  submittedAt?: string
}): ReviewItem {
  const items = read()
  const created: ReviewItem = {
    ...item,
    id: items.reduce((max, current) => Math.max(max, current.id), 0) + 1,
    status: item.status ?? '待审核',
    submittedAt: item.submittedAt ?? new Date().toISOString(),
  }
  persist([created, ...items])
  return created
}

export function updateReview(id: number, patch: Partial<ReviewItem>): ReviewItem | null {
  const items = read()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) {
    return null
  }
  items[index] = { ...items[index], ...patch }
  persist(items)
  return items[index]
}

export function findOpenReview(contractId: number, kind: ReviewItem['kind']): ReviewItem | undefined {
  return read().find(
    (item) => item.contractId === contractId && item.kind === kind && item.status === '待审核',
  )
}

export function resetReviews(): ReviewItem[] {
  persist(clone(SEED_REVIEWS))
  return cache!
}
