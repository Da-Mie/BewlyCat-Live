export interface LivePreferences {
  quality: number
  sourceId: string
  volume: number
  muted: boolean
  danmaku: boolean
  chatVisible: boolean
  headerVisible: boolean
}

export function normalizeLivePreferences(value?: unknown): LivePreferences {
  const record = value && typeof value === 'object' ? value as Partial<LivePreferences> : {}
  return {
    quality: typeof record.quality === 'number' && Number.isInteger(record.quality) && record.quality >= 0 && record.quality <= 30000 ? record.quality : 10000,
    sourceId: typeof record.sourceId === 'string' && /^[a-z_]+:[a-z0-9]+:\d{1,3}$/i.test(record.sourceId) ? record.sourceId : '',
    volume: typeof record.volume === 'number' && Number.isFinite(record.volume) ? Math.max(0, Math.min(1, record.volume)) : 1,
    muted: typeof record.muted === 'boolean' ? record.muted : true,
    danmaku: typeof record.danmaku === 'boolean' ? record.danmaku : true,
    chatVisible: typeof record.chatVisible === 'boolean' ? record.chatVisible : true,
    headerVisible: typeof record.headerVisible === 'boolean' ? record.headerVisible : true,
  }
}

export function chooseLiveSource<T extends { id: string }>(streams: T[], preferred: string): string {
  const format = preferred.slice(0, preferred.lastIndexOf(':') + 1)
  return streams.find(item => item.id === preferred)?.id
    ?? (format ? streams.find(item => item.id.startsWith(format))?.id : undefined)
    ?? streams[0]?.id ?? ''
}

export function applyLiveAudio(media: Pick<HTMLMediaElement, 'volume' | 'muted'>, volume: number, muted: boolean) {
  const normalized = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1
  if (media.volume !== normalized)
    media.volume = normalized
  if (media.muted !== muted)
    media.muted = muted
}
