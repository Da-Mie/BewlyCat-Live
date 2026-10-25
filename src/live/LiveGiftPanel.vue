<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '~/components/Button.vue'
import LiquidSegmentIndicator from '~/components/LiquidSegmentIndicator.vue'
import type { LiveOffer, LiveOffers, LivePurchaseResult, LiveQuote, LiveSession } from '~/constants/liveClient'
import type { LiveRoom } from '~/utils/liveRoom'

import { liveRequest } from './api'
import { useLiveSettingsDialog } from './useLiveSettingsDialog'

const props = defineProps<{ room: LiveRoom, session: LiveSession }>()
const { t } = useI18n()
const { dialog, dialogOpen, openSettings, closeSettings, finishSettingsClose, onSettingsClosed } = useLiveSettingsDialog()
const kind = ref<'gift' | 'sc'>('gift')
const data = shallowRef<LiveOffers>()
const quote = shallowRef<LiveQuote>()
const selected = ref('')
const quantity = ref(1)
const draft = ref('')
const busy = ref(false)
const paying = ref(false)
const error = ref('')
const result = ref('')
let version = 0
const offers = computed(() => data.value?.offers.filter(item => item.kind === kind.value) ?? [])
const offer = computed(() => offers.value.find(item => item.id === selected.value))
const valid = computed(() => !!offer.value && Number.isSafeInteger(quantity.value) && quantity.value > 0 && quantity.value <= offer.value.maxQuantity && (kind.value !== 'sc' || (!!draft.value.trim() && draft.value.trim().length <= offer.value.limit)))
function price(item: LiveOffer, count = 1) {
  return `${(item.price * count).toLocaleString()} ${t(`live_gifts.${item.currency}`)}`
}
function resetSelection() {
  selected.value = offers.value[0]?.id ?? ''
  quantity.value = 1
  quote.value = undefined
  error.value = ''
  result.value = ''
}
watch(kind, resetSelection)
watch([selected, quantity, draft], () => {
  quote.value = undefined
})
watch([() => props.room.roomId, () => props.session.uid], () => {
  version++
  data.value = quote.value = undefined
  draft.value = ''
  closeSettings()
})
onBeforeUnmount(() => {
  version++
})
async function open(value: 'gift' | 'sc') {
  if (paying.value)
    return
  kind.value = value
  data.value = undefined
  quote.value = undefined
  result.value = error.value = ''
  const request = ++version
  busy.value = true
  void openSettings('layout')
  try {
    const value = await liveRequest<LiveOffers>({ action: 'offers', roomId: props.room.roomId, expectedUid: props.session.uid })
    if (request === version) {
      data.value = value
      resetSelection()
    }
  }
  catch (reason) {
    if (request === version)
      error.value = reason instanceof Error ? reason.message : String(reason)
  }
  finally {
    if (request === version)
      busy.value = false
  }
}
async function review() {
  if (!valid.value || busy.value)
    return
  const request = version
  busy.value = true
  error.value = result.value = ''
  try {
    const value = await liveRequest<LiveQuote>({ action: 'quote', roomId: props.room.roomId, expectedUid: props.session.uid, offerId: selected.value, quantity: quantity.value, text: draft.value })
    if (request === version)
      quote.value = value
  }
  catch (reason) {
    if (request === version)
      error.value = reason instanceof Error ? reason.message : String(reason)
  }
  finally {
    if (request === version)
      busy.value = false
  }
}
async function purchase() {
  if (!quote.value || paying.value)
    return
  const request = version
  const token = quote.value.token
  paying.value = true
  error.value = result.value = ''
  quote.value = undefined
  try {
    const value = await liveRequest<LivePurchaseResult>({ action: 'purchase', roomId: props.room.roomId, expectedUid: props.session.uid, quoteToken: token })
    if (request === version) {
      result.value = t(`live_gifts.${value.status === 'review' ? 'reviewing' : value.status}`)
      if (value.status !== 'unknown')
        draft.value = ''
    }
  }
  catch (reason) {
    if (request === version)
      error.value = `${reason instanceof Error ? reason.message : String(reason)} ${t('live_gifts.check_before_retry')}`
  }
  finally { paying.value = false }
}
function close() {
  if (paying.value)
    return
  version++
  quote.value = undefined
  closeSettings()
}
defineExpose({ open })
</script>

<template>
  <dialog
    ref="dialog" class="settings-dialog gift-dialog" :class="{ 'dialog-visible': dialogOpen }" :aria-label="t('live_gifts.title')" @cancel.prevent="close"
    @close="onSettingsClosed"
  >
    <Transition name="modal" @after-leave="finishSettingsClose">
      <div v-if="dialogOpen" class="dialog-panel bew-popover-surface">
        <header class="dialog-header">
          <div><h2>{{ t('live_gifts.title') }}</h2><p>{{ room.uname }} · {{ t('live_client.room_label', { id: room.roomId }) }}</p></div>
          <button class="dialog-close" type="button" :disabled="paying" :aria-label="t('live_room.close')" @click="close">
            <i class="i-ic-baseline-clear" aria-hidden="true" />
          </button>
        </header>
        <nav class="dialog-navigation" :aria-label="t('live_gifts.title')">
          <div class="bew-segment-control bew-segment-control--surface">
            <LiquidSegmentIndicator :active-key="kind" />
            <button
              v-for="item in (['gift', 'sc'] as const)" :key="item" type="button" class="bew-segment-control__item" data-segment-item
              :data-active="kind === item" :aria-pressed="kind === item" :disabled="busy || paying || !!quote" @click="kind = item"
            >
              <i :class="item === 'gift' ? 'i-mingcute:gift-line' : 'i-mingcute:chat-3-line'" aria-hidden="true" />{{ t(`live_gifts.${item}`) }}
            </button>
          </div>
        </nav>
        <div class="dialog-body gift-body" :aria-busy="busy || paying">
          <p v-if="busy || paying" class="gift-status" role="status">
            <span class="state-loader" />{{ t(paying ? 'live_gifts.sending' : 'live_gifts.loading') }}
          </p>
          <p v-if="error" class="error-text" role="alert">
            {{ error }}
          </p>
          <p v-if="result" class="gift-status" role="status">
            {{ result }}
          </p>
          <Transition name="fade" mode="out-in">
            <div v-if="quote" key="confirm" class="gift-confirm">
              <h3>{{ t('live_gifts.confirm') }}</h3>
              <dl>
                <dt>{{ t('live_gifts.recipient') }}</dt><dd>{{ quote.anchor }} · {{ quote.roomId }}</dd><dt>{{ t('live_gifts.gift') }}</dt><dd>{{ quote.name }} × {{ quote.quantity }}</dd><dt>{{ t('live_gifts.total') }}</dt><dd class="gift-total">
                  {{ price(quote, quote.quantity) }}
                </dd>
              </dl>
              <p v-if="quote.text" class="sc-preview" translate="yes">
                {{ quote.text }}
              </p>
              <div class="gift-actions">
                <Button :disabled="paying" @click="quote = undefined">
                  {{ t('live_gifts.back') }}
                </Button><Button type="primary" :disabled="paying" @click="purchase">
                  {{ t('live_gifts.pay_send') }}
                </Button>
              </div>
            </div>
            <div v-else-if="data && !paying" :key="kind" class="gift-picker">
              <div class="gift-grid" :aria-label="t(`live_gifts.${kind}`)">
                <button
                  v-for="item in offers" :key="item.id" type="button" class="gift-option" :aria-pressed="selected === item.id"
                  :disabled="busy" @click="selected = item.id"
                >
                  <img v-if="item.image" :src="item.image" alt="" loading="lazy" referrerpolicy="no-referrer"><i v-else class="i-mingcute:chat-3-line" aria-hidden="true" />
                  <strong>{{ kind === 'sc' ? `¥${item.price / 1000}` : item.name }}</strong><span>{{ price(item) }}</span>
                </button>
              </div>
              <p v-if="!offers.length" class="gift-status">
                {{ kind === 'sc' && data.scError ? data.scError : t('live_gifts.unavailable') }}
              </p>
              <template v-if="offer">
                <label v-if="kind === 'gift'" class="gift-quantity"><span>{{ t('live_gifts.quantity') }}</span><input
                  v-model.number="quantity" class="live-input" type="number" min="1" :max="offer.maxQuantity"
                  step="1" :disabled="busy"
                ></label>
                <label v-else class="sc-compose"><span>{{ t('live_gifts.sc_text') }} <small>{{ draft.length }}/{{ offer.limit }}</small></span><textarea v-model="draft" class="live-input" rows="3" :maxlength="offer.limit" :disabled="busy" /></label>
                <div class="gift-actions">
                  <span class="gift-total">{{ price(offer, Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1) }}</span><Button type="primary" :disabled="!valid || busy" @click="review">
                    {{ t('live_gifts.review') }}
                  </Button>
                </div>
              </template>
            </div>
          </Transition>
          <Button v-if="!data && !busy && !paying" @click="open(kind)">
            {{ t('live_client.retry') }}
          </Button>
        </div>
      </div>
    </Transition>
  </dialog>
</template>

<style scoped lang="scss">
.gift-dialog .dialog-panel {
  height: auto;
  min-height: 320px;
}
.gift-body {
  display: grid;
  gap: var(--bew-space-4);
}
.gift-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: var(--bew-space-2);
  max-height: 40dvh;
  overflow: auto;
  overscroll-behavior: contain;
  padding: var(--bew-space-1);
}
.gift-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--bew-space-2);
  min-width: 0;
  padding: var(--bew-space-3) var(--bew-space-2);
  border: 1px solid transparent;
  border-radius: var(--bew-radius-xl);
  background: var(--bew-fill-1);
  color: var(--bew-text-1);
  cursor: pointer;
  transition:
    background var(--bew-duration-fast),
    border-color var(--bew-duration-fast),
    transform var(--bew-duration-fast);
  img {
    width: 56px;
    height: 56px;
    object-fit: contain;
  }
  i {
    padding: var(--bew-space-3);
    font-size: var(--bew-icon-size-lg);
    color: var(--bew-theme-color);
  }
  strong {
    font-size: var(--bew-font-size-control);
    line-height: var(--bew-line-height-control);
    font-weight: var(--bew-font-weight-semibold);
  }
  span {
    font-size: var(--bew-font-size-caption);
    line-height: var(--bew-line-height-caption);
    color: var(--bew-text-3);
  }
  &:hover:not(:disabled) {
    background: var(--bew-fill-2);
  }
  &:active:not(:disabled) {
    transform: scale(0.97);
  }
  &[aria-pressed="true"] {
    background: var(--bew-theme-color-10);
    border-color: var(--bew-theme-color);
  }
}
.gift-picker,
.gift-confirm {
  display: grid;
  gap: var(--bew-space-4);
}
.gift-quantity,
.gift-actions,
.sc-compose > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bew-space-3);
}
.gift-quantity input {
  width: 120px;
}
.gift-actions {
  flex-wrap: wrap;
}
.sc-compose {
  display: grid;
  gap: var(--bew-space-2);
}
.sc-compose small {
  color: var(--bew-text-3);
}
.sc-compose textarea {
  resize: vertical;
  min-height: 100px;
  padding: var(--bew-space-3);
}
.gift-total {
  font-weight: var(--bew-font-weight-semibold);
  color: var(--bew-theme-color);
}
.gift-confirm h3 {
  margin: 0;
  font-size: var(--bew-font-size-title);
}
.gift-confirm dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--bew-space-3) var(--bew-space-6);
  margin: 0;
}
.gift-confirm dt {
  color: var(--bew-text-3);
}
.gift-confirm dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
.sc-preview {
  padding: var(--bew-space-4);
  border-radius: var(--bew-radius-xl);
  background: var(--bew-fill-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.gift-status {
  display: flex;
  align-items: center;
  gap: var(--bew-space-3);
  color: var(--bew-text-2);
}
@media (prefers-reduced-motion: reduce) {
  .gift-option {
    transition: none;
  }
}
</style>
