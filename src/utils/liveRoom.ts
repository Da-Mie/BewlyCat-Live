export interface LiveStream {
  id: string
  url: string
  format: 'hls' | 'flv'
  description: string
  quality: number
}
export interface LiveRoom {
  roomId: string
  uid: string
  title: string
  uname: string
  face: string
  cover: string
  background: string
  live: boolean
  portrait: boolean
  locked: boolean
  qualities: { value: number, label: string }[]
  streams: LiveStream[]
  superChats: LiveMessage[]
}
export interface LiveMessage {
  id: string
  uid: string
  name: string
  text: string
  kind: 'chat' | 'sc' | 'gift' | 'entry'
  color?: string
  history?: boolean
  sc?: { id: string, price: number, start: number, end: number }
  gift?: { id: number, count: number, image: string }
}

export function liveAssetUrl(value: unknown): string {
  try {
    const url = new URL(String(value ?? '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:'))
    return url.protocol === 'https:' && !url.username && !url.password
      && (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))
      ? url.href
      : ''
  }
  catch { return '' }
}

export function parseLiveRoomId(value: unknown): string | undefined {
  let text = String(value ?? '').trim()
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      if (url.hostname !== 'live.bilibili.com')
        return
      text = url.pathname.replace(/^\/+|\/+$/g, '')
    }
    catch { return }
  }
  if (!/^\d{1,16}$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1)
    return
  return String(Number(text))
}

export function isNewLiveRoomEnabled(stored: unknown): boolean {
  if (typeof stored === 'string') {
    try {
      stored = JSON.parse(stored)
    }
    catch { return true }
  }
  return !(stored && typeof stored === 'object' && 'liveRoomEnhanced' in stored && stored.liveRoomEnhanced === false)
}

export function shouldOpenNewLiveRoom(url: string, stored: unknown, navigationType?: string): boolean {
  try {
    const target = new URL(url)
    return !!parseLiveRoomId(target.href) && target.searchParams.get('bewly_native') !== '1'
      && navigationType !== 'back_forward' && isNewLiveRoomEnabled(stored)
  }
  catch { return false }
}

export function originalLiveRoomUrl(roomId?: string): string {
  const url = new URL(`https://live.bilibili.com/${parseLiveRoomId(roomId) ?? ''}`)
  url.searchParams.set('bewly_native', '1')
  return url.href
}

export function isLiveStreamUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      && ['bilivideo.com', 'bilivideo.cn', 'acgvideo.com', 'hdslb.com'].some(domain => url.hostname.endsWith(`.${domain}`) || url.hostname === domain)
  }
  catch { return false }
}

export function readLiveRoom(play: any, details: any): LiveRoom {
  const info = details?.room_info ?? {}
  const anchor = details?.anchor_info?.base_info ?? {}
  const playurl = play?.playurl_info?.playurl
  const qualityNames = new Map<number, string>((playurl?.g_qn_desc ?? []).map((item: any) => [Number(item.qn), String(item.desc)]))
  const qualities = new Set<number>()
  const streams: LiveStream[] = []
  for (const stream of playurl?.stream ?? []) {
    for (const format of stream.format ?? []) {
      for (const codec of format.codec ?? []) {
        // Request AVC explicitly: HEVC support varies between browsers and operating systems.
        if (codec.codec_name !== 'avc')
          continue
        const kind = stream.protocol_name === 'http_hls' ? 'hls' : format.format_name === 'flv' ? 'flv' : undefined
        if (!kind)
          continue
        for (const quality of codec.accept_qn ?? [])
          qualities.add(Number(quality))
        for (const [index, cdn] of (codec.url_info ?? []).entries()) {
          const url = `${cdn.host ?? ''}${codec.base_url ?? ''}${cdn.extra ?? ''}`.replace(/^http:/, 'https:')
          if (!isLiveStreamUrl(url))
            continue
          streams.push({
            id: `${stream.protocol_name}:${format.format_name}:${index}`,
            url,
            format: kind,
            quality: Number(codec.current_qn),
            description: `${format.format_name.toUpperCase()} · CDN ${index + 1}`,
          })
        }
      }
    }
  }
  streams.sort((a, b) => Number(b.format === 'hls') - Number(a.format === 'hls'))
  return {
    roomId: String(play?.room_id ?? info.room_id ?? ''),
    uid: String(play?.uid ?? info.uid ?? ''),
    title: String(info.title ?? ''),
    uname: String(anchor.uname ?? ''),
    face: String(anchor.face ?? ''),
    cover: String(info.cover ?? ''),
    background: liveAssetUrl(info.background),
    live: play?.live_status === 1,
    portrait: !!play?.is_portrait,
    locked: !!(play?.is_locked || play?.is_hidden || (play?.encrypted && !play?.pwd_verified)),
    qualities: [...qualities].filter(Number.isFinite).sort((a, b) => a - b).map(value => ({ value, label: qualityNames.get(value) ?? String(value) })),
    streams,
    superChats: (Array.isArray(details?.super_chat_info?.message_list) ? details.super_chat_info.message_list : []).slice(-20).map((data: any) => readLiveMessage({ cmd: 'SUPER_CHAT_MESSAGE', data }, `sc:${data.id}`)).filter(Boolean),
  }
}

export function readLiveMessage(raw: any, id: string): LiveMessage | undefined {
  const command = String(raw?.cmd ?? '').split(':')[0]
  if (command === 'DANMU_MSG') {
    const info = raw.info
    const content = info?.[0]?.[15]
    const user = content?.user
    const color = Number(info?.[0]?.[3])
    return {
      id,
      uid: String(user?.uid ?? info?.[2]?.[0] ?? ''),
      name: String(user?.base?.name ?? info?.[2]?.[1] ?? ''),
      text: String(info?.[1] ?? '').slice(0, 4096),
      kind: 'chat',
      color: Number.isInteger(color) && color >= 0 && color <= 0xFFFFFF ? `#${color.toString(16).padStart(6, '0')}` : undefined,
    }
  }
  const data = raw?.data
  if (command === 'SUPER_CHAT_MESSAGE') {
    const start = Number(data?.start_time) * 1000
    const end = Number(data?.end_time) * 1000
    const price = Number(data?.price)
    if (!data?.id || !Number.isFinite(price) || price <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return
    return { id, uid: String(data.uid ?? ''), name: String(data.user_info?.uname ?? ''), text: String(data.message ?? '').slice(0, 4096), kind: 'sc', sc: { id: String(data.id), price, start, end } }
  }
  if (command === 'SEND_GIFT')
    return { id, uid: String(data?.uid ?? ''), name: String(data?.uname ?? ''), text: `${String(data?.giftName ?? '')} × ${Number(data?.num) || 1}`, kind: 'gift', gift: { id: Number(data?.giftId), count: Number(data?.num) || 1, image: liveAssetUrl(data?.gift_info?.webp || data?.gift_info?.img_basic) } }
  if (command === 'INTERACT_WORD' && data?.msg_type === 1)
    return { id, uid: String(data?.uid ?? ''), name: String(data?.uname ?? ''), text: '', kind: 'entry' }
}
