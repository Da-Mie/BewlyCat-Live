<script setup lang="ts">
import type flvjs from 'flv.js'
import type Hls from 'hls.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '~/components/Button.vue'
import type { LiveTimeRange } from '~/utils/livePlayback'
import { clampLivePosition, formatLiveTime, isLivePositionAvailable, LIVE_TIMELINE_SECONDS, liveHistorySeconds, livePlaybackPoint, readLiveRanges } from '~/utils/livePlayback'
import { applyLiveAudio } from '~/utils/livePreferences'
import type { LiveStream } from '~/utils/liveRoom'

const props = withDefaults(defineProps<{ streams: LiveStream[], sourceId: string, volume?: number, muted?: boolean }>(), { volume: 1, muted: true })
const emit = defineEmits<{ 'update:sourceId': [value: string], 'playing': [value: boolean], 'refresh': [], 'audioChange': [value: { volume: number, muted: boolean }] }>()
const { t } = useI18n()
const video = ref<HTMLVideoElement>()
const container = ref<HTMLElement>()
const controls = ref<HTMLElement>()
const loading = ref(false)
const failed = ref(false)
const blocked = ref(false)
const paused = ref(true)
const position = ref(0)
const livePosition = ref(0)
const seekRanges = ref<LiveTimeRange[]>([])
const timeline = computed(() => livePosition.value > 0 ? { start: livePosition.value - LIVE_TIMELINE_SECONDS, end: livePosition.value } : undefined)
const scrub = ref<{ start: number, end: number, value: number, pointerId: number, originX: number, changed: boolean }>()
const seekTrack = ref<HTMLElement>()
const seekInput = ref<HTMLInputElement>()
const activePointers = new Set<number>()
const interactions = ref(0)
const buffering = ref(false)
const seeking = ref(false)
const returningLive = ref(false)
const isFullscreen = ref(false)
const actualLag = computed(() => Math.max(0, livePosition.value - position.value))
const atLive = computed(() => !!timeline.value && !paused.value && !buffering.value && !seeking.value && actualLag.value <= 2)
const axis = computed(() => scrub.value ?? timeline.value)
const displayPosition = computed(() => scrub.value?.value ?? (atLive.value ? livePosition.value : position.value))
const seekPercent = computed(() => axis.value ? Math.max(0, Math.min(100, (displayPosition.value - axis.value.start) / LIVE_TIMELINE_SECONDS * 100)) : 0)
const previewAvailable = computed(() => !!scrub.value && isLivePositionAvailable(seekRanges.value, scrub.value.value))
const bufferSegments = computed(() => {
  const bounds = axis.value
  if (!bounds)
    return []
  const duration = bounds.end - bounds.start
  return seekRanges.value.flatMap((range) => {
    const start = Math.max(range.start, bounds.start)
    const end = Math.min(range.end, bounds.end)
    return end > start
      ? [{
          start,
          style: { left: `${(start - bounds.start) / duration * 100}%`, width: `${(end - start) / duration * 100}%` },
          played: `${Math.max(0, Math.min(100, (displayPosition.value - start) / (end - start) * 100))}%`,
        }]
      : []
  })
})
const behindLive = computed(() => scrub.value ? Math.max(0, scrub.value.end - scrub.value.value) : actualLag.value)
const history = computed(() => seekRanges.value.reduce((sum, range) => sum + Math.max(0, Math.min(range.end, livePosition.value) - Math.max(range.start, timeline.value?.start ?? 0)), 0))
const controlsVisible = ref(true)
const keyboardMode = ref(false)
const showToolbar = computed(() => controlsVisible.value || paused.value || loading.value || failed.value || blocked.value || !!scrub.value || interactions.value > 0)
const canPictureInPicture = computed(() => !!document.pictureInPictureEnabled && !!video.value?.requestPictureInPicture)
const source = computed(() => props.streams.find(item => item.id === props.sourceId) ?? props.streams[0])
let hls: Hls | undefined
let flv: flvjs.Player | undefined
let generation = 0
let watchdog: ReturnType<typeof setTimeout> | undefined
let controlsTimer: ReturnType<typeof setTimeout> | undefined
let historyRate = 0
let attempted = new Set<string>()

function keyboardInControls() {
  const active = document.activeElement
  return keyboardMode.value && !!active && !!controls.value?.contains(active)
}

function hideControls() {
  if (paused.value || scrub.value || interactions.value || keyboardInControls())
    return
  if (document.activeElement && controls.value?.contains(document.activeElement))
    container.value?.focus({ preventScroll: true })
  clearTimeout(controlsTimer)
  controlsVisible.value = false
}

function showControls() {
  controlsVisible.value = true
  clearTimeout(controlsTimer)
  if (!paused.value && !scrub.value && !interactions.value)
    controlsTimer = setTimeout(hideControls, 2500)
}

function leavePlayer() {
  hideControls()
}

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
  showControls()
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
  if (media && Number.isFinite(media.currentTime))
    position.value = media.currentTime
  if (media && media.readyState >= 3 && !media.seeking)
    buffering.value = false
  seekRanges.value = media ? readLiveRanges(media) : []
  livePosition.value = livePlaybackPoint(seekRanges.value, hls?.liveSyncPosition, media?.duration ?? Infinity)
  if (atLive.value)
    returningLive.value = false
}

function seekTo(target: number) {
  const media = video.value
  if (!media || !Number.isFinite(target) || !Number.isFinite(media.currentTime))
    return
  updateTimeline()
  const next = clampLivePosition(seekRanges.value, target, media.currentTime)
  if (next !== media.currentTime) {
    media.currentTime = next
    position.value = next
  }
  returningLive.value = false
  showControls()
}

function pointFromPointer(event: PointerEvent) {
  const bounds = axis.value
  const rect = seekTrack.value?.getBoundingClientRect()
  if (!bounds || !rect || rect.width <= 0)
    return
  return bounds.start + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * LIVE_TIMELINE_SECONDS
}

function beginScrub(event: PointerEvent) {
  if (!timeline.value || !event.isPrimary || event.button !== 0 || !seekRanges.value.length)
    return
  event.preventDefault()
  const value = pointFromPointer(event)
  if (value === undefined)
    return
  const rect = seekTrack.value!.getBoundingClientRect()
  const onThumb = Math.abs(value - displayPosition.value) / LIVE_TIMELINE_SECONDS * rect.width <= 12
  scrub.value = { ...timeline.value, value: onThumb ? displayPosition.value : value, pointerId: event.pointerId, originX: event.clientX, changed: !onThumb }
  seekInput.value?.focus({ preventScroll: true })
  seekInput.value?.setPointerCapture(event.pointerId)
  showControls()
}

function moveScrub(event: PointerEvent) {
  const selection = scrub.value
  if (!selection || selection.pointerId !== event.pointerId)
    return
  const value = pointFromPointer(event)
  if (value !== undefined && Math.abs(event.clientX - selection.originX) >= 2) {
    selection.value = value
    selection.changed = true
  }
}

function previewSeek(event: Event) {
  if (scrub.value)
    return
  const value = Number((event.currentTarget as HTMLInputElement).value)
  if (isLivePositionAvailable(seekRanges.value, value))
    seekTo(value)
}

function seekKeydown(event: KeyboardEvent) {
  const bounds = axis.value
  if (!bounds || scrub.value || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing)
    return
  const offsets: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 }
  const target = event.key === 'Home' ? bounds.start : event.key === 'End' ? bounds.end : Object.hasOwn(offsets, event.key) ? position.value + offsets[event.key] : undefined
  if (target === undefined)
    return
  event.preventDefault()
  event.stopPropagation()
  seekTo(target)
}

function finishScrub(cancel = false, event?: PointerEvent) {
  const selection = scrub.value
  if (!selection || (event && event.pointerId !== selection.pointerId))
    return
  if (!cancel && event)
    moveScrub(event)
  scrub.value = undefined
  if (seekInput.value?.hasPointerCapture(selection.pointerId))
    seekInput.value.releasePointerCapture(selection.pointerId)
  if (!cancel && selection.changed) {
    updateTimeline()
    if (isLivePositionAvailable(seekRanges.value, selection.value))
      seekTo(selection.value)
  }
  showControls()
}

function goLive() {
  updateTimeline()
  const media = video.value
  if (!media || !timeline.value)
    return
  returningLive.value = true
  seeking.value = Math.abs(media.currentTime - livePosition.value) > 0.05
  media.currentTime = position.value = livePosition.value
  showControls()
  void play()
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
    || document.querySelector('dialog[open]')) {
    return
  }
  showControls()
  if (event.target !== container.value && event.target !== media)
    return
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
  clearTimeout(controlsTimer)
  controlsVisible.value = true
  activePointers.clear()
  interactions.value = 0
  buffering.value = seeking.value = returningLive.value = false
  scrub.value = undefined
  historyRate = 0
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
  livePosition.value = 0
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
        hls = new Hls({ enableWorker: false, lowLatencyMode: true, backBufferLength: liveHistorySeconds(0), maxBufferSize: 24 * 1024 * 1024, manifestLoadingMaxRetry: 1, fragLoadingMaxRetry: 2 })
        let recovered = false
        hls.on(Hls.Events.MANIFEST_PARSED, () => void play(id))
        hls.on(Hls.Events.FRAG_BUFFERED, (_event, { frag }) => {
          if (id !== generation || !hls || !Number.isFinite(frag.stats.total) || !Number.isFinite(frag.duration) || frag.duration <= 0)
            return
          historyRate = Math.max(historyRate, frag.stats.total / frag.duration)
          hls.config.backBufferLength = liveHistorySeconds(historyRate)
        })
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
        autoCleanupMaxBackwardDuration: 180,
        autoCleanupMinBackwardDuration: 120,
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
function holdControls(event: PointerEvent) {
  activePointers.add(event.pointerId)
  interactions.value = activePointers.size
  showControls()
}
function releaseControls(event: PointerEvent) {
  if (activePointers.delete(event.pointerId)) {
    interactions.value = activePointers.size
    showControls()
  }
}
function abandonInteractions() {
  activePointers.clear()
  interactions.value = 0
  finishScrub(true)
  showControls()
}
function fullscreenChanged() {
  isFullscreen.value = document.fullscreenElement === container.value
}
onMounted(() => {
  document.addEventListener('pointerup', releaseControls, true)
  document.addEventListener('pointercancel', releaseControls, true)
  document.addEventListener('fullscreenchange', fullscreenChanged)
  window.addEventListener('blur', abandonInteractions)
})
watch(paused, showControls)
onBeforeUnmount(() => {
  document.removeEventListener('pointerup', releaseControls, true)
  document.removeEventListener('pointercancel', releaseControls, true)
  document.removeEventListener('fullscreenchange', fullscreenChanged)
  window.removeEventListener('blur', abandonInteractions)
  generation++
  cleanup()
})
function playing() {
  clearTimeout(watchdog)
  loading.value = blocked.value = failed.value = false
  paused.value = false
  buffering.value = false
  updateTimeline()
  showControls()
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
    ref="container" class="live-player" :class="{ 'is-idle': !showToolbar }" tabindex="0"
    :aria-label="t('live_client.player')" :aria-description="t('live_client.shortcuts')"
    aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Space" @keydown="handleKeydown"
    @keydown.capture="keyboardMode = true" @pointerdown.capture="keyboardMode = false"
    @pointerenter="showControls" @pointermove="showControls" @pointerleave="leavePlayer"
    @focusin="showControls" @focusout="showControls"
  >
    <video
      ref="video" autoplay playsinline :muted="muted"
      @click="selectPlayer" @dblclick.prevent="togglePlayback"
      @play="paused = false" @playing="playing" @waiting="buffering = true"
      @seeking="seeking = true" @seeked="seeking = false; updateTimeline()" @pause="pause" @error="fail(generation)"
      @volumechange="audioChanged" @timeupdate="updateTimeline" @progress="updateTimeline"
      @loadedmetadata="updateTimeline" @durationchange="updateTimeline"
    />
    <slot />
    <div
      ref="controls" class="player-controls" :class="{ 'is-visible': showToolbar }" :inert="!showToolbar" :aria-hidden="!showToolbar"
      @pointerdown="holdControls"
    >
      <div class="player-seek-area" :class="{ 'is-scrubbing': !!scrub }" :style="{ '--seek-position': `${seekPercent}%` }">
        <div ref="seekTrack" class="player-track" aria-hidden="true">
          <span
            v-for="range in bufferSegments" :key="range.start" class="player-buffer" :style="range.style"
          ><span class="player-progress" :style="{ width: range.played }" /></span>
          <span v-if="axis && seekRanges.length" class="player-thumb" :style="{ left: `${seekPercent}%` }" />
        </div>
        <span v-if="scrub" class="player-seek-preview">{{ previewAvailable ? `−${formatLiveTime(behindLive)}` : t('live_client.history_unavailable') }}</span>
        <input
          ref="seekInput" class="player-seek" type="range" :min="axis?.start ?? 0" :max="axis?.end ?? 1"
          step="any"
          :value="displayPosition" :disabled="!axis || !seekRanges.length" :aria-label="t('live_client.seek')" :title="t('live_client.history_hint')"
          :aria-valuetext="atLive ? t('live_client.live_edge') : t('live_client.behind_live', { time: formatLiveTime(behindLive) })"
          @pointerdown="beginScrub" @pointermove="moveScrub" @input="previewSeek" @pointerup="finishScrub(false, $event)" @keydown="seekKeydown"
          @pointercancel="finishScrub(true, $event)" @lostpointercapture="finishScrub(true, $event)" @blur="finishScrub(true)"
        >
      </div>
      <div class="player-control-row">
        <button type="button" :title="t('live_client.play_pause')" :aria-label="t('live_client.play_pause')" @click="togglePlayback">
          <i :class="paused ? 'i-mingcute:play-fill' : 'i-mingcute:pause-fill'" aria-hidden="true" />
        </button>
        <button
          class="player-live" :class="{ 'at-live': atLive }" type="button" :disabled="!timeline" :title="t('live_client.return_to_live')"
          @click="goLive"
        >
          <span class="player-live-dot" aria-hidden="true" />
          <span class="player-live-label">{{ t(returningLive ? 'live_client.returning_live' : buffering ? 'live_client.buffering' : atLive ? 'live_client.live_edge' : 'live_client.return_to_live') }}</span>
        </button>
        <span v-if="!atLive && timeline" class="player-delay">−{{ formatLiveTime(behindLive) }}</span>
        <span class="player-control-spacer" />
        <span v-if="timeline" class="player-history" :title="t('live_client.history_hint')">{{ t('live_client.available_history', { time: formatLiveTime(history) }) }}</span>
        <button type="button" :title="t('live_client.mute')" :aria-label="t('live_client.mute')" :aria-pressed="muted || volume === 0" @click="toggleMute">
          <i :class="muted || volume === 0 ? 'i-mingcute:volume-mute-line' : 'i-mingcute:volume-line'" aria-hidden="true" />
        </button>
        <input
          class="player-volume" type="range" min="0" max="1" step="0.05"
          :value="muted ? 0 : volume" :style="{ '--volume-position': `${(muted ? 0 : volume) * 100}%` }"
          :aria-label="t('live_client.volume')" @input="changeVolume(Number(($event.currentTarget as HTMLInputElement).value))"
        >
        <span class="player-volume-value">{{ Math.round((muted ? 0 : volume) * 100) }}%</span>
        <button v-if="canPictureInPicture" type="button" :title="t('live_client.picture_in_picture')" :aria-label="t('live_client.picture_in_picture')" @click="pictureInPicture().catch(() => {})">
          <i class="i-mingcute:miniplayer-line" aria-hidden="true" />
        </button>
        <button class="fullscreen-button" type="button" :aria-label="t('live_client.fullscreen')" :title="t('live_client.fullscreen')" @click="fullscreen().catch(() => {})">
          <i :class="isFullscreen ? 'i-mingcute:fullscreen-exit-line' : 'i-mingcute:fullscreen-line'" aria-hidden="true" />
        </button>
      </div>
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
  </section>
</template>

<style scoped lang="scss">
.live-player {
  --live-control-safe-area: calc(var(--bew-space-6) + var(--bew-control-height) + var(--bew-space-4));
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: inherit;
  background: #000;
}
.live-player:focus,
.live-player:focus-visible {
  outline: none;
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
  padding: var(--bew-space-6) var(--bew-space-4) var(--bew-space-3);
  color: #fff;
  background: linear-gradient(transparent, #07090fbd 44%, #07090feb);
  opacity: 0;
  transform: translateY(var(--bew-space-2));
  pointer-events: none;
  transition:
    opacity var(--bew-duration-normal) var(--bew-ease-standard),
    transform var(--bew-duration-normal) var(--bew-ease-standard);
  &.is-visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
  button {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--bew-control-height);
    height: var(--bew-control-height);
    border: 0;
    padding: 0;
    border-radius: var(--bew-radius-full);
    background: transparent;
    color: inherit;
    font-size: var(--bew-icon-size-md);
    cursor: pointer;
    transition:
      background-color var(--bew-duration-fast),
      transform var(--bew-duration-fast) var(--bew-ease-standard);
    &:hover {
      background: #ffffff24;
    }
    &:active:not(:disabled) {
      transform: scale(0.92);
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  input {
    min-width: 0;
    cursor: pointer;
  }
  :is(button, input):focus-visible {
    outline: 2px solid #ffffffb8;
    outline-offset: 2px;
  }
}
.player-control-row {
  display: flex;
  align-items: center;
  gap: var(--bew-space-2);
}
.player-control-spacer {
  flex: 1;
}
.player-seek-area {
  position: relative;
  height: var(--bew-space-6);
}
.player-track {
  position: absolute;
  top: 50%;
  left: calc(var(--bew-space-3) / 2);
  right: calc(var(--bew-space-3) / 2);
  height: var(--bew-space-1);
  transform: translateY(-50%);
  border-radius: var(--bew-radius-full);
  background: #ffffff24;
  pointer-events: none;
}
.player-thumb {
  position: absolute;
  top: 50%;
  width: var(--bew-space-3);
  height: var(--bew-space-3);
  border-radius: var(--bew-radius-full);
  background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px #0006;
}
.player-seek-area:has(.player-seek:focus-visible) .player-thumb {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.player-buffer,
.player-progress {
  position: absolute;
  inset-block: 0;
  border-radius: inherit;
}
.player-buffer {
  overflow: hidden;
  background: #ffffff48;
}
.player-progress {
  left: 0;
  background: var(--bew-theme-color);
}
.player-seek,
.player-volume {
  appearance: none;
  display: block;
  height: var(--bew-space-6);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--bew-radius-full);
  background: transparent;
  &::-webkit-slider-runnable-track {
    height: var(--bew-space-1);
    border-radius: inherit;
    background: transparent;
  }
  &::-moz-range-track {
    height: var(--bew-space-1);
    border-radius: inherit;
    background: transparent;
  }
  &::-webkit-slider-thumb {
    appearance: none;
    width: var(--bew-space-3);
    height: var(--bew-space-3);
    margin-top: calc(-1 * var(--bew-space-1));
    border: 0;
    border-radius: var(--bew-radius-full);
    background: #fff;
    box-shadow: 0 1px 4px #0006;
  }
  &::-moz-range-thumb {
    width: var(--bew-space-3);
    height: var(--bew-space-3);
    border: 0;
    border-radius: var(--bew-radius-full);
    background: #fff;
    box-shadow: 0 1px 4px #0006;
  }
}
.player-seek {
  position: relative;
  width: 100%;
  opacity: 0;
  &:disabled {
    cursor: default;
    &::-webkit-slider-thumb {
      opacity: 0;
    }
    &::-moz-range-thumb {
      opacity: 0;
    }
  }
}
.player-seek-preview {
  position: absolute;
  bottom: 100%;
  left: clamp(32px, var(--seek-position), calc(100% - 32px));
  transform: translateX(-50%);
  padding: var(--bew-space-1) var(--bew-space-2);
  border: 1px solid #ffffff24;
  border-radius: var(--bew-badge-radius);
  background: #11151fef;
  color: #fff;
  font-size: var(--bew-font-size-caption);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.player-controls .player-live {
  display: inline-flex;
  align-items: center;
  gap: var(--bew-space-2);
  width: auto;
  min-width: 0;
  max-width: 160px;
  flex-shrink: 1;
  padding-inline: var(--bew-space-3);
  font-size: var(--bew-font-size-control);
  font-weight: var(--bew-font-weight-medium);
  white-space: nowrap;
}
.player-live-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.player-live-dot {
  flex-shrink: 0;
  width: var(--bew-space-2);
  height: var(--bew-space-2);
  border-radius: var(--bew-radius-full);
  background: #ffffff80;
}
.at-live .player-live-dot {
  background: #ff7796;
  box-shadow: 0 0 8px #ff77964d;
}
.player-delay,
.player-history,
.player-volume-value {
  color: #ffffffb8;
  font-size: var(--bew-font-size-caption);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.player-volume {
  width: 64px;
  background: linear-gradient(to right, #fff var(--volume-position), #ffffff38 var(--volume-position)) center / 100%
    var(--bew-space-1) no-repeat;
}
.player-volume-value {
  min-width: 4ch;
  text-align: right;
}
.is-idle video {
  cursor: none;
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
  .player-controls,
  .player-controls button {
    transition: none;
  }
  .player-loader {
    animation: none;
  }
}
@media (max-width: 600px) {
  .player-controls {
    padding-inline: var(--bew-space-3);
  }
  .player-control-row {
    gap: var(--bew-space-1);
  }
  .player-history,
  .player-volume-value {
    display: none;
  }
}
@media (max-width: 480px) {
  .player-volume,
  .player-delay {
    display: none;
  }
  .player-controls .player-live {
    max-width: 112px;
    gap: var(--bew-space-1);
    padding-inline: var(--bew-space-2);
  }
}
.live-player:fullscreen {
  width: 100vw;
  height: 100dvh;
  border-radius: 0;
}
</style>
