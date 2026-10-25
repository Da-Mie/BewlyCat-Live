import { useNow, usePreferredDark } from '@vueuse/core'
import { computed, watchEffect } from 'vue'

import { settings } from '~/logic'

export function useLiveTheme() {
  const preferred = usePreferredDark()
  const now = useNow({ interval: 30000 })
  const isDark = computed(() => {
    const theme = settings.value.theme
    if (theme === 'dark' || theme === 'light')
      return theme === 'dark'
    if (theme === 'scheduled') {
      const minutes = now.value.getHours() * 60 + now.value.getMinutes()
      const parse = (value: string) => {
        const [hours, minute] = value.split(':').map(Number)
        return hours * 60 + minute
      }
      const start = parse(settings.value.themeScheduleStart)
      const end = parse(settings.value.themeScheduleEnd)
      const light = start === end || (start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end)
      return !light
    }
    return preferred.value
  })
  watchEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', isDark.value)
    root.style.colorScheme = isDark.value ? 'dark' : 'light'
    root.style.setProperty('--bew-dark-base-color', settings.value.darkModeBaseColor)
    root.style.setProperty('--bew-theme-color', settings.value.themeColor)
    root.classList.toggle('disable-frosted-glass', !settings.value.enableFrostedGlass)
    root.classList.toggle('disable-shadow', settings.value.disableShadow)
    root.classList.toggle('modify-fonts', settings.value.customizeFont !== 'default')
    if (settings.value.customizeFont === 'custom' && settings.value.fontFamily)
      root.style.setProperty('--bew-custom-fonts', settings.value.fontFamily)
    else
      root.style.removeProperty('--bew-custom-fonts')
  })
  return {
    isDark,
    toggleDark: () => {
      settings.value.theme = isDark.value ? 'light' : 'dark'
    },
  }
}
