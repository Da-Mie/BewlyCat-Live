import browser from 'webextension-polyfill'

import type { LiveClientRequest, LiveSession } from '~/constants/liveClient'
import { LIVE_CLIENT_OPEN, LIVE_CLIENT_PAGE, LIVE_CLIENT_REQUEST } from '~/constants/liveClient'
import { readNativeLiveFilters } from '~/utils/liveNativeFilters'
import { parseLiveRoomId, readLiveRoom } from '~/utils/liveRoom'
import { onMessage } from '~/utils/messaging'

import { createLiveCommerce } from './liveCommerce'
import { withRequestTimeout } from './requestTimeout'
import { addWbiSign, getWbiKeys, initWbiKeys } from './wbiSign'

const LIVE_ORIGIN = 'https://live.bilibili.com'
const API_ORIGIN = 'https://api.live.bilibili.com'
const LIVE_HEADER_RULE = 1201
const LIVE_DOMAINS = ['api.live.bilibili.com', 'chat.bilibili.com', 'bilivideo.com', 'bilivideo.cn', 'acgvideo.com', 'hdslb.com']

async function configureHeaders() {
  const extensionHost = new URL(browser.runtime.getURL('')).hostname
  if (browser.declarativeNetRequest) {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [LIVE_HEADER_RULE],
      addRules: [{
        id: LIVE_HEADER_RULE,
        priority: 4,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'referer', operation: 'set', value: `${LIVE_ORIGIN}/` },
            { header: 'origin', operation: 'set', value: LIVE_ORIGIN },
          ],
        },
        condition: {
          initiatorDomains: [extensionHost],
          requestDomains: LIVE_DOMAINS,
          resourceTypes: ['xmlhttprequest', 'media', 'websocket'],
        },
      }],
    })
  }
  else {
    browser.webRequest.onBeforeSendHeaders.addListener((details) => {
      if (!details.originUrl?.startsWith(browser.runtime.getURL('')) && !details.documentUrl?.startsWith(browser.runtime.getURL('')))
        return
      const headers = (details.requestHeaders ?? []).filter(item => !['origin', 'referer'].includes(item.name.toLowerCase()))
      headers.push({ name: 'Origin', value: LIVE_ORIGIN }, { name: 'Referer', value: `${LIVE_ORIGIN}/` })
      return { requestHeaders: headers }
    }, { urls: LIVE_DOMAINS.map(domain => `*://*.${domain}/*`) }, ['blocking', 'requestHeaders'])
  }
}

async function getSession(): Promise<LiveSession> {
  const [uid, buvid] = await Promise.all([
    browser.cookies.get({ url: LIVE_ORIGIN, name: 'DedeUserID' }),
    browser.cookies.get({ url: LIVE_ORIGIN, name: 'buvid3' }),
  ])
  return { uid: uid?.value ?? '0', buvid: buvid?.value ?? '' }
}

async function getLiveData(path: string, params: Record<string, unknown>, signal: AbortSignal, sign = false) {
  if (sign && !getWbiKeys())
    await initWbiKeys()
  const query = new URLSearchParams(Object.entries(sign ? addWbiSign(params) : params).map(([key, value]) => [key, String(value)]))
  const response = await fetch(`${API_ORIGIN}${path}?${query}`, { credentials: 'include', signal })
  if (!response.ok)
    throw new Error(`HTTP ${response.status}`)
  const value = await response.json()
  if (value.code !== 0)
    throw new Error(`${value.message || 'Live API error'} (${value.code})`)
  return value.data
}

async function postLiveData(path: string, params: Record<string, unknown>, uid: string, signal: AbortSignal) {
  const csrf = await browser.cookies.get({ url: LIVE_ORIGIN, name: 'bili_jct' })
  if (!csrf || uid === '0' || (await getSession()).uid !== uid)
    throw new Error('Live account changed or login required')
  signal.throwIfAborted()
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: 'POST',
    credentials: 'include',
    signal,
    body: new URLSearchParams(Object.entries({ ...params, csrf: csrf.value, csrf_token: csrf.value }).map(([key, value]) => [key, String(value)])),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status}`)
  const value = await response.json()
  if (value.code !== 0)
    throw new Error(`${value.message || value.msg || 'Request rejected'} (${value.code})`)
  return value.data
}

export function setupLiveClient() {
  const ready = configureHeaders()
  const commerce = createLiveCommerce({ get: getLiveData, post: postLiveData, session: getSession })
  // Keep rejection handled until a page request can display it.
  void ready.catch(error => console.warn('[BewlyCat] Live request headers unavailable.', error))

  onMessage(LIVE_CLIENT_OPEN, async (value: { roomId?: string, active?: boolean, replaceCurrent?: boolean }, sender) => {
    const roomId = parseLiveRoomId(value?.roomId)
    if (!roomId)
      throw new Error('Invalid live room')
    const url = new URL(browser.runtime.getURL(LIVE_CLIENT_PAGE))
    url.searchParams.set('room', roomId)
    if (value.replaceCurrent && sender?.tab?.id !== undefined && parseLiveRoomId(sender.url) === roomId)
      return browser.tabs.update(sender.tab.id, { url: url.href })
    return browser.tabs.create({ url: url.href, active: value.active !== false, windowId: sender?.tab?.windowId })
  })

  onMessage(LIVE_CLIENT_REQUEST, async (request: LiveClientRequest, sender) => {
    if (sender?.url?.split(/[?#]/, 1)[0] !== browser.runtime.getURL(LIVE_CLIENT_PAGE))
      return { ok: false, error: 'Invalid live client source' }
    try {
      await ready
      if (request.action === 'session')
        return { ok: true, data: await getSession() }
      const roomId = parseLiveRoomId(request.roomId)
      if (!roomId)
        throw new Error('Invalid live room')
      const data = await withRequestTimeout(async (signal) => {
        if (['offers', 'quote', 'purchase', 'giftAssets'].includes(request.action))
          return commerce(request, roomId, String(sender.tab?.id ?? sender.url), signal)
        if (request.action === 'filters') {
          const session = await getSession()
          if (session.uid === '0')
            return { uid: '0', keywords: [], blockedUids: [] }
          const value = await getLiveData('/xlive/web-room/v1/index/getInfoByUser', {
            room_id: roomId,
            from: 0,
            not_mock_enter_effect: 1,
            web_location: 444.8,
          }, signal, true)
          if ((await getSession()).uid !== session.uid)
            throw new Error('Live account changed')
          return readNativeLiveFilters(value, session.uid)
        }
        if (request.action === 'room') {
          const [play, details] = await Promise.all([
            getLiveData('/xlive/web-room/v2/index/getRoomPlayInfo', {
              room_id: roomId,
              protocol: '0,1',
              format: '0,1,2',
              codec: '0',
              qn: Number.isInteger(request.quality) ? Math.max(0, Math.min(30000, request.quality!)) : 10000,
              platform: 'web',
              ptype: 8,
              web_location: 444.8,
            }, signal, true),
            getLiveData('/xlive/web-room/v1/index/getInfoByRoom', { room_id: roomId }, signal)
              .catch(() => getLiveData('/xlive/web-room/v1/index/getH5InfoByRoom', { room_id: roomId }, signal).catch(() => null)),
          ])
          return readLiveRoom(play, details)
        }
        if (request.action === 'chat') {
          const [auth, session] = await Promise.all([
            getLiveData('/xlive/web-room/v1/index/getDanmuInfo', { id: roomId, web_location: 444.8 }, signal, true),
            getSession(),
          ])
          const servers = (auth.host_list ?? []).filter((host: any) => typeof host.host === 'string' && host.host.endsWith('.chat.bilibili.com') && Number.isInteger(host.wss_port)).map((host: any) => `wss://${host.host}:${host.wss_port}/sub`)
          if (!auth.token || !servers.length)
            throw new Error('Live chat server unavailable')
          return { token: String(auth.token), servers, ...session }
        }
        if (request.action === 'history')
          return getLiveData('/xlive/web-room/v1/dM/gethistory', { roomid: roomId }, signal)
        if (request.action === 'send') {
          const text = String(request.text ?? '').trim()
          if (!request.expectedUid || !text || [...text].length > 100)
            throw new Error('Login required or invalid message')
          await postLiveData('/msg/send', {
            roomid: roomId,
            msg: text,
            color: '16777215',
            fontsize: '25',
            mode: '1',
            rnd: String(Math.floor(Date.now() / 1000)),
            bubble: '0',
          }, request.expectedUid, signal)
          return null
        }
        throw new Error('Unknown live action')
      })
      return { ok: true, data }
    }
    catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
