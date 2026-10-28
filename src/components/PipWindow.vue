<script setup lang="ts">
import { useDark } from '~/composables/useDark'
import { releaseIframeMedia } from '~/utils/iframe'

const props = defineProps<{
  url: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const pipWindowRef = ref<HTMLElement | null>(null)
const pipWindowEl = shallowRef<Window | null>(null)
const iframeRef = ref<HTMLIFrameElement | null>(null)
const currentUrl = ref<string>(props.url)
const { isDark } = useDark()
let closing = false
let disposed = false

onMounted(() => {
  void openPipWindow().catch(handleClose)
})
onBeforeUnmount(() => {
  disposed = true
  releaseIframeResources()
  pipWindowEl.value?.removeEventListener('pagehide', handleClose)
  pipWindowEl.value?.close()
})

async function openPipWindow() {
  // https://developer.chrome.com/docs/web-platform/document-picture-in-picture
  if ('documentPictureInPicture' in window) {
    const width = window.innerWidth * 0.8
    const height = window.innerHeight * 0.8
    const pip: Window = await (window as any).documentPictureInPicture.requestWindow({
      disallowReturnToOpener: true,
      width,
      height,
    })
    if (disposed || closing) {
      pip.close()
      return
    }
    pipWindowEl.value = pip
    pip.document.body.style.padding = '0'
    pip.document.body.style.margin = '0'

    if (isDark.value) {
      pip.document.documentElement.style.background = 'var(--bew-bg)'
      pip.document.documentElement.classList.add('dark')
    }

    pip.document.body.append(pipWindowRef.value!)
    pip.addEventListener('pagehide', handleClose, { once: true })
  }
  else {
    const width = window.innerWidth * 0.8
    const height = window.innerHeight * 0.8
    const left = (screen.width / 2) - (width / 2)
    const top = (screen.height / 2) - (height / 2)
    window.open(currentUrl.value, '', `width=${width}px,height=${height}px,left=${left}px,top=${top}px,toolbar=no,location=no,directories=no,menubar=no,scrollbars=yes,resizable=yes,status=no,noopener`)
    await handleClose()
  }
}

function handleOpenInNewTab() {
  window.open(currentUrl.value, '_blank', 'noopener')
  void handleClose()
}

async function handleClose() {
  if (closing || disposed)
    return
  closing = true
  releaseIframeResources()
  pipWindowEl.value?.close()
  await nextTick()
  if (!disposed)
    emit('close')
}

function releaseIframeResources() {
  releaseIframeMedia(iframeRef.value)
  currentUrl.value = 'about:blank'
}
</script>

<template>
  <div ref="pipWindowRef">
    <div pos="absolute top-0 left-0" w-full h-full>
      <div
        pos="relative top-0" z-1 flex="~ items-center justify-end gap-2"
        w-full h="$bew-top-bar-height"
        pointer-events-none
      >
        <Button
          style="
              --b-button-color: var(--bew-elevated-solid);
              --b-button-color-hover: var(--bew-elevated-solid-hover);
            "
          pointer-events-auto
          @click="handleOpenInNewTab"
        >
          <template #left>
            <i i-mingcute:external-link-line />
          </template>
          {{ $t('iframe_drawer.open_in_new_tab') }}
        </Button>
        <Button
          style="
            --b-button-color: var(--bew-elevated-solid);
            --b-button-color-hover: var(--bew-elevated-solid-hover);
          "
          pointer-events-auto
          mr-8
          @click="handleClose"
        >
          <template #left>
            <i i-mingcute:close-line />
          </template>
          {{ $t('iframe_drawer.close') }}
        </Button>
      </div>
      <iframe
        ref="iframeRef"
        :src="url" frameborder="0"
        w-full h-full p-0
        pos="absolute top-0 left-0"
        bg="$bew-bg"
      />
    </div>
  </div>
</template>
