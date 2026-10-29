export type AccountFilterScope = 'comments' | 'videos' | 'liveDanmaku'
export type AccountFilterDecision = 'allow' | 'block' | 'pending'

export interface AccountIdentity {
  mid?: string
  level?: number
  senior?: boolean
  followed?: boolean
}

export interface AccountLevelRule {
  enabled: boolean
  blockedLevels: number[]
  blockSenior: boolean
  unknown: 'allow' | 'block'
}

export interface AccountLevelFilters {
  comments: AccountLevelRule
  videos: AccountLevelRule
  liveDanmaku: AccountLevelRule
  exemptSelf: boolean
  exemptFollowed: boolean
  whitelist: string[]
}

export const ACCOUNT_FILTER_SCOPES: AccountFilterScope[] = ['comments', 'videos', 'liveDanmaku']

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function flag(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1')
    return true
  if (value === false || value === 0 || value === '0')
    return false
}

export function normalizeAccountMid(value: unknown): string | undefined {
  const mid = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  return /^[1-9]\d{0,19}$/.test(mid) ? mid : undefined
}

/** 仅识别账号等级与硬核会员标记。 */
export function readAccountIdentity(value: unknown): AccountIdentity {
  const data = record(value)
  const member = record(data.member ?? data.card ?? data)
  const rawLevel = member.level_info?.current_level ?? member.level
  const level = typeof rawLevel === 'number' || (typeof rawLevel === 'string' && rawLevel.trim()) ? Number(rawLevel) : Number.NaN
  return {
    mid: normalizeAccountMid(member.mid ?? member.uid),
    level: Number.isInteger(level) && level >= 0 && level <= 6 ? level : undefined,
    senior: flag(member.is_senior_member ?? (typeof member.senior === 'boolean' ? member.senior : undefined))
      ?? ([0, 1, 2].includes(member.level_info?.identity) ? member.level_info.identity === 2 : undefined),
    followed: flag(member.following ?? member.is_followed ?? member.followed),
  }
}

export function normalizeAccountLevelFilters(value?: unknown): AccountLevelFilters {
  const data = record(value)
  const rule = (scope: AccountFilterScope): AccountLevelRule => {
    const item = record(data[scope])
    return {
      enabled: item.enabled === true,
      blockedLevels: Array.isArray(item.blockedLevels)
        ? [...new Set<number>(item.blockedLevels.filter((n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6))]
        : [],
      blockSenior: item.blockSenior === true,
      unknown: item.unknown === 'block' ? 'block' : 'allow',
    }
  }
  return {
    comments: rule('comments'),
    videos: rule('videos'),
    liveDanmaku: rule('liveDanmaku'),
    exemptSelf: data.exemptSelf !== false,
    exemptFollowed: data.exemptFollowed === true,
    whitelist: Array.isArray(data.whitelist)
      ? [...new Set<string>(data.whitelist.map(normalizeAccountMid).filter((mid: string | undefined): mid is string => !!mid))].slice(0, 500)
      : [],
  }
}

export function decideAccountFilter(identity: AccountIdentity, filters: AccountLevelFilters, scope: AccountFilterScope, selfMid?: string): 'allow' | 'block' {
  const rule = filters[scope]
  if (!isAccountRuleActive(rule) || (identity.mid && (filters.whitelist.includes(identity.mid)
    || (filters.exemptSelf && identity.mid === selfMid))) || (filters.exemptFollowed && identity.followed === true)) {
    return 'allow'
  }
  if (identity.senior === true)
    return rule.blockSenior ? 'block' : 'allow'
  // 未知硬核标记的 LV6 按未知身份处理。
  if (identity.level === undefined || (identity.level === 6 && identity.senior === undefined))
    return rule.unknown === 'block' ? 'block' : 'allow'
  return rule.blockedLevels.includes(identity.level) ? 'block' : 'allow'
}

export function needsAccountIdentity(identity: AccountIdentity, filters: AccountLevelFilters, scope: AccountFilterScope, selfMid?: string): boolean {
  if (!isAccountRuleActive(filters[scope]) || !identity.mid || filters.whitelist.includes(identity.mid)
    || (filters.exemptSelf && identity.mid === selfMid) || (filters.exemptFollowed && identity.followed === true)) {
    return false
  }
  return (identity.level === undefined && identity.senior !== true)
    || (identity.level === 6 && identity.senior === undefined)
    || (filters.exemptFollowed && identity.followed === undefined)
}

export function isAccountRuleActive(rule: AccountLevelRule): boolean {
  return rule.enabled && (rule.blockedLevels.length > 0 || rule.blockSenior || rule.unknown === 'block')
}

/** 合并查询并限流，短暂缓存失败结果。 */
export class AccountIdentityCache {
  private entries = new Map<string, { identity: AccountIdentity, expires: number }>()
  private pending = new Map<string, Promise<AccountIdentity>>()
  private queue: Array<{ run: () => Promise<void>, cancel: () => void }> = []
  private active = 0
  private lastStart = 0
  private generation = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor(private lookup: (mid: string) => Promise<AccountIdentity>, private changed: () => void = () => {}) {}

  reset() {
    this.generation++
    this.entries.clear()
    this.pending.clear()
    clearTimeout(this.timer)
    this.timer = undefined
    for (const job of this.queue.splice(0))
      job.cancel()
    queueMicrotask(this.changed)
  }

  peek(mid: string): AccountIdentity | undefined {
    const entry = this.entries.get(mid)
    return entry && entry.expires > Date.now() ? entry.identity : undefined
  }

  resolve(mid: string): Promise<AccountIdentity> {
    const existing = this.peek(mid)
    if (existing)
      return Promise.resolve(existing)
    const pending = this.pending.get(mid)
    if (pending)
      return pending
    if (!normalizeAccountMid(mid))
      return Promise.resolve({ mid })
    if (this.pending.size >= 128) {
      const identity = { mid }
      this.remember(mid, identity)
      queueMicrotask(this.changed)
      return Promise.resolve(identity)
    }
    const generation = this.generation
    const promise = new Promise<AccountIdentity>((resolve) => {
      const cancel = () => resolve({ mid })
      this.queue.push({ cancel, run: async () => {
        if (generation !== this.generation) {
          cancel()
          return
        }
        let identity: AccountIdentity = { mid }
        try {
          identity = { ...await this.lookup(mid), mid }
        }
        catch { /* 查询失败时保留未知身份。 */ }
        if (generation !== this.generation) {
          cancel()
          return
        }
        this.remember(mid, identity)
        this.pending.delete(mid)
        resolve(identity)
        this.changed()
      } })
    })
    this.pending.set(mid, promise)
    this.pump()
    return promise
  }

  private remember(mid: string, identity: AccountIdentity) {
    if (this.entries.size >= 1000 && !this.entries.has(mid))
      this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(mid, { identity, expires: Date.now() + (identity.level !== undefined || identity.senior !== undefined ? 6 * 60 * 60_000 : 60_000) })
  }

  private pump() {
    if (this.timer || this.active >= 3 || !this.queue.length)
      return
    const delay = Math.max(0, 200 - (Date.now() - this.lastStart))
    this.timer = setTimeout(() => {
      this.timer = undefined
      const job = this.queue.shift()
      if (!job)
        return
      this.active++
      this.lastStart = Date.now()
      void job.run().finally(() => {
        this.active--
        this.pump()
      })
      this.pump()
    }, delay)
  }
}
