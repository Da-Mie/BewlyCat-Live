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
const paused = ref(true)
const position = ref(0)
const seekRanges = ref<{ start: number, end: number }[]>([])
const timeline = computed(() => seekRanges.value.length ? { start: seekRanges.value[0].start, end: seekRanges.value.at(-1)!.end } : undefined)
const canPictureInPicture = computed(() => !!document.pictureInPictureEnabled && !!video.value?.requestPictureInPicture)
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
  const media = video.value
  if (media && (media.volume !== props.volume || media.muted !== props.muted))
    emit('audioChange', { volume: media.volume, muted: media.muted })
}

function selectPlayer() {
  container.value?.focus({ preventScroll: true })
}

function togglePlayback() {
  if (video.value?.paused)
    void play()
  else
    video.value?.pause()
}

function pause() {
  paused.value = true
  emit('playing', false)
}

function updateTimeline() {
  const media = video.value
  const ranges: { start: number, end: number }[] = []
  if (media) {
    position.value = media.currentTime
    const seekable = media.seekable
    const buffered = media.buffered
    for (let i = 0; i < seekable.length; i++) {
      for (let j = 0; j < buffered.length; j++) {
        const start = Math.max(0, seekable.start(i), buffered.start(j))
        const end = Math.min(seekable.end(i), buffered.end(j)) - 0.1
        if (Number.isFinite(start) && Number.isFinite(end) && end > start)
          ranges.push({ start, end })
      }
    }
  }
  seekRanges.value = ranges
}

function seekTo(target: number) {
  const media = video.value
  if (!media || !Number.isFinite(target) || !Number.isFinite(media.currentTime))
    return
  updateTimeline()
  const current = media.currentTime
  const direction = Math.sign(target - current)
  if (!direction)
    return
  const ranges = direction > 0 ? seekRanges.value : [...seekRanges.value].reverse()
  let next = current
  for (const range of ranges) {
    const candidate = Math.max(range.start, Math.min(range.end, target))
    if ((candidate - current) * direction >= 0)
      next = candidate
    if ((candidate - target) * direction >= 0)
      break
  }
  if (next !== current) {
    media.currentTime = next
    position.value = next
  }
}

function changeVolume(value: number) {
  const media = video.value
  if (!media || !Number.isFinite(value))
    return
  const volume = Math.max(0, Math.min(1, Math.round(value * 100) / 100))
  applyLiveAudio(media, volume, volume === 0)
  audioChanged()
}

function toggleMute() {
  const media = video.value
  if (!media)
    return
  if (media.muted || media.volume === 0) {
    changeVolume(media.volume || 0.05)
  }
  else {
    media.muted = true
    audioChanged()
  }
}

function handleKeydown(event: KeyboardEvent) {
  const media = video.value
  if (!media || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
    || (event.target !== container.value && event.target !== media) || document.querySelector('dialog[open]')) {
    return
  }
  if (event.code === 'Space') {
    event.preventDefault()
    if (!event.repeat)
      togglePlayback()
  }
  else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    seekTo(media.currentTime + (event.key === 'ArrowRight' ? 5 : -5))
  }
  else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault()
    changeVolume((media.muted ? 0 : media.volume) + (event.key === 'ArrowUp' ? 0.05 : -0.05))
  }
}

async function pictureInPicture() {
  if (document.pictureInPictureElement)
    await document.exitPictureInPicture()
  else
    await video.value?.requestPictureInPicture()
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
  paused.value = true
  position.value = 0
  seekRanges.value = []
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
  paused.value = false
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
  <section
    ref="container" class="live-player" :class="{ 'is-paused': paused }" tabindex="0"
    :aria-label="t('live_client.player')" :aria-description="t('live_client.shortcuts')"
    aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Space" @keydown="handleKeydown"
  >
    <video
      ref="video" autoplay playsinline :muted="muted"
      @click="selectPlayer" @dblclick.prevent="togglePlayback"
      @play="paused = false" @playing="playing" @pause="pause" @error="fail(generation)"
      @volumechange="audioChanged" @timeupdate="updateTimeline" @progress="updateTimeline"
      @loadedmetadata="updateTimeline" @durationchange="updateTimeline"
    />
    <slot />
    <div class="player-controls">
      <button type="button" :title="t('live_client.play_pause')" :aria-label="t('live_client.play_pause')" @click="togglePlayback">
        <i :class="paused ? 'i-mingcute:play-fill' : 'i-mingcute:pause-fill'" aria-hidden="true" />
      </button>
      <input
        class="player-seek" type="range" :min="timeline?.start ?? 0" :max="timeline?.end ?? 1" step="5"
        :value="position" :disabled="!timeline" :aria-label="t('live_client.seek')"
        @input="seekTo(Number(($event.currentTarget as HTMLInputElement).value))"
      >
      <button type="button" :title="t('live_client.mute')" :aria-label="t('live_client.mute')" :aria-pressed="muted || volume === 0" @click="toggleMute">
        <i :class="muted || volume === 0 ? 'i-mingcute:volume-mute-line' : 'i-mingcute:volume-line'" aria-hidden="true" />
      </button>
      <input
        class="player-volume" type="range" min="0" max="1" step="0.05"
        :value="muted ? 0 : volume"
        :aria-label="t('live_client.volume')" @input="changeVolume(Number(($event.currentTarget as HTMLInputElement).value))"
      >
      <span class="player-volume-value">{{ Math.round((muted ? 0 : volume) * 100) }}%</span>
      <button v-if="canPictureInPicture" type="button" :title="t('live_client.picture_in_picture')" :aria-label="t('live_client.picture_in_picture')" @click="pictureInPicture().catch(() => {})">
        <i class="i-mingcute:display-line" aria-hidden="true" />
      </button>
    </div>
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
.live-player:focus {
  outline: 2px solid var(--bew-theme-color);
  outline-offset: -2px;
}
video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: default;
  touch-action: manipulation;
}
.player-controls {
  position: absolute;
  inset: auto 0 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--bew-space-2);
  padding: var(--bew-space-3);
  color: #fff;
  background: linear-gradient(#0009, #000d);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--bew-duration-fast);
  button {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--bew-control-height);
    height: var(--bew-control-height);
    border: 0;
    border-radius: var(--bew-control-radius);
    background: transparent;
    color: inherit;
    font-size: var(--bew-icon-size-lg);
    cursor: pointer;
    &:hover {
      background: #ffffff24;
    }
  }
  input {
    min-width: 0;
    accent-color: var(--bew-theme-color);
    cursor: pointer;
  }
  :focus-visible {
    outline: 2px solid var(--bew-theme-color);
    outline-offset: 2px;
  }
}
.player-seek {
  flex: 1;
  &:disabled {
    cursor: default;
    opacity: 0.3;
  }
}
.player-volume {
  width: 64px;
}
.player-volume-value {
  min-width: 4ch;
  font-size: var(--bew-font-size-caption);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.live-player:hover .player-controls,
.live-player:focus-within .player-controls,
.live-player.is-paused .player-controls {
  opacity: 1;
  pointer-events: auto;
}
.player-state {
  position: absolute;
  inset: 0;
  z-index: 3;
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
  z-index: 4;
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
  .fullscreen-button,
  .player-controls {
    opacity: 1;
    pointer-events: auto;
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
