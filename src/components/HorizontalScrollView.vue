<script setup lang="ts">
import type { Ref } from 'vue'

import { settings } from '~/logic'

const scrollListWrap = ref<HTMLElement>() as Ref<HTMLElement>

watch([() => settings.value.enableHorizontalScrolling, scrollListWrap], ([enableHorizontalScrolling, scrollListWrap]) => {
  if (!scrollListWrap)
    return

  if (enableHorizontalScrolling)
    scrollListWrap.addEventListener('wheel', handleMouseScroll)
  else
    scrollListWrap.removeEventListener('wheel', handleMouseScroll)
})

function handleMouseScroll(event: WheelEvent) {
  event.preventDefault()
  scrollListWrap.value.scrollLeft += event.deltaY
}
</script>

<template>
  <div relative>
    <div
      ref="scrollListWrap"
      w="[calc(100%+80px)]"
      h="[calc(100%+40px)]"
      m="x--40px y--20px" p="x-40px y-20px"
      overflow-x-scroll
      overflow-y-hidden
      relative
      class="scroll-mask"
    >
      <slot />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.scroll-mask {
  mask-image: linear-gradient(to right, transparent 0, black 40px, black calc(100% - 40px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0, black 40px, black calc(100% - 40px), transparent 100%);
}
</style>
