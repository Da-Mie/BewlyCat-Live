<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Radio from '~/components/Radio.vue'
import { settings } from '~/logic'
import type { AccountFilterScope } from '~/utils/accountLevelFilter'
import { ACCOUNT_FILTER_SCOPES, normalizeAccountMid } from '~/utils/accountLevelFilter'

import SettingsToggleTag from './components/SettingsToggleTag.vue'

const { scope, showHeading = true } = defineProps<{ scope?: AccountFilterScope, showHeading?: boolean }>()
const { t } = useI18n()
const scopes = computed(() => scope ? [scope] : ACCOUNT_FILTER_SCOPES)
const levels = [0, 1, 2, 3, 4, 5, 6] as const
const draftWhitelist = ref('')
const whitelistError = ref(false)
const scopeIcons: Record<AccountFilterScope, string> = {
  comments: 'i-mingcute:comment-line',
  videos: 'i-mingcute:video-line',
  liveDanmaku: 'i-mingcute:live-line',
}

watch(() => settings.value.accountLevelFilters.whitelist.join('\n'), (value) => {
  draftWhitelist.value = value
}, { immediate: true })

function toggleLevel(target: AccountFilterScope, level: number, blocked: boolean) {
  const current = settings.value.accountLevelFilters[target].blockedLevels
  settings.value.accountLevelFilters[target].blockedLevels = blocked
    ? [...new Set([...current, level])].sort((a, b) => a - b)
    : current.filter(value => value !== level)
}

function saveWhitelist() {
  const tokens = draftWhitelist.value.split(/[\s,;，；]+/).filter(Boolean)
  if (tokens.some(value => !normalizeAccountMid(value)) || tokens.length > 500) {
    whitelistError.value = true
    return
  }
  whitelistError.value = false
  settings.value.accountLevelFilters.whitelist = [...new Set(tokens)]
  draftWhitelist.value = settings.value.accountLevelFilters.whitelist.join('\n')
}
</script>

<template>
  <section class="account-level-settings" :aria-label="t('account_filter.title')">
    <header v-if="showHeading" class="account-filter-intro">
      <h2 class="bew-page-heading">
        {{ t('account_filter.title') }}
      </h2>
      <p>{{ t('account_filter.description') }}</p>
    </header>
    <section v-for="target in scopes" :key="target" class="account-filter-card" :aria-labelledby="`account-filter-${target}`">
      <header class="account-filter-card-header">
        <h3 :id="`account-filter-${target}`">
          <span :class="scopeIcons[target]" aria-hidden="true" />{{ t(`account_filter.scope_${target}`) }}
        </h3>
        <Radio v-model="settings.accountLevelFilters[target].enabled" :label="t('account_filter.enabled')" />
      </header>
      <div v-if="settings.accountLevelFilters[target].enabled" class="account-filter-card-body">
        <div>
          <p class="account-filter-caption">
            {{ t('account_filter.levels') }}
          </p>
          <p class="account-filter-hint">
            {{ t('account_filter.levels_hint') }}
          </p>
        </div>
        <div class="account-filter-levels" role="group" :aria-label="t('account_filter.levels')">
          <SettingsToggleTag
            v-for="level in levels" :key="level" class="account-level-chip"
            :model-value="settings.accountLevelFilters[target].blockedLevels.includes(level)"
            :label="level === 6 ? t('account_filter.ordinary_six') : `LV${level}`"
            icon="i-mingcute:check-line" :show-state-icon="false"
            @update:model-value="toggleLevel(target, level, $event)"
          />
          <SettingsToggleTag
            v-model="settings.accountLevelFilters[target].blockSenior"
            class="account-level-chip" :label="t('account_filter.senior')"
            icon="i-mingcute:check-line" :show-state-icon="false"
          />
        </div>
        <div class="account-filter-policy">
          <span>{{ t('account_filter.unknown') }}</span>
          <div class="bew-segment-control bew-segment-control--static" role="group" :aria-label="`${t(`account_filter.scope_${target}`)} · ${t('account_filter.unknown')}`">
            <button
              v-for="policy in (['allow', 'block'] as const)" :key="policy"
              type="button" class="bew-segment-control__item"
              :data-active="settings.accountLevelFilters[target].unknown === policy"
              :aria-pressed="settings.accountLevelFilters[target].unknown === policy"
              @click="settings.accountLevelFilters[target].unknown = policy"
            >
              {{ t(`account_filter.policy_${policy}`) }}
            </button>
          </div>
        </div>
      </div>
      <p v-else class="account-filter-disabled-note">
        {{ t('account_filter.disabled_hint') }}
      </p>
    </section>
    <section class="account-filter-card" :aria-label="t('account_filter.exceptions')">
      <header class="account-filter-card-header">
        <h3>{{ t('account_filter.exceptions') }}</h3>
      </header>
      <div class="account-filter-card-body">
        <Radio v-model="settings.accountLevelFilters.exemptSelf" :label="t('account_filter.exempt_self')" />
        <Radio v-model="settings.accountLevelFilters.exemptFollowed" :label="t('account_filter.exempt_followed')" />
        <label class="account-filter-whitelist">
          <span>{{ t('account_filter.whitelist') }}</span>
          <textarea
            v-model="draftWhitelist" rows="3" inputmode="numeric" spellcheck="false" :aria-invalid="whitelistError"
            @blur="saveWhitelist"
          />
          <span v-if="whitelistError" class="account-filter-error" role="alert">{{ t('account_filter.whitelist_error') }}</span>
          <span v-else class="account-filter-hint">{{ t('account_filter.whitelist_hint') }}</span>
        </label>
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
.account-level-settings {
  display: grid;
  gap: var(--bew-space-4);
  color: var(--bew-text-1);
  font-size: var(--bew-font-size-body);
  line-height: var(--bew-line-height-body);
}
.account-filter-intro {
  display: grid;
  gap: var(--bew-space-2);
  h2,
  p {
    margin: 0;
  }
  p {
    color: var(--bew-text-3);
  }
}
.account-filter-card {
  border: 1px solid var(--bew-border-color);
  border-radius: var(--bew-panel-radius);
  background: var(--bew-fill-1);
  overflow: hidden;
}
.account-filter-card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--bew-space-3);
  padding: var(--bew-space-4);
  h3 {
    display: flex;
    align-items: center;
    gap: var(--bew-space-2);
    margin: 0;
    font-size: var(--bew-font-size-title);
    line-height: var(--bew-line-height-title);
    font-weight: var(--bew-font-weight-semibold);
  }
}
.account-filter-card-body {
  display: grid;
  gap: var(--bew-space-4);
  padding: 0 var(--bew-space-4) var(--bew-space-4);
}
.account-filter-caption {
  margin: 0;
  font-weight: var(--bew-font-weight-medium);
}
.account-filter-hint,
.account-filter-disabled-note {
  margin: 0;
  color: var(--bew-text-3);
  font-size: var(--bew-font-size-control);
  line-height: var(--bew-line-height-control);
}
.account-filter-disabled-note {
  padding: 0 var(--bew-space-4) var(--bew-space-4);
}
.account-filter-levels {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bew-space-2);
}
:deep(.account-level-chip) {
  min-width: calc(var(--bew-space-8) * 2);
  justify-content: center;
}
:deep(.account-level-chip:not(.is-active) > span:first-child) {
  opacity: 0;
}
.account-filter-policy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--bew-space-3);
  padding-top: var(--bew-space-3);
  border-top: 1px solid var(--bew-border-color);
}
.account-filter-whitelist {
  display: grid;
  gap: var(--bew-space-2);
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: var(--bew-space-3);
    border: 1px solid var(--bew-border-color);
    border-radius: var(--bew-interactive-radius);
    color: var(--bew-text-1);
    background: var(--bew-elevated-solid);
    font: inherit;
    resize: vertical;
    &:focus-visible {
      outline: 2px solid var(--bew-theme-color);
    }
    &[aria-invalid="true"] {
      border-color: var(--bew-error-color);
    }
  }
}
.account-filter-error {
  color: var(--bew-error-color);
  font-size: var(--bew-font-size-control);
}
</style>
