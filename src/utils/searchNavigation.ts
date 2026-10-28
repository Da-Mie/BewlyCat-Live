import { IFRAME_SEARCH_NAVIGATION } from '~/constants/globalEvents'
import { settings } from '~/logic'
import { isActualHomepage, isHomePage, isInIframe } from '~/utils/main'
import { openLinkInBackground } from '~/utils/tabs'

const NATIVE_SEARCH_CATEGORY_BY_PATH: Record<string, string> = {
  article: 'article',
  bangumi: 'bangumi',
  live: 'live',
  media_bangumi: 'bangumi',
  media_ft: 'media_ft',
  movie: 'media_ft',
  upuser: 'user',
  user: 'user',
  video: 'video',
}

export function shouldUsePluginSearchResultsPage(): boolean {
  return settings.value.usePluginSearchResultsPage
    && !settings.value.useOriginalBilibiliHomepage
}

/** 从空 URL 构造搜索链接，避免继承当前页追踪参数。 */
export function buildNativeSearchUrl(keyword: string): string {
  const normalized = keyword.trim()
  const targetUrl = new URL('https://search.bilibili.com/all')

  if (normalized)
    targetUrl.searchParams.set('keyword', normalized)

  return targetUrl.toString()
}

/** 构建关键词搜索链接的唯一入口： 开启插件搜索页时跳扩展内搜索页，否则跳 B 站原生搜索页 */
export function buildKeywordSearchUrl(keyword: string): string {
  const encoded = encodeURIComponent(keyword)

  if (shouldUsePluginSearchResultsPage())
    return `https://www.bilibili.com/?page=SearchResults&keyword=${encoded}`

  return buildNativeSearchUrl(keyword)
}

const PLUGIN_SEARCH_RESET_PARAMS = [
  'category',
  'pn',
  'user_order',
  'user_type',
  'search_type',
  'live_room_order',
  'live_user_order',
] as const

/** 开启插件搜索结果页时，在当前插件首页就地切到搜索结果， 或从其他 B 站页面跳到插件搜索结果。返回 true 表示已接管导航。 */
export function navigateToPluginSearchResults(keyword: string): boolean {
  if (!shouldUsePluginSearchResultsPage())
    return false

  const normalized = keyword.trim()
  if (!normalized)
    return false

  const targetUrl = `https://www.bilibili.com/?page=SearchResults&keyword=${encodeURIComponent(normalized)}`

  if (isInIframe()) {
    // 抽屉的 sandbox 禁止直接导航顶层窗口，由持有 iframe 的父页面处理。
    window.parent.postMessage({ type: IFRAME_SEARCH_NAVIGATION, keyword: normalized }, '*')
    return true
  }

  if (!isHomePage()) {
    window.location.assign(targetUrl)
    return true
  }

  const params = new URLSearchParams(window.location.search)
  params.set('page', 'SearchResults')
  params.set('keyword', normalized)
  for (const key of PLUGIN_SEARCH_RESET_PARAMS)
    params.delete(key)

  window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`)
  window.dispatchEvent(new Event('pushstate'))
  return true
}

/** 搜索链接统一构造；后台模式走后台标签页，其余按 target 打开。 */
export function openSearchResults(keyword: string): void {
  const searchUrl = buildKeywordSearchUrl(keyword)
  const mode = settings.value.searchBarLinkOpenMode

  if (mode === 'background') {
    void openLinkInBackground(searchUrl)
    return
  }

  let target = '_blank'
  if (mode === 'currentTabIfNotHomepage')
    target = isActualHomepage() ? '_blank' : '_self'
  else if (mode === 'currentTabIfHomepage')
    target = isActualHomepage() ? '_self' : '_blank'
  else if (mode === 'currentTab')
    target = '_self'

  window.open(searchUrl, target)
}

/** 仅就地打开模式原地接管；新页和后台模式交由调用方打开构造后的链接。 */
export function navigateToPluginSearchResultsInPlace(keyword: string): boolean {
  const mode = settings.value.searchBarLinkOpenMode
  if (
    mode === 'newTab'
    || mode === 'background'
    || (mode === 'currentTabIfNotHomepage' && isActualHomepage())
    || (mode === 'currentTabIfHomepage' && !isActualHomepage())
  ) {
    return false
  }

  return navigateToPluginSearchResults(keyword)
}

/**
 * Convert a Bilibili native search URL into BewlyCat's built-in search results
 * URL. Returning null leaves unsupported or keyword-less pages untouched.
 */
export function getPluginSearchResultsUrl(value: string): string | null {
  try {
    const sourceUrl = new URL(value)
    if (
      (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:')
      || sourceUrl.hostname !== 'search.bilibili.com'
    ) {
      return null
    }

    const keyword = sourceUrl.searchParams.get('keyword')?.trim()
    if (!keyword)
      return null

    const targetUrl = new URL('https://www.bilibili.com/')
    targetUrl.searchParams.set('page', 'SearchResults')
    targetUrl.searchParams.set('keyword', keyword)

    const nativeCategory = sourceUrl.pathname.split('/').filter(Boolean)[0]?.toLowerCase()
    const pluginCategory = nativeCategory && NATIVE_SEARCH_CATEGORY_BY_PATH[nativeCategory]
    if (pluginCategory)
      targetUrl.searchParams.set('category', pluginCategory)

    return targetUrl.toString()
  }
  catch {
    return null
  }
}
