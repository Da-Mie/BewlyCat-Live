export interface NativeLiveFilters {
  uid: string
  keywords: string[]
  blockedUids: string[]
}

/** The same account shield_info used by the native live room and PiliPlus. */
export function readNativeLiveFilters(data: unknown, uid: string): NativeLiveFilters {
  const shield = (data as { shield_info?: { keyword_list?: unknown, shield_user_list?: unknown } } | null)?.shield_info
  if (!shield || typeof shield !== 'object' || Array.isArray(shield))
    throw new Error('Live shield settings unavailable')
  const keywords = shield.keyword_list ?? []
  const users = shield.shield_user_list ?? []
  if (!Array.isArray(keywords) || keywords.some(value => typeof value !== 'string') || !Array.isArray(users))
    throw new Error('Invalid live shield settings')
  const blockedUids = users.map((value) => {
    const id = String(value?.uid ?? '')
    if (!/^[1-9]\d{0,19}$/.test(id))
      throw new Error('Invalid live shield user')
    return id
  })
  return {
    uid,
    keywords: [...new Set(keywords)],
    blockedUids: [...new Set(blockedUids)],
  }
}

export function isNativeLiveMessageBlocked(message: { uid: string, text: string }, filters: NativeLiveFilters): boolean {
  // Native live keywords are literal, case-sensitive substrings, not regexes.
  return filters.blockedUids.includes(message.uid) || filters.keywords.some(keyword => message.text.includes(keyword))
}
