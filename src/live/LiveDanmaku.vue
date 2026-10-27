<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { LiveMessage } from '~/utils/liveRoom'

const host = ref<HTMLElement>()
const items = ref<{ id: string, text: string, color: string, top: number, start: number, duration: number }[]>([])
let width = 0
const reducedMotion = usePreferredReducedMotion()
let observer: ResizeObserver | undefined
let lanes: number[] = []
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width
    lanes = Array.from({ length: Math.max(1, Math.floor(entry.contentRect.height / 32) - 2) }, () => 0)
  })
  observer.observe(host.value!)
})
function push(message: LiveMessage) {
  if (!width || reducedMotion.value === 'reduce' || items.value.length >= 80)
    return
  const now = performance.now()
  const lane = lanes.findIndex(next => next <= now)
  if (lane < 0)
    return
  const text = message.text.slice(0, 200)
  const textWidth = [...text].reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 15 : 8), 0)
  const duration = (width + textWidth) / 100 * 1000
  lanes[lane] = now + (textWidth + 64) / 100 * 1000
  const item = { id: message.id, text, color: message.color ?? '#fff', top: lane * 32 + 16, start: width, duration }
  items.value.push(item)
}
function finish(id: string) {
  items.value = items.value.filter(item => item.id !== id)
}
watch(reducedMotion, () => {
  items.value = []
  lanes.fill(0)
})
onBeforeUnmount(() => observer?.disconnect())
defineExpose({ push })
</script>

<template>
  <div ref="host" class="live-danmaku" aria-hidden="true">
    <span
      v-for="item in items" :key="item.id" :style="{ 'top': `${item.top}px`, 'color': item.color, '--start': `${item.start}px`, 'animationDuration': `${item.duration}ms` }"
      @animationend="finish(item.id)" @animationcancel="finish(item.id)"
    >{{ item.text }}</span>
  </div>
</template>

<style scoped lang="scss">
.live-danmaku {
  position: absolute;
  inset: 0 0 var(--live-control-safe-area, 52px);
  overflow: hidden;
  pointer-events: none;
}
span {
  position: absolute;
  left: 0;
  width: max-content;
  white-space: nowrap;
  font-size: var(--bew-font-size-body);
  line-height: var(--bew-line-height-body);
  font-weight: var(--bew-font-weight-semibold);
  text-shadow:
    0 1px 2px #000,
    1px 0 2px #000,
    -1px 0 2px #000;
  animation: fly linear both;
}
@keyframes fly {
  from {
    transform: translateX(var(--start));
  }
  to {
    transform: translateX(-100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .live-danmaku {
    display: none;
  }
}
</style>
