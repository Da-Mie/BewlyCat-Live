import browser from 'webextension-polyfill'

import { LIVE_CLIENT_OPEN } from '../constants/liveClient'
import { parseLiveRoomId, shouldOpenNewLiveRoom } from '../utils/liveRoom'

async function start() {
  const roomId = parseLiveRoomId(location.href)
  if (!roomId || window !== window.top)
    return
  const stored = await browser.storage.local.get('settings').catch(() => ({} as { settings?: unknown }))
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (shouldOpenNewLiveRoom(location.href, stored.settings, navigation?.type)) {
    try {
      // Use the existing tab; back/forward navigation and explicit native links stay native.
      await browser.runtime.sendMessage({ type: LIVE_CLIENT_OPEN, data: { roomId, replaceCurrent: true } })
      return
    }
    catch {
      // A failed handoff must leave the original room usable.
    }
  }
  if (!document.body)
    await new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
  if (document.getElementById('bewly-live-launcher'))
    return
  const host = document.createElement('div')
  host.id = 'bewly-live-launcher'
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = ':host{position:fixed;left:16px;bottom:16px;z-index:1001}button{font:500 13px/18px system-ui;padding:12px 16px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#0f172a;cursor:pointer;box-shadow:0 4px 12px #0002;white-space:nowrap}button:focus-visible{outline:2px solid #00aeec}button:disabled{opacity:.6}@media(prefers-color-scheme:dark){button{background:#26282d;color:#f0f1f5;border-color:#ffffff1f}}'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = /^(?:zh|cmn)/i.test(navigator.language) ? '使用 BewlyCat Live' : 'Watch in BewlyCat Live'
  button.title = button.textContent ?? ''
  button.addEventListener('click', () => {
    button.disabled = true
    void browser.runtime.sendMessage({ type: LIVE_CLIENT_OPEN, data: { roomId, replaceCurrent: true } }).catch(() => {
      button.textContent = /^(?:zh|cmn)/i.test(navigator.language) ? '请刷新页面后重试' : 'Refresh this page and try again'
    }).finally(() => { button.disabled = false })
  })
  root.append(style, button)
  document.body.append(host)
}

void start()
