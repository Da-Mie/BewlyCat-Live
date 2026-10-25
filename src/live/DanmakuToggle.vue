<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import danmakuOff from './icons/danmaku-off.svg?raw'
import danmakuOn from './icons/danmaku-on.svg?raw'

const enabled = defineModel<boolean>({ required: true })
const { t } = useI18n()
</script>

<template>
  <button
    class="danmaku-toggle live-tool-button" type="button" role="switch" :aria-checked="enabled"
    :aria-label="t('live_client.danmaku')" :title="t(enabled ? 'live_client.danmaku_disable' : 'live_client.danmaku_enable')"
    @click="enabled = !enabled"
  >
    <span class="native-danmaku-icon" aria-hidden="true" v-html="enabled ? danmakuOn : danmakuOff" />
  </button>
</template>

<style scoped lang="scss">
.native-danmaku-icon {
  display: block;
  width: 24px;
  height: 24px;
  :deep(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  :deep([fill="white"]) {
    fill: currentColor;
  }
}
</style>
