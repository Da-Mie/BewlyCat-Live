import browser from 'webextension-polyfill'

import type { LiveClientRequest } from '~/constants/liveClient'
import { LIVE_CLIENT_REQUEST } from '~/constants/liveClient'

export async function liveRequest<T>(request: LiveClientRequest): Promise<T> {
  const response = await browser.runtime.sendMessage({ type: LIVE_CLIENT_REQUEST, data: request }) as { ok: boolean, data?: T, error?: string }
  if (!response?.ok)
    throw new Error(response?.error || 'Live background unavailable')
  return response.data as T
}
