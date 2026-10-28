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
      // 先绘制原生遮罩，再启动淡入。
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
    // 面板尚未渲染时，直接关闭原生模态框。
    if (!dialog.value?.querySelector('.dialog-panel'))
      finishSettingsClose()
  }
  function finishSettingsClose() {
    if (!dialogOpen.value && !dialogEntering.value)
      dialog.value?.close()
  }
  function onSettingsClosed() {
    // 忽略重新打开前排队的 close 事件。
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
