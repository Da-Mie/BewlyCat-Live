import type { AccountFilterScope, AccountIdentity, AccountLevelFilters } from '~/utils/accountLevelFilter'
import { AccountIdentityCache, decideAccountFilter, needsAccountIdentity, normalizeAccountMid, readAccountIdentity } from '~/utils/accountLevelFilter'

interface CommentRenderer extends HTMLElement {
  data?: unknown
  reply?: unknown
  replyItem?: unknown
  render: (...args: any[]) => unknown
  requestUpdate?: () => void
  connectedCallback?: () => void
  disconnectedCallback?: () => void
}

const patched = Symbol('bewly-account-filter')

export function createPageAccountFilter(getSettings: () => AccountLevelFilters | undefined, ready: Promise<void>) {
  const renderers = new Set<CommentRenderer>()
  const requests = new Map<string, { resolve: (value: AccountIdentity) => void, timer: ReturnType<typeof setTimeout> }>()
  let sequence = 0
  let bootReady = false
  let refreshScheduled = false
  let refreshTree: (() => void) | undefined
  let identityAccount: string | undefined

  function refresh() {
    if (refreshScheduled)
      return
    refreshScheduled = true
    queueMicrotask(() => {
      refreshScheduled = false
      renderers.forEach((renderer) => {
        if (renderer.isConnected)
          renderer.requestUpdate?.()
        else
          renderers.delete(renderer)
      })
      refreshTree?.()
    })
  }

  const cache = new AccountIdentityCache(mid => new Promise((resolve) => {
    const id = `identity:${++sequence}`
    const timer = setTimeout(() => {
      requests.delete(id)
      resolve({ mid })
    }, 6000)
    requests.set(id, { resolve, timer })
    window.postMessage({ type: 'BEWLY_ACCOUNT_LOOKUP', id, mid }, location.origin)
  }), refresh)

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'BEWLY_ACCOUNT_RESULT')
      return
    const request = requests.get(event.data.id)
    if (!request)
      return
    clearTimeout(request.timer)
    requests.delete(event.data.id)
    request.resolve(readAccountIdentity(event.data.identity))
  })

  // Never wait indefinitely for another extension world to initialize.
  const bootTimeout = setTimeout(() => {
    bootReady = true
    refresh()
  }, 2500)
  void ready.then(() => {
    clearTimeout(bootTimeout)
    bootReady = true
    refresh()
  })

  function selfMid() {
    return normalizeAccountMid(document.cookie.match(/(?:^|;\s*)DedeUserID=(\d+)/)?.[1])
  }

  function decision(identity: AccountIdentity, scope: AccountFilterScope): 'allow' | 'block' | 'pending' {
    const settings = getSettings()
    if (!settings)
      return bootReady ? 'allow' : 'pending'
    const self = selfMid()
    if (self !== identityAccount) {
      identityAccount = self
      cache.reset()
    }
    const cached = identity.mid ? cache.peek(identity.mid) : undefined
    const merged = { ...cached, ...Object.fromEntries(Object.entries(identity).filter(([, value]) => value !== undefined)) }
    if (!cached && needsAccountIdentity(merged, settings, scope, self)) {
      void cache.resolve(identity.mid!)
      return 'pending'
    }
    return decideAccountFilter(merged, settings, scope, self)
  }

  function isHidden(renderer: unknown): boolean {
    if (!renderer)
      return false
    const component = renderer as Partial<CommentRenderer>
    return decision(readAccountIdentity(component.data ?? component.reply ?? component.replyItem), 'comments') !== 'allow'
  }

  const pendingThreads = new Set<HTMLElement>()
  const rendererThreads = new WeakMap<CommentRenderer, HTMLElement>()
  let threadSyncScheduled = false
  function scheduleThread(renderer: CommentRenderer) {
    let node: Element | null = renderer
    let thread: HTMLElement | undefined
    const visited = new Set<Element>()
    while (node && !visited.has(node)) {
      visited.add(node)
      if (node.localName === 'bili-comment-thread-renderer') {
        thread = node as HTMLElement
        break
      }
      const root = node.getRootNode?.()
      node = node.parentElement ?? (root && 'host' in root ? (root as ShadowRoot).host : null)
    }
    const previous = rendererThreads.get(renderer)
    if (previous)
      pendingThreads.add(previous)
    if (thread) {
      rendererThreads.set(renderer, thread)
      pendingThreads.add(thread)
    }
    if (threadSyncScheduled || !pendingThreads.size)
      return
    threadSyncScheduled = true
    queueMicrotask(() => {
      threadSyncScheduled = false
      for (const host of pendingThreads) {
        const root = host.shadowRoot
        if (!host.isConnected || !root)
          continue
        let allowed = false
        function scan(scope: ShadowRoot) {
          for (const item of Array.from(scope.querySelectorAll<CommentRenderer>('bili-comment-renderer, bili-comment-reply-renderer, bili-comment-replies-renderer'))) {
            if (item.localName !== 'bili-comment-replies-renderer' && !isHidden(item))
              allowed = true
            if (item.shadowRoot)
              scan(item.shadowRoot)
          }
        }
        scan(root)
        host.toggleAttribute('data-bewly-account-empty', !allowed)
        if (!root.querySelector('#bewly-account-thread-visibility')) {
          const style = document.createElement('style')
          style.id = 'bewly-account-thread-visibility'
          style.textContent = ':host([data-bewly-account-empty]) { display: none !important; }'
          root.append(style)
        }
      }
      pendingThreads.clear()
    })
  }

  function patch(name: string, constructor: unknown) {
    if (!['bili-comment-renderer', 'bili-comment-reply-renderer'].includes(name) || typeof constructor !== 'function')
      return
    const prototype = constructor.prototype as CommentRenderer & { [patched]?: boolean }
    if (Object.hasOwn(prototype, patched) || typeof prototype.render !== 'function')
      return
    Object.defineProperty(prototype, patched, { value: true })
    const original = prototype.render
    const connect = prototype.connectedCallback
    const disconnect = prototype.disconnectedCallback
    prototype.connectedCallback = function () {
      renderers.add(this)
      connect?.call(this)
      this.requestUpdate?.()
    }
    prototype.disconnectedCallback = function () {
      renderers.delete(this)
      scheduleThread(this)
      return disconnect?.call(this)
    }
    prototype.render = function (...args) {
      renderers.add(this)
      const data = this.data ?? this.reply ?? this.replyItem
      const identity = readAccountIdentity(data)
      const state = decision(identity, 'comments')
      this.toggleAttribute('data-bewly-account-filtered', state !== 'allow')
      scheduleThread(this)
      if (state === 'allow')
        return original.apply(this, args)

      const style = document.createElement('style')
      style.textContent = ':host { display: none !important; }'
      return style
    }
  }

  return {
    patch,
    refresh,
    decision,
    isHidden,
    setTreeRefresh: (callback: () => void) => {
      refreshTree = callback
    },
  }
}
