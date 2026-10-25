<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import browser from 'webextension-polyfill'

import Button from '~/components/Button.vue'
import Icon from '~/components/Icon.vue'
import LiquidSegmentIndicator from '~/components/LiquidSegmentIndicator.vue'
import Radio from '~/components/Radio.vue'
import AccountLevelSettings from '~/components/Settings/AccountLevelSettings.vue'
import SettingsItem from '~/components/Settings/components/SettingsItem.vue'
import LiveRoomSettings from '~/components/Settings/LiveRoomSettings.vue'
import { settings, settingsReady } from '~/logic'
import { originalLiveRoomUrl, parseLiveRoomId } from '~/utils/liveRoom'

import DanmakuToggle from './DanmakuToggle.vue'
import { resolveLiveLanguage } from './language'
import LiveDanmaku from './LiveDanmaku.vue'
import LiveGiftPanel from './LiveGiftPanel.vue'
import LivePlayer from './LivePlayer.vue'
import LiveRoomOverlay from './LiveRoomOverlay.vue'
import { useLiveTheme } from './theme'
import { useLivePreferences } from './useLivePreferences'
import { useLiveRoom } from './useLiveRoom'
import { useLiveSettingsDialog } from './useLiveSettingsDialog'

const { t, locale } = useI18n()
const { isDark, toggleDark } = useLiveTheme()
const danmaku = ref<InstanceType<typeof LiveDanmaku>>()
const overlay = ref<InstanceType<typeof LiveRoomOverlay>>()
const giftPanel = ref<InstanceType<typeof LiveGiftPanel>>()
const failedBackground = ref('')
const preferences = useLivePreferences()
const volume = ref(1)
const muted = ref(true)
const brandLogo = browser.runtime.getURL('assets/icon-512.png')
const { room, messages, superChats, giftAssets, session, loading, error, chatState, chatError, historyError, nativeFilterState, quality, sourceId, sending, sendError, displayVersion, load, refresh, reconnectChat, syncNativeFilters, send } = useLiveRoom((message) => {
  if (message.kind === 'chat')
    danmaku.value?.push(message)
  else if (message.kind === 'gift')
    overlay.value?.push(message)
})
const roomInput = ref(new URL(location.href).searchParams.get('room') ?? '')
const inputError = ref(false)
const setupError = ref('')
const ready = ref(false)
const chatVisible = ref(true)
const headerVisible = ref(true)
const showDanmaku = ref(true)
const playing = ref(false)
const followChat = ref(true)
const chatList = ref<HTMLElement>()
const draft = ref('')
const { dialog, panel, dialogOpen, dialogEntering, openSettings, closeSettings, finishSettingsClose, onSettingsClosed } = useLiveSettingsDialog()
const originalUrl = computed(() => originalLiveRoomUrl(room.value?.roomId ?? parseLiveRoomId(roomInput.value)))
const background = computed(() => settings.value.liveRoomBackground && room.value?.background !== failedBackground.value ? room.value?.background : '')
const canSend = computed(() => session.value.uid !== '0' && !!draft.value.trim() && !sending.value)

function backgroundFailed(event: Event) {
  const image = event.currentTarget as HTMLImageElement | null
  if (image && image.src === background.value)
    failedBackground.value = image.src
}

function handleDanmakuKeydown(event: KeyboardEvent) {
  if (event.code !== 'KeyD' || event.repeat || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || dialogOpen.value || dialog.value?.open || !ready.value)
    return
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))
    return
  event.preventDefault()
  showDanmaku.value = !showDanmaku.value
}
useEventListener(window, 'keydown', handleDanmakuKeydown)

watch(() => settings.value.language, (saved) => {
  const language = resolveLiveLanguage(saved, browser.i18n.getUILanguage())
  locale.value = language.locale
  document.documentElement.lang = language.lang
}, { immediate: true })
watch(room, (value) => {
  document.title = value?.title ? `${value.title} · BewlyCat Live` : 'BewlyCat Live'
})
watch(() => messages.value.length ? messages.value[messages.value.length - 1].id : '', async () => {
  if (followChat.value) {
    await nextTick()
    chatList.value?.scrollTo({ top: chatList.value.scrollHeight })
  }
})

async function openRoom() {
  const id = parseLiveRoomId(roomInput.value)
  inputError.value = !id
  if (!id || !ready.value)
    return
  const url = new URL(location.href)
  url.searchParams.set('room', id)
  history.replaceState(null, '', url)
  preferences.flush()
  const saved = preferences.restore()
  quality.value = saved.quality
  sourceId.value = saved.sourceId
  followChat.value = true
  playing.value = false
  await load(id)
}
async function submit() {
  if (canSend.value && await send(draft.value))
    draft.value = ''
}
function changeQuality() {
  preferences.remember({ quality: quality.value })
  return refresh()
}
function changeSource() {
  preferences.remember({ sourceId: sourceId.value })
}
function audioChange(value: { volume: number, muted: boolean }) {
  volume.value = value.volume
  muted.value = value.muted
  if (ready.value)
    preferences.remember(value)
}
watch([showDanmaku, chatVisible, headerVisible], ([danmaku, chatVisible, headerVisible]) => {
  if (ready.value)
    preferences.remember({ danmaku, chatVisible, headerVisible })
})
watch(() => settings.value.liveRoomRememberPreferences, (enabled) => {
  if (enabled && ready.value) {
    preferences.remember({
      quality: quality.value,
      sourceId: sourceId.value,
      volume: volume.value,
      muted: muted.value,
      danmaku: showDanmaku.value,
      chatVisible: chatVisible.value,
      headerVisible: headerVisible.value,
    })
  }
})
function onScroll() {
  const list = chatList.value
  if (list)
    followChat.value = list.scrollHeight - list.clientHeight - list.scrollTop < 80
}
function resumeChat() {
  followChat.value = true
  chatList.value?.scrollTo({ top: chatList.value.scrollHeight, behavior: 'smooth' })
}
function reloadPage() {
  location.reload()
}
onMounted(async () => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([settingsReady, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(t('live_client.settings_failed'))), 10000)
    })])
    const saved = preferences.restore()
    showDanmaku.value = saved.danmaku
    chatVisible.value = saved.chatVisible
    headerVisible.value = saved.headerVisible
    volume.value = saved.volume
    muted.value = saved.muted
    ready.value = true
    if (roomInput.value)
      await openRoom()
  }
  catch (reason) {
    setupError.value = reason instanceof Error ? reason.message : String(reason)
  }
  finally {
    clearTimeout(timeout)
  }
})
</script>

<template>
  <div class="live-client bewly-wrapper" :data-room-background="!!background" :class="{ 'dark': isDark, 'chat-hidden': !chatVisible }">
    <div v-if="background" :key="background" class="room-background" aria-hidden="true">
      <img :src="background" alt="" referrerpolicy="no-referrer" @error="backgroundFailed">
    </div>
    <Transition name="live-header">
      <div v-show="headerVisible" class="client-header-shell">
        <header class="client-header">
          <div class="header-inner bew-popover-surface">
            <a class="brand" href="https://www.bilibili.com/" target="_blank" rel="noopener" aria-label="BewlyCat">
              <img :src="brandLogo" alt="" width="32" height="32">
              <span>BewlyCat</span><span class="brand-section">{{ t('live_client.title') }}</span>
            </a>
            <form class="room-search" :class="{ invalid: inputError }" @submit.prevent="openRoom">
              <i class="i-mingcute:search-2-line" aria-hidden="true" />
              <input v-model="roomInput" :aria-label="t('live_client.room_input')" :placeholder="t('live_client.room_input')" :aria-invalid="inputError" autocomplete="off">
              <button class="search-submit" type="submit" :disabled="!ready || loading" :aria-label="t('live_client.open_room')" :title="t('live_client.open_room')">
                <i class="i-mingcute:arrow-right-line" aria-hidden="true" />
              </button>
            </form>
            <nav class="header-actions" :aria-label="t('live_client.options')">
              <div class="header-tool-group">
                <button
                  class="header-tool live-tool-button" type="button" :disabled="!ready" :aria-expanded="(dialogOpen || dialogEntering) && panel === 'filters'" aria-haspopup="dialog"
                  :title="t('live_client.filters_title')" :aria-label="t('live_client.filters_title')" @click="openSettings('filters')"
                >
                  <i class="i-mingcute:filter-line" aria-hidden="true" />
                </button>
                <button
                  class="header-tool live-tool-button settings-trigger" type="button" :disabled="!ready" :aria-expanded="(dialogOpen || dialogEntering) && panel === 'layout'" aria-haspopup="dialog"
                  :title="t('live_room.options')" :aria-label="t('live_room.options')" @click="openSettings('layout')"
                >
                  <i class="i-mingcute:settings-3-line" aria-hidden="true" /><span class="action-label">{{ t('settings.title') }}</span>
                </button>
              </div>
              <div class="header-tool-group header-tool-group--secondary">
                <button class="header-tool live-tool-button" type="button" :aria-label="t('live_room.theme')" :title="t('live_room.theme')" @click="toggleDark">
                  <Icon :key="String(isDark)" :icon="isDark ? 'line-md:sunny-outline-to-moon-transition' : 'line-md:moon-to-sunny-outline-transition'" aria-hidden="true" />
                </button>
                <a
                  class="header-tool live-tool-button" :href="originalUrl" target="_blank" rel="noopener" :aria-label="t('live_client.original')"
                  :title="t('live_client.original')"
                ><i class="i-mingcute:external-link-line" aria-hidden="true" /></a>
                <button class="header-tool live-tool-button" type="button" :aria-label="t('live_client.hide_header')" :title="t('live_client.hide_header')" @click="headerVisible = false">
                  <i class="i-mingcute:up-line" aria-hidden="true" />
                </button>
              </div>
            </nav>
          </div>
        </header>
      </div>
    </Transition>
    <Transition name="fade">
      <button
        v-if="!headerVisible" class="header-reveal bew-popover-surface" type="button" :aria-label="t('live_client.show_header')" :title="t('live_client.show_header')"
        @click="headerVisible = true"
      >
        <i class="i-mingcute:down-line" aria-hidden="true" />
      </button>
    </Transition>

    <main class="client-main">
      <p v-if="inputError" class="input-error error-text" role="alert">
        {{ t('live_client.invalid_room') }}
      </p>
      <div v-if="setupError" class="page-state" role="alert">
        <i class="i-mingcute:warning-line state-icon" aria-hidden="true" /><p>{{ setupError }}</p><Button @click="reloadPage">
          {{ t('live_client.retry') }}
        </Button>
      </div>
      <div v-else-if="!ready || (loading && !room)" class="page-state" role="status">
        <span class="state-loader" aria-hidden="true" /><p>{{ t('live_client.loading_room') }}</p>
      </div>
      <div v-else-if="error && !room" class="page-state" role="alert">
        <i class="i-mingcute:warning-line state-icon" aria-hidden="true" /><p>{{ error }}</p>
        <div class="state-actions">
          <Button type="secondary" round @click="openRoom">
            {{ t('live_client.retry') }}
          </Button>
          <a class="state-link" :href="originalUrl" target="_blank" rel="noopener"><span>{{ t('live_client.original') }}</span><i class="i-mingcute:external-link-line" aria-hidden="true" /></a>
        </div>
      </div>
      <template v-else-if="room">
        <div class="room-grid">
          <section class="watch-column">
            <section class="room-heading">
              <a class="anchor-avatar" :href="`https://space.bilibili.com/${room.uid}`" target="_blank" rel="noopener" :aria-label="room.uname || t('live_client.room_label', { id: room.roomId })"><img v-if="room.face" :src="room.face" alt="" referrerpolicy="no-referrer"><i v-else class="i-mingcute:user-3-line" aria-hidden="true" /></a>
              <div class="room-title">
                <h1 class="bew-page-heading" :title="room.title" translate="yes">
                  {{ room.title || t('live_client.room_label', { id: room.roomId }) }}
                </h1><div class="room-meta">
                  <a :href="`https://space.bilibili.com/${room.uid}`" target="_blank" rel="noopener">{{ room.uname }}</a><span class="room-number">{{ t('live_client.room_label', { id: room.roomId }) }}</span>
                </div>
              </div>
              <span class="live-state" :data-live="room.live"><span aria-hidden="true" />{{ t(room.live ? 'live_client.live' : 'live_client.offline') }}</span>
            </section>
            <div class="player-frame" :class="{ 'portrait': room.portrait, 'player-empty': !room.live || room.locked || !room.streams.length }">
              <LivePlayer
                v-if="room.live && !room.locked && room.streams.length" v-model:source-id="sourceId" :streams="room.streams" :volume="volume" :muted="muted"
                @audio-change="audioChange" @playing="playing = $event" @refresh="refresh"
              >
                <LiveDanmaku v-if="showDanmaku && playing" :key="displayVersion" ref="danmaku" />
                <LiveRoomOverlay v-if="playing" :key="`overlay:${displayVersion}`" ref="overlay" :super-chats="superChats" :assets="giftAssets" />
              </LivePlayer>
              <div v-else class="unavailable" role="status">
                <i class="i-mingcute:live-line state-icon" aria-hidden="true" /><p>{{ t(room.locked ? 'live_client.restricted' : room.live ? 'live_client.no_stream' : 'live_client.offline_detail') }}</p>
                <div class="state-actions">
                  <Button type="secondary" round :disabled="loading" @click="refresh">
                    {{ t('live_client.refresh') }}
                  </Button>
                  <a class="state-link" :href="originalUrl" target="_blank" rel="noopener"><span>{{ t('live_client.original') }}</span><i class="i-mingcute:external-link-line" aria-hidden="true" /></a>
                </div>
              </div>
            </div>
            <div class="player-options">
              <div class="stream-options">
                <label class="live-select"><span>{{ t('live_client.quality') }}</span><select v-model.number="quality" :disabled="loading || !room.qualities.length" @change="changeQuality"><option v-for="item in room.qualities" :key="item.value" :value="item.value">{{ item.label }}</option></select><i class="i-mingcute:down-line" aria-hidden="true" /></label>
                <label class="live-select source-select"><span>{{ t('live_client.line') }}</span><select v-model="sourceId" :disabled="!room.streams.length" @change="changeSource"><option v-for="stream in room.streams" :key="stream.id" :value="stream.id">{{ stream.description }}</option></select><i class="i-mingcute:down-line" aria-hidden="true" /></label>
              </div>
              <div class="view-options" role="group" :aria-label="t('live_client.options')">
                <div class="support-actions" role="group" :aria-label="t('live_gifts.title')">
                  <Button class="support-button" round :disabled="session.uid === '0' || !room.live || room.locked" @click="giftPanel?.open('gift')">
                    <i class="i-mingcute:gift-line" aria-hidden="true" />{{ t('live_gifts.gift') }}
                  </Button>
                  <Button class="support-button" round :disabled="session.uid === '0' || !room.live || room.locked" @click="giftPanel?.open('sc')">
                    <i class="i-mingcute:chat-3-line" aria-hidden="true" />{{ t('live_gifts.sc') }}
                  </Button>
                </div>
                <DanmakuToggle v-model="showDanmaku" />
                <button
                  class="chat-visibility-toggle live-tool-button" type="button" :aria-expanded="chatVisible" aria-controls="live-chat-panel" :aria-label="t(chatVisible ? 'live_client.hide_chat' : 'live_client.show_chat')"
                  :title="t(chatVisible ? 'live_client.hide_chat' : 'live_client.show_chat')"
                  @click="chatVisible = !chatVisible"
                >
                  <i :class="chatVisible ? 'i-mingcute:layout-rightbar-close-line' : 'i-mingcute:layout-rightbar-open-line'" aria-hidden="true" /><span>{{ t(chatVisible ? 'live_client.hide_chat' : 'live_client.show_chat') }}</span>
                </button>
                <button
                  class="live-tool-button" type="button" :disabled="loading" :aria-label="t('live_client.refresh')" :title="t('live_client.refresh')"
                  @click="refresh"
                >
                  <i class="i-mingcute:refresh-2-line" :class="{ spinning: loading }" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p v-if="error" class="error-text stream-error" role="alert">
              {{ error }}
            </p>
          </section>
          <aside v-show="chatVisible" id="live-chat-panel" class="chat-panel">
            <div class="chat-heading">
              <h2><i class="i-mingcute:comment-line" aria-hidden="true" />{{ t('live_client.realtime_chat') }}</h2><span class="connection-state" :data-connected="chatState === 'connected'"><span aria-hidden="true" />{{ t(`live_client.chat_${chatState}`) }}</span>
            </div>
            <div v-if="chatError" class="chat-error" role="status">
              <p>{{ chatError }}</p><Button size="small" @click="reconnectChat">
                {{ t('live_client.reconnect') }}
              </Button>
            </div>
            <p v-if="historyError" class="history-error">
              {{ t('live_client.history_failed') }}
            </p>
            <div v-if="nativeFilterState === 'error'" class="chat-error" role="status">
              <p>{{ t('live_client.native_filter_failed') }}</p><Button size="small" @click="syncNativeFilters">
                {{ t('live_client.retry') }}
              </Button>
            </div>
            <div class="chat-feed">
              <div
                ref="chatList" class="chat-list" role="log" :aria-label="t('live_client.chat')" aria-live="off"
                tabindex="0" @scroll.passive="onScroll"
              >
                <div v-if="!messages.length" class="chat-empty">
                  <i class="i-mingcute:comment-2-line" aria-hidden="true" /><p>{{ t(nativeFilterState === 'ready' ? 'live_client.empty_chat' : 'live_client.native_filter_waiting') }}</p>
                </div>
                <div v-for="message in messages" :key="message.id" class="chat-message" :data-kind="message.kind" :data-self="session.uid !== '0' && message.uid === session.uid">
                  <span v-if="message.sc" class="message-label">SC · ¥{{ message.sc.price }}</span><a :href="`https://space.bilibili.com/${encodeURIComponent(message.uid)}`" target="_blank" rel="noopener" :title="message.name">{{ message.name }}</a><span class="message-text" :translate="message.kind === 'entry' ? 'no' : 'yes'">{{ message.kind === 'entry' ? t('live_client.entered') : message.text }}</span>
                </div>
              </div>
              <Button v-if="!followChat" class="resume-chat" size="small" @click="resumeChat">
                <i class="i-mingcute:arrow-down-line" aria-hidden="true" />{{ t('live_client.latest') }}
              </Button>
            </div>
            <form class="chat-compose" @submit.prevent="submit">
              <p v-if="session.uid === '0'" class="login-hint">
                {{ t('live_client.login_hint') }} <a :href="originalUrl" target="_blank" rel="noopener">{{ t('live_client.login') }}</a>
              </p>
              <div class="compose-row">
                <input
                  v-model="draft" class="live-input" :disabled="session.uid === '0' || sending" maxlength="100" :aria-label="t('live_client.message_input')"
                  :placeholder="t('live_client.message_input')"
                ><Button
                  class="send-button" type="primary" round center :disabled="!canSend"
                  :aria-label="t('live_client.send')"
                >
                  <template #left>
                    <i class="send-button-icon i-mingcute:send-line" aria-hidden="true" />
                  </template>
                  <span class="send-button-label">{{ t('live_client.send') }}</span>
                </Button>
              </div>
              <p v-if="sendError" class="error-text" role="alert">
                {{ sendError }}
              </p>
            </form>
          </aside>
        </div>
        <LiveGiftPanel ref="giftPanel" :room="room" :session="session" />
      </template>
      <div v-else class="page-state welcome-state">
        <i class="i-mingcute:live-line state-icon" aria-hidden="true" /><h1 class="bew-page-heading">
          {{ t('live_client.welcome') }}
        </h1><p>{{ t('live_client.welcome_detail') }}</p>
      </div>
    </main>

    <dialog
      ref="dialog" class="settings-dialog" :class="{ 'dialog-visible': dialogOpen }" :aria-label="t('live_room.options')" @cancel.prevent="closeSettings"
      @close="onSettingsClosed"
    >
      <Transition name="modal" @after-leave="finishSettingsClose">
        <div v-if="dialogOpen" class="dialog-panel bew-popover-surface">
          <div class="dialog-header">
            <div><h2>{{ t('live_room.options') }}</h2><p>{{ t('live_client.preferences_hint') }}</p></div><button class="dialog-close" type="button" :aria-label="t('live_room.close')" @click="closeSettings">
              <i class="i-ic-baseline-clear" aria-hidden="true" />
            </button>
          </div>
          <nav class="dialog-navigation" :aria-label="t('settings.category_navigation')">
            <div class="bew-segment-control bew-segment-control--surface">
              <LiquidSegmentIndicator :active-key="panel" />
              <button
                class="bew-segment-control__item" type="button" data-segment-item :data-active="panel === 'filters'" :aria-pressed="panel === 'filters'"
                @click="panel = 'filters'"
              >
                <i class="i-mingcute:filter-line" aria-hidden="true" />{{ t('live_client.filters_title') }}
              </button>
              <button
                class="bew-segment-control__item" type="button" data-segment-item :data-active="panel === 'layout'" :aria-pressed="panel === 'layout'"
                @click="panel = 'layout'"
              >
                <i class="i-mingcute:settings-3-line" aria-hidden="true" />{{ t('live_room.options') }}
              </button>
            </div>
          </nav>
          <div class="dialog-body">
            <Transition name="fade" mode="out-in">
              <div v-if="panel === 'filters'" key="filters">
                <section class="native-filter-settings" :aria-label="t('live_client.native_filters')">
                  <div>
                    <h3>{{ t('live_client.native_filters') }}</h3>
                    <p>{{ t('live_client.native_filters_hint') }}</p>
                    <p class="native-filter-status" role="status">
                      {{ t(nativeFilterState === 'ready' ? session.uid === '0' ? 'live_client.native_filter_guest' : 'live_client.native_filter_ready' : nativeFilterState === 'error' ? 'live_client.native_filter_failed' : 'live_client.native_filter_waiting') }}
                    </p>
                  </div>
                  <Button size="small" :disabled="nativeFilterState === 'loading' || !room" @click="syncNativeFilters">
                    <i class="i-mingcute:refresh-2-line" :class="{ spinning: nativeFilterState === 'loading' }" aria-hidden="true" />{{ t('live_client.native_filter_sync') }}
                  </Button>
                </section>
                <AccountLevelSettings scope="liveDanmaku" :show-heading="false" />
              </div>
              <div v-else key="layout">
                <SettingsItem :title="t('live_client.header_visibility')" right-width="auto">
                  <Radio v-model="headerVisible" />
                </SettingsItem>
                <LiveRoomSettings />
              </div>
            </Transition>
          </div>
          <footer class="dialog-footer">
            {{ t('live_client.independent') }}
          </footer>
        </div>
      </Transition>
    </dialog>
  </div>
</template>

<style lang="scss" src="./liveClient.scss" />
