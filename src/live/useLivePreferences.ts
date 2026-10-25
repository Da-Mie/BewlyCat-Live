import { onBeforeUnmount, watch } from 'vue'

import { settings } from '~/logic'
import type { LivePreferences } from '~/utils/livePreferences'
import { normalizeLivePreferences } from '~/utils/livePreferences'

export function useLivePreferences() {
  let pending: Partial<LivePreferences> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  function flush() {
    clearTimeout(timer)
    if (pending && settings.value.liveRoomRememberPreferences) {
      const value = normalizeLivePreferences({ ...settings.value.liveRoomPreferences, ...pending })
      if (JSON.stringify(value) !== JSON.stringify(settings.value.liveRoomPreferences))
        settings.value.liveRoomPreferences = value
    }
    pending = undefined
  }
  function remember(value: Partial<LivePreferences>) {
    if (!settings.value.liveRoomRememberPreferences)
      return
    pending = { ...pending, ...value }
    clearTimeout(timer)
    timer = setTimeout(flush, 200)
  }
  function restore() {
    return normalizeLivePreferences(settings.value.liveRoomRememberPreferences ? settings.value.liveRoomPreferences : undefined)
  }
  watch(() => settings.value.liveRoomRememberPreferences, (enabled) => {
    if (!enabled) {
      clearTimeout(timer)
      pending = undefined
    }
  })
  window.addEventListener('pagehide', flush)
  onBeforeUnmount(() => {
    flush()
    window.removeEventListener('pagehide', flush)
  })
  return { restore, remember, flush }
}
