import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import browser from 'webextension-polyfill'

import type { LiveChatAuth, LiveSession } from '~/constants/liveClient'
import { settings } from '~/logic'
import { lookupAccountIdentity } from '~/utils/accountIdentityLookup'
import { AccountIdentityCache, decideAccountFilter, needsAccountIdentity } from '~/utils/accountLevelFilter'
import type { NativeLiveFilters } from '~/utils/liveNativeFilters'
import { isNativeLiveMessageBlocked } from '~/utils/liveNativeFilters'
import { chooseLiveSource } from '~/utils/livePreferences'
import type { LiveMessage, LiveRoom } from '~/utils/liveRoom'
import { parseLiveRoomId, readLiveMessage } from '~/utils/liveRoom'

import { liveRequest } from './api'
import type { LiveChatState } from './chat'
import { LiveChatConnection } from './chat'
import { LiveMessageDispatcher } from './dispatcher'

export function useLiveRoom(onOverlay: (message: LiveMessage) => void) {
  const room = shallowRef<LiveRoom>()
  const messages = shallowRef<LiveMessage[]>([])
  const superChats = shallowRef<LiveMessage[]>([])
  const giftAssets = shallowRef<Record<string, string>>({})
  const scTimer = setInterval(() => {
    const active = superChats.value.filter(message => message.sc!.end > Date.now())
    if (active.length !== superChats.value.length)
      superChats.value = active
  }, 1000)
  const session = ref<LiveSession>({ uid: '0', buvid: '' })
  const loading = ref(false)
  const error = ref('')
  const chatState = ref<LiveChatState>('closed')
  const chatError = ref('')
  const historyError = ref('')
  const quality = ref(10000)
  const sourceId = ref('')
  const sending = ref(false)
  const sendError = ref('')
  const displayVersion = ref(0)
  const nativeFilterState = ref<'loading' | 'ready' | 'error'>('loading')
  const nativeFilters = shallowRef<NativeLiveFilters>()
  let generation = 0
  let requestVersion = 0
  let historyVersion = 0
  let chatVersion = 0
  let accountVersion = 0
  let nativeFilterVersion = 0
  let lastNativeFilterSync = 0
  const pendingNativeMessages: LiveMessage[] = []
  let bootstrapSuperChats: LiveMessage[] = []
  let sequence = 0
  let connection: LiveChatConnection | undefined
  let dispatcher: LiveMessageDispatcher<LiveMessage> | undefined
  let cookieTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const identities = new AccountIdentityCache(lookupAccountIdentity)

  function setSession(value: LiveSession) {
    const changed = session.value.uid !== value.uid
    if (changed) {
      identities.reset()
      nativeFilters.value = undefined
      pendingNativeMessages.length = 0
      nativeFilterVersion++
      nativeFilterState.value = 'loading'
    }
    session.value = value
    return changed
  }

  async function allow(message: LiveMessage) {
    if (!nativeFilters.value || nativeFilters.value.uid !== session.value.uid || isNativeLiveMessageBlocked(message, nativeFilters.value))
      return false
    if (message.kind === 'entry' && settings.value.liveRoomHideEntryEffects) {
      return false
    }
    let identity = { mid: message.uid, ...identities.peek(message.uid) }
    if (needsAccountIdentity(identity, settings.value.accountLevelFilters, 'liveDanmaku', session.value.uid)) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([identities.resolve(message.uid), new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 1200)
        })])
      }
      finally {
        clearTimeout(timeout)
      }
      identity = { ...identity, ...identities.peek(message.uid) }
    }
    return decideAccountFilter(identity, settings.value.accountLevelFilters, 'liveDanmaku', session.value.uid) === 'allow'
  }

  function newDispatcher(resetOverlay = true) {
    if (resetOverlay) {
      displayVersion.value++
      superChats.value = []
    }
    dispatcher?.close()
    dispatcher = new LiveMessageDispatcher(allow, (message) => {
      if (message.kind === 'entry' && settings.value.liveRoomHideEntryEffects)
        return
      if (message.sc) {
        if (messages.value.some(item => item.sc?.id === message.sc!.id))
          return
        if (message.sc.end > Date.now())
          superChats.value = [...superChats.value.filter(item => item.sc!.end > Date.now()).slice(-19), message]
      }
      if (message.kind !== 'gift' || !settings.value.liveRoomHideGifts)
        messages.value = [...messages.value.slice(-399), message]
      if (!message.history)
        onOverlay(message)
    })
  }

  function dispatch(message: LiveMessage) {
    if (nativeFilterState.value === 'loading') {
      // 规则就绪前最多暂存 256 条候选消息。
      if (pendingNativeMessages.length >= 256)
        pendingNativeMessages.shift()
      pendingNativeMessages.push(message)
    }
    else if (nativeFilterState.value === 'ready') {
      dispatcher?.push(message)
    }
  }

  async function history(roomId: string, version: number) {
    const request = ++historyVersion
    historyError.value = ''
    try {
      const data = await liveRequest<{ room?: any[] }>({ action: 'history', roomId })
      if (version !== generation || request !== historyVersion || disposed)
        return
      for (const item of (data.room ?? []).slice(-100)) {
        dispatch({
          id: `${version}:history:${++sequence}`,
          uid: String(item.uid ?? ''),
          name: String(item.nickname ?? item.uname ?? ''),
          text: String(item.text ?? '').slice(0, 4096),
          kind: 'chat',
          history: true,
        })
      }
    }
    catch (reason) {
      if (version === generation && request === historyVersion)
        historyError.value = reason instanceof Error ? reason.message : String(reason)
    }
  }

  async function syncNativeFilters() {
    const roomId = room.value?.roomId
    if (!roomId || disposed)
      return
    const version = generation
    const request = ++nativeFilterVersion
    const previous = nativeFilters.value?.uid === session.value.uid ? nativeFilters.value : undefined
    pendingNativeMessages.length = 0
    lastNativeFilterSync = Date.now()
    nativeFilters.value = undefined
    nativeFilterState.value = 'loading'
    historyVersion++
    if (!previous)
      messages.value = []
    newDispatcher(!previous)
    try {
      const filters = await liveRequest<NativeLiveFilters>({ action: 'filters', roomId })
      if (disposed || request !== nativeFilterVersion || version !== generation)
        return
      if (filters.uid !== session.value.uid)
        throw new Error('Live account changed')
      nativeFilters.value = filters
      nativeFilterState.value = 'ready'
      if (previous && (previous.keywords.length !== filters.keywords.length
        || previous.blockedUids.length !== filters.blockedUids.length
        || previous.keywords.some(word => !filters.keywords.includes(word))
        || previous.blockedUids.some(uid => !filters.blockedUids.includes(uid)))) {
        messages.value = messages.value.filter(message => !isNativeLiveMessageBlocked(message, filters))
        superChats.value = superChats.value.filter(message => !isNativeLiveMessageBlocked(message, filters))
        displayVersion.value++
      }
      // 规则未变时保留滚动位置和在途弹幕。
      if (!previous || !messages.value.length)
        void history(roomId, version)
      if (!previous) {
        const initial = bootstrapSuperChats
        bootstrapSuperChats = []
        for (const message of initial)
          dispatcher?.push(message)
      }
      for (const message of pendingNativeMessages)
        dispatcher?.push(message)
      pendingNativeMessages.length = 0
    }
    catch {
      if (!disposed && request === nativeFilterVersion && version === generation) {
        nativeFilterState.value = 'error'
        bootstrapSuperChats = []
        messages.value = []
        superChats.value = []
        pendingNativeMessages.length = 0
        displayVersion.value++
        dispatcher?.close()
      }
    }
  }

  function startChat(roomId: string, version: number) {
    const chat = ++chatVersion
    connection?.close()
    chatError.value = ''
    connection = new LiveChatConnection(roomId, async () => {
      const auth = await liveRequest<LiveChatAuth>({ action: 'chat', roomId })
      if (version === generation && chat === chatVersion && setSession(auth))
        void syncNativeFilters()
      return auth
    }, (raw) => {
      if (version !== generation || chat !== chatVersion || disposed)
        return
      if (raw?.cmd === 'SUPER_CHAT_MESSAGE_DELETE') {
        const ids = new Set((Array.isArray(raw.data?.ids) ? raw.data.ids : []).map(String))
        const removed = (message: LiveMessage) => !!message.sc && ids.has(message.sc.id)
        dispatcher?.remove(removed)
        bootstrapSuperChats = bootstrapSuperChats.filter(message => !removed(message))
        for (let index = pendingNativeMessages.length - 1; index >= 0; index--) {
          if (removed(pendingNativeMessages[index]))
            pendingNativeMessages.splice(index, 1)
        }
        messages.value = messages.value.filter(message => !removed(message))
        superChats.value = superChats.value.filter(message => !removed(message))
        return
      }
      const message = readLiveMessage(raw, `${version}:live:${++sequence}`)
      if (message)
        dispatch(message)
      if (String(raw?.cmd).split(':')[0] === 'PREPARING' && room.value)
        room.value = { ...room.value, live: false }
    }, (state, reason) => {
      if (version !== generation || chat !== chatVersion || disposed)
        return
      chatState.value = state
      chatError.value = reason ?? ''
    })
    void connection.start()
  }

  async function load(input: string, preserve = false) {
    const roomId = parseLiveRoomId(input)
    if (!roomId)
      throw new Error('Invalid room ID')
    const version = preserve ? generation : ++generation
    const request = ++requestVersion
    if (!preserve) {
      nativeFilterVersion++
      nativeFilters.value = undefined
      pendingNativeMessages.length = 0
      nativeFilterState.value = 'loading'
      connection?.close()
      dispatcher?.close()
      messages.value = []
      chatState.value = 'closed'
      room.value = undefined
      bootstrapSuperChats = []
      giftAssets.value = {}
      chatError.value = historyError.value = sendError.value = ''
      newDispatcher()
    }
    loading.value = true
    error.value = ''
    try {
      const result = await liveRequest<LiveRoom>({ action: 'room', roomId, quality: quality.value })
      if (version !== generation || request !== requestVersion || disposed)
        return
      const previousId = room.value?.roomId
      const previouslyLocked = room.value?.locked
      if (!preserve)
        bootstrapSuperChats = result.superChats ?? []
      room.value = { ...result, superChats: [] }
      if (result.live && !result.locked && !Object.keys(giftAssets.value).length) {
        void liveRequest<Record<string, string>>({ action: 'giftAssets', roomId: result.roomId }).then((assets) => {
          if (!disposed && version === generation && request === requestVersion)
            giftAssets.value = assets
        }).catch(() => {})
      }
      sourceId.value = chooseLiveSource(result.streams, sourceId.value)
      if (result.streams[0]?.quality)
        quality.value = result.streams[0].quality
      if (!preserve || previousId !== result.roomId || previouslyLocked) {
        if (!result.locked) {
          const account = accountVersion
          const auth = await liveRequest<LiveSession>({ action: 'session' }).catch(() => ({ uid: '0', buvid: '' }))
          // 同房间刷新不取消登录态初始化。
          if (version !== generation || account !== accountVersion || disposed || room.value?.roomId !== result.roomId || room.value.locked)
            return
          setSession(auth)
          void syncNativeFilters()
          startChat(result.roomId, version)
        }
      }
    }
    catch (reason) {
      if (version === generation && request === requestVersion)
        error.value = reason instanceof Error ? reason.message : String(reason)
    }
    finally {
      if (version === generation && request === requestVersion)
        loading.value = false
    }
  }

  function refresh() {
    if (room.value)
      return load(room.value.roomId, true)
  }

  async function send(text: string) {
    if (!room.value || sending.value)
      return false
    const version = generation
    const account = accountVersion
    sending.value = true
    sendError.value = ''
    try {
      await liveRequest({ action: 'send', roomId: room.value.roomId, expectedUid: session.value.uid, text })
      return !disposed && version === generation && account === accountVersion
    }
    catch (reason) {
      if (!disposed && version === generation && account === accountVersion)
        sendError.value = reason instanceof Error ? reason.message : String(reason)
      return false
    }
    finally {
      sending.value = false
    }
  }

  function reconnectChat() {
    if (room.value && !room.value.locked) {
      if (nativeFilterState.value === 'error')
        void syncNativeFilters()
      startChat(room.value.roomId, generation)
    }
  }

  watch(() => [settings.value.accountLevelFilters.liveDanmaku, settings.value.accountLevelFilters.exemptSelf, settings.value.accountLevelFilters.exemptFollowed, settings.value.accountLevelFilters.whitelist], () => {
    messages.value = []
    newDispatcher()
    if (room.value && nativeFilterState.value === 'ready')
      void history(room.value.roomId, generation)
  }, { deep: true })

  watch(() => settings.value.liveRoomHideGifts, (hidden) => {
    if (hidden)
      messages.value = messages.value.filter(message => message.kind !== 'gift')
  })
  watch(() => settings.value.liveRoomHideEntryEffects, (hidden) => {
    if (hidden)
      messages.value = messages.value.filter(message => message.kind !== 'entry')
  })

  const accountChange = (change: browser.Cookies.OnChangedChangeInfoType) => {
    if (change.cookie.name !== 'DedeUserID' || (change.cookie.domain !== 'bilibili.com' && !change.cookie.domain.endsWith('.bilibili.com')))
      return
    const account = ++accountVersion
    chatVersion++
    historyVersion++
    nativeFilterVersion++
    nativeFilters.value = undefined
    pendingNativeMessages.length = 0
    nativeFilterState.value = 'loading'
    connection?.close()
    session.value = { uid: '0', buvid: '' }
    bootstrapSuperChats = []
    identities.reset()
    messages.value = []
    sendError.value = ''
    newDispatcher()
    clearTimeout(cookieTimer)
    cookieTimer = setTimeout(() => {
      void liveRequest<LiveSession>({ action: 'session' }).then((value) => {
        if (!disposed && account === accountVersion) {
          setSession(value)
          void syncNativeFilters()
          reconnectChat()
        }
      }).catch((reason) => {
        if (!disposed && account === accountVersion) {
          nativeFilterState.value = 'error'
          chatState.value = 'error'
          chatError.value = reason instanceof Error ? reason.message : String(reason)
        }
      })
    }, 200)
  }
  browser.cookies.onChanged.addListener(accountChange)
  const refreshNativeFiltersOnReturn = () => {
    if (document.visibilityState !== 'hidden' && Date.now() - lastNativeFilterSync > 1500 && nativeFilterState.value !== 'loading')
      void syncNativeFilters()
  }
  window.addEventListener('focus', refreshNativeFiltersOnReturn)
  document.addEventListener('visibilitychange', refreshNativeFiltersOnReturn)
  onBeforeUnmount(() => {
    disposed = true
    bootstrapSuperChats = []
    clearInterval(scTimer)
    generation++
    nativeFilterVersion++
    pendingNativeMessages.length = 0
    identities.reset()
    connection?.close()
    dispatcher?.close()
    clearTimeout(cookieTimer)
    browser.cookies.onChanged.removeListener(accountChange)
    window.removeEventListener('focus', refreshNativeFiltersOnReturn)
    document.removeEventListener('visibilitychange', refreshNativeFiltersOnReturn)
  })

  return { room, messages, superChats, giftAssets, session, loading, error, chatState, chatError, historyError, nativeFilterState, quality, sourceId, sending, sendError, displayVersion, load, refresh, reconnectChat, syncNativeFilters, send }
}
