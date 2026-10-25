import { nextTick, onBeforeUnmount, ref } from 'vue'

export function useLiveSettingsDialog() {
  const dialog = ref<HTMLDialogElement>()
  const panel = ref<'filters' | 'layout'>('filters')
  const dialogOpen = ref(false)
  const dialogEntering = ref(false)
  let dialogVersion = 0
  let cancelDialogEnter: (() => void) | undefined

  async function openSettings(value: 'filters' | 'layout') {
    panel.value = value
    cancelDialogEnter?.()
    const version = ++dialogVersion
    dialogEntering.value = true
    dialog.value?.showModal()
    if (!dialogOpen.value) {
      // Native showModal() and the visible class in one paint skip the backdrop's
      // initial state. Let the open dialog paint before starting the shared fade.
      await new Promise<void>((resolve) => {
        let frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            cancelDialogEnter = undefined
            resolve()
          })
        })
        cancelDialogEnter = () => {
          cancelAnimationFrame(frame)
          cancelDialogEnter = undefined
          resolve()
        }
      })
    }
    if (version !== dialogVersion)
      return
    dialogEntering.value = false
    dialogOpen.value = true
    await nextTick()
    if (version !== dialogVersion)
      return
    dialog.value?.querySelector<HTMLButtonElement>('[data-active="true"]')?.focus({ preventScroll: true })
  }
  function closeSettings() {
    dialogVersion++
    cancelDialogEnter?.()
    dialogEntering.value = false
    dialogOpen.value = false
    // Escape/close can arrive before the entering panel has been rendered.
    // In that case there is no leave transition to close the native modal.
    if (!dialog.value?.querySelector('.dialog-panel'))
      finishSettingsClose()
  }
  function finishSettingsClose() {
    if (!dialogOpen.value && !dialogEntering.value)
      dialog.value?.close()
  }
  function onSettingsClosed() {
    // An old native close event may arrive after the dialog has been reopened.
    if (dialog.value?.open)
      return
    closeSettings()
  }
  onBeforeUnmount(() => {
    closeSettings()
    dialog.value?.close()
  })

  return { dialog, panel, dialogOpen, dialogEntering, openSettings, closeSettings, finishSettingsClose, onSettingsClosed }
}
