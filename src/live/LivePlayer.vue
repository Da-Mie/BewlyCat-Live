<script setup lang="ts">
import type flvjs from 'flv.js'
import type Hls from 'hls.js'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '~/components/Button.vue'
import { applyLiveAudio } from '~/utils/livePreferences'
import type { LiveStream } from '~/utils/liveRoom'

const props = withDefaults(defineProps<{ streams: LiveStream[], sourceId: string, volume?: number, muted?: boolean }>(), { volume: 1, muted: true })
const emit = defineEmits<{ 'update:sourceId': [value: string], 'playing': [value: boolean], 'refresh': [], 'audioChange': [value: { volume: number, muted: boolean }] }>()
const { t } = useI18n()
const video = ref<HTMLVideoElement>()
const container = ref<HTMLElement>()
const loading = ref(false)
const failed = ref(false)
const blocked = ref(false)
const source = computed(() => props.streams.find(item => item.id === props.sourceId) ?? props.streams[0])
let hls: Hls | undefined
let flv: flvjs.Player | undefined
let generation = 0
let watchdog: ReturnType<typeof setTimeout> | undefined
let attempted = new Set<string>()

function applyAudio() {
  const media = video.value
  if (media)
    applyLiveAudio(media, props.volume, props.muted)
}
function audioChanged() {
  if (video.value)
    emit('audioChange', { volume: video.value.volume, muted: video.value.muted })
}

function cleanup() {
  clearTimeout(watchdog)
  hls?.destroy()
  hls = undefined
  if (flv) {
    flv.pause()
    flv.unload()
    flv.detachMediaElement()
    flv.destroy()
    flv = undefined
  }
  if (video.value) {
    video.value.pause()
    video.value.removeAttribute('src')
    video.value.load()
  }
  emit('playing', false)
}

async function play(id = generation) {
  if (!video.value || id !== generation)
    return
  try {
    await video.value.play()
    if (id === generation)
      blocked.value = false
  }
  catch (error) {
    if (id !== generation)
      return
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      clearTimeout(watchdog)
      blocked.value = true
      loading.value = false
    }
  }
}

function fail(id: number) {
  if (id !== generation)
    return
  const next = props.streams.find(item => !attempted.has(item.id))
  if (next) {
    emit('update:sourceId', next.id)
    return
  }
  generation++
  cleanup()
  loading.value = false
  failed.value = true
}

async function load() {
  const id = ++generation
  cleanup()
  const media = video.value
  const selected = source.value
  if (!media || !selected)
    return
  applyAudio()
  loading.value = true
  failed.value = blocked.value = false
  attempted.add(selected.id)
  watchdog = setTimeout(() => fail(id), 15000)
  try {
    if (selected.format === 'hls') {
      const Hls = (await import('hls.js')).default
      if (id !== generation)
        return
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false, lowLatencyMode: true, backBufferLength: 30, manifestLoadingMaxRetry: 1, fragLoadingMaxRetry: 2 })
        let recovered = false
        hls.on(Hls.Events.MANIFEST_PARSED, () => void play(id))
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || id !== generation)
            return
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true
            hls?.recoverMediaError()
          }
          else {
            fail(id)
          }
        })
        hls.loadSource(selected.url)
        hls.attachMedia(media)
      }
      else if (media.canPlayType('application/vnd.apple.mpegurl')) {
        media.src = selected.url
        void play(id)
      }
      else {
        fail(id)
      }
    }
    else if (selected.format === 'flv') {
      const flvjs = (await import('flv.js')).default
      if (id !== generation)
        return
      if (!flvjs.isSupported()) {
        fail(id)
        return
      }
      flv = flvjs.createPlayer({ type: 'flv', isLive: true, url: selected.url }, {
        enableWorker: false,
        enableStashBuffer: false,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
      })
      flv.on(flvjs.Events.ERROR, () => fail(id))
      flv.attachMediaElement(media)
      flv.load()
      void play(id)
    }
    else {
      fail(id)
    }
  }
  catch {
    fail(id)
  }
}

watch(() => props.streams, () => {
  attempted = new Set()
})
watch([video, source], () => void load(), { flush: 'post' })
watch([() => props.volume, () => props.muted], applyAudio)
onBeforeUnmount(() => {
  generation++
  cleanup()
})
function playing() {
  clearTimeout(watchdog)
  loading.value = blocked.value = failed.value = false
  emit('playing', true)
}
async function fullscreen() {
  if (document.fullscreenElement)
    await document.exitFullscreen()
  else
    await container.value?.requestFullscreen()
}
</script>

<template>
  <section ref="container" class="live-player" :aria-label="t('live_client.player')">
    <video
      ref="video" controls autoplay playsinline :muted="muted"
      @playing="playing" @pause="emit('playing', false)" @error="fail(generation)"
      @volumechange="audioChanged"
    />
    <slot />
    <div v-if="loading || failed || blocked" class="player-state" role="status">
      <template v-if="loading">
        <span class="player-loader" aria-hidden="true" /><span>{{ t('live_client.loading_stream') }}</span>
      </template>
      <template v-else-if="blocked">
        <i class="i-mingcute:play-circle-line player-state-icon" aria-hidden="true" />
        <p>{{ t('live_client.autoplay_hint') }}</p>
        <Button type="primary" @click="play()">
          {{ t('live_client.start_playing') }}
        </Button>
      </template>
      <template v-else>
        <p>{{ t('live_client.player_failed') }}</p>
        <Button type="primary" @click="emit('refresh')">
          {{ t('live_client.retry') }}
        </Button>
      </template>
    </div>
    <button class="fullscreen-button" type="button" :aria-label="t('live_client.fullscreen')" :title="t('live_client.fullscreen')" @click="fullscreen().catch(() => {})">
      <i class="i-mingcute:fullscreen-line" aria-hidden="true" />
    </button>
  </section>
</template>

<style scoped lang="scss">
.live-player {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: inherit;
  background: #000;
}
video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.player-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--bew-space-3);
  padding: var(--bew-space-6);
  text-align: center;
  color: #fff;
  background: #0009;
}
.fullscreen-button:focus-visible {
  outline: 2px solid var(--bew-theme-color);
}
.fullscreen-button {
  display: grid;
  place-items: center;
  position: absolute;
  top: var(--bew-space-3);
  right: var(--bew-space-3);
  opacity: 0;
  width: var(--bew-control-height);
  height: var(--bew-control-height);
  padding: 0;
  border: 1px solid #ffffff30;
  border-radius: var(--bew-control-radius);
  color: #fff;
  background: #151515c9;
  font-size: var(--bew-icon-size-md);
  cursor: pointer;
  transition:
    opacity var(--bew-duration-fast),
    background-color var(--bew-duration-fast);
}
.fullscreen-button:hover {
  background: #333;
}
.player-state p {
  max-width: 440px;
  font-size: var(--bew-font-size-control);
  line-height: var(--bew-line-height-body);
}
.player-state-icon {
  font-size: var(--bew-icon-size-xl);
}
.player-loader {
  width: 24px;
  height: 24px;
  border: 2px solid #ffffff40;
  border-top-color: #fff;
  border-radius: 50%;
  animation: player-spin 1s linear infinite;
}
@keyframes player-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .player-loader {
    animation: none;
  }
}
@media (hover: none) {
  .fullscreen-button {
    opacity: 1;
  }
}
.live-player:hover .fullscreen-button,
.fullscreen-button:focus-visible {
  opacity: 1;
}
.live-player:fullscreen {
  width: 100vw;
  height: 100dvh;
  border-radius: 0;
}
</style>
