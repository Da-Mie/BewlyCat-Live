<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { settings } from '~/logic'
import type { LiveMessage } from '~/utils/liveRoom'

const props = defineProps<{ superChats: LiveMessage[], assets: Record<string, string> }>()
const { t } = useI18n()
const now = ref(Date.now())
const gifts = ref<{ message: LiveMessage, expires: number }[]>([])
const reducedMotion = usePreferredReducedMotion()
const chats = computed(() => settings.value.liveRoomShowSuperChats ? props.superChats.filter(message => message.sc!.start <= now.value && message.sc!.end > now.value).slice(-3) : [])
const timer = setInterval(() => {
  now.value = Date.now()
  gifts.value = gifts.value.filter(item => item.expires > now.value)
}, 1000)
function push(message: LiveMessage) {
  if (message.kind === 'gift' && !settings.value.liveRoomHideGiftEffects && gifts.value.length < 3)
    gifts.value = [...gifts.value, { message, expires: Date.now() + 4500 }]
}
function finish(id: string) {
  gifts.value = gifts.value.filter(item => item.message.id !== id)
}
watch(() => settings.value.liveRoomHideGiftEffects, () => {
  gifts.value = []
})
onBeforeUnmount(() => clearInterval(timer))
defineExpose({ push })
</script>

<template>
  <div class="room-overlay" :class="{ 'reduced-motion': reducedMotion === 'reduce' }">
    <TransitionGroup name="fade" tag="div" class="super-chat-stack">
      <article v-for="message in chats" :key="message.sc!.id" class="super-chat-card" :data-tier="message.sc!.price >= 1000 ? 'high' : message.sc!.price >= 100 ? 'medium' : 'base'" :aria-label="t('live_gifts.sc')">
        <header><span class="sc-label">SC</span><strong>{{ message.name }}</strong><b>¥{{ message.sc!.price }}</b></header>
        <p translate="yes">
          {{ message.text }}
        </p>
        <footer><span>{{ t('live_gifts.remaining', { seconds: Math.max(0, Math.ceil((message.sc!.end - now) / 1000)) }) }}</span></footer>
      </article>
    </TransitionGroup>
    <div v-if="!settings.liveRoomHideGiftEffects" class="gift-effects" aria-hidden="true">
      <div v-for="{ message } in gifts" :key="message.id" class="gift-effect" @animationend.self="finish(message.id)">
        <img v-if="message.gift?.image || assets[message.gift?.id ?? '']" :src="message.gift?.image || assets[message.gift!.id]" alt="" referrerpolicy="no-referrer">
        <i v-else class="i-mingcute:gift-line" />
        <div><strong>{{ message.name }}</strong><span>{{ message.text }}</span></div>
        <i class="gift-spark i-mingcute:sparkles-line" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.room-overlay {
  position: absolute;
  inset: var(--bew-space-4) var(--bew-space-4) var(--live-control-safe-area, 64px);
  overflow: hidden;
  pointer-events: none;
  font-size: var(--bew-font-size-control);
  line-height: var(--bew-line-height-control);
}
.super-chat-stack {
  position: absolute;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  gap: var(--bew-space-2);
  width: min(320px, 65%);
  max-height: 100%;
  overflow: hidden;
}
.super-chat-card {
  --sc-accent: #97d9ff;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid #ffffff38;
  border-radius: var(--bew-radius-lg);
  background: #142e4ef2;
  color: #fff;
  box-shadow: var(--bew-shadow-2);
  header {
    display: flex;
    align-items: center;
    gap: var(--bew-space-2);
    padding: var(--bew-space-2) var(--bew-space-3);
    background: #ffffff0f;
    strong {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    b {
      color: var(--sc-accent);
    }
  }
  p {
    margin: 0;
    padding: var(--bew-space-3);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 120px;
    overflow: hidden;
  }
  footer {
    padding: 0 var(--bew-space-3) var(--bew-space-2);
    color: #ffffffb8;
    font-size: var(--bew-font-size-caption);
  }
}
.super-chat-card[data-tier="medium"] {
  --sc-accent: #ffe39d;
  background: #493414f2;
}
.super-chat-card[data-tier="high"] {
  --sc-accent: #ffb9dc;
  background: #4a193af2;
}
.sc-label {
  font-size: var(--bew-font-size-caption);
  color: var(--sc-accent);
  font-weight: var(--bew-font-weight-bold);
}
.gift-effects {
  position: absolute;
  top: var(--bew-space-10);
  right: 0;
  display: grid;
  gap: var(--bew-space-2);
  max-width: min(320px, 70%);
}
.gift-effect {
  display: flex;
  align-items: center;
  gap: var(--bew-space-3);
  padding: var(--bew-space-2) var(--bew-space-4) var(--bew-space-2) var(--bew-space-2);
  border: 1px solid #ffffff38;
  border-radius: var(--bew-radius-full);
  background: linear-gradient(110deg, #20263bf2, #5a3854ed);
  color: white;
  box-shadow: var(--bew-shadow-2);
  animation: gift-arrive 4s var(--bew-ease-emphasized) both;
  img {
    width: 48px;
    height: 48px;
    object-fit: contain;
  }
  div {
    display: grid;
    gap: var(--bew-space-1);
    min-width: 0;
  }
  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  span {
    color: #ffe0ee;
  }
  .gift-spark {
    color: #ffdb9d;
    font-size: var(--bew-icon-size-lg);
  }
}
.reduced-motion .gift-effect {
  animation: none;
}
@keyframes gift-arrive {
  0% {
    opacity: 0;
    transform: translateX(40px) scale(0.95);
  }
  12%,
  85% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(-8px);
  }
}
@media (max-width: 600px) {
  .super-chat-stack {
    width: min(260px, 70%);
  }
  .super-chat-card:not(:last-child) {
    display: none;
  }
  .gift-effects {
    top: 0;
  }
}
</style>
