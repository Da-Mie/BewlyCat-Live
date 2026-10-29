export interface LiveTimeRange {
  start: number
  end: number
}

export const LIVE_TIMELINE_SECONDS = 10 * 60

export function livePlaybackPoint(ranges: LiveTimeRange[], sync: number | null | undefined, duration: number): number {
  if (typeof sync === 'number' && Number.isFinite(sync) && sync >= 0 && (!Number.isFinite(duration) || sync <= duration))
    return sync
  const last = ranges.at(-1)
  return last ? Math.max(last.start, last.end - 0.9) : 0
}

export function isLivePositionAvailable(ranges: LiveTimeRange[], position: number): boolean {
  return Number.isFinite(position) && ranges.some(range => position >= range.start && position <= range.end)
}

export function readLiveRanges(media: Pick<HTMLMediaElement, 'buffered' | 'seekable'>): LiveTimeRange[] {
  const ranges: LiveTimeRange[] = []
  const { buffered, seekable } = media
  let i = 0
  let j = 0
  while (i < seekable.length && j < buffered.length) {
    const seekEnd = seekable.end(i)
    const bufferEnd = buffered.end(j)
    const start = Math.max(0, seekable.start(i), buffered.start(j))
    const end = Math.min(seekEnd, bufferEnd) - 0.1
    if (Number.isFinite(start) && Number.isFinite(end) && end > start)
      ranges.push({ start, end })
    if (seekEnd <= bufferEnd)
      i++
    else
      j++
  }
  return ranges
}

export function clampLivePosition(ranges: LiveTimeRange[], target: number, current: number): number {
  if (!Number.isFinite(target) || !Number.isFinite(current))
    return current
  const direction = Math.sign(target - current)
  if (!direction)
    return current
  let next = current
  for (const range of direction > 0 ? ranges : [...ranges].reverse()) {
    const candidate = Math.max(range.start, Math.min(range.end, target))
    if ((candidate - current) * direction >= 0)
      next = candidate
    if ((candidate - target) * direction >= 0)
      break
  }
  return next
}

export function liveHistorySeconds(bytesPerSecond: number): number {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0)
    return 120
  // 预留音频与前向缓冲；浏览器可能提前回收缓存。
  return Math.max(10, Math.min(15 * 60, Math.floor(96 * 1024 * 1024 / (bytesPerSecond * 1.25))))
}

export function formatLiveTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(value / 3600)
  return [hours || undefined, Math.floor(value / 60) % 60, value % 60]
    .filter(part => part !== undefined)
    .map((part, index) => index ? String(part).padStart(2, '0') : String(part))
    .join(':')
}
