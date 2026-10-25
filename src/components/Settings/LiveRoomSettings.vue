<script setup lang="ts">
import { settings } from '~/logic'

import Radio from '../Radio.vue'
import SettingsItem from './components/SettingsItem.vue'
import SettingsItemGroup from './components/SettingsItemGroup.vue'
</script>

<template>
  <SettingsItemGroup :title="$t('live_room.title')">
    <SettingsItem :title="$t('live_room.enhanced')" :desc="$t('live_room.description')" right-width="auto">
      <Radio v-model="settings.liveRoomEnhanced" />
    </SettingsItem>
    <SettingsItem :title="$t('live_room.remember')" :desc="$t('live_room.remember_desc')" right-width="auto">
      <Radio v-model="settings.liveRoomRememberPreferences" />
    </SettingsItem>
    <SettingsItem :title="$t('live_room.background')" :desc="$t('live_room.background_desc')" right-width="auto">
      <Radio v-model="settings.liveRoomBackground" />
    </SettingsItem>
    <SettingsItem :title="$t('live_room.show_sc')" right-width="auto">
      <Radio v-model="settings.liveRoomShowSuperChats" />
    </SettingsItem>
    <SettingsItem :title="$t('live_room.hide_gift_effects')" right-width="auto">
      <Radio v-model="settings.liveRoomHideGiftEffects" />
    </SettingsItem>
    <SettingsItem :title="$t('live_room.hide_gifts')" right-width="auto">
      <Radio v-model="settings.liveRoomHideGifts" />
    </SettingsItem>
    <SettingsItem :title="$t('live_room.hide_entry')" right-width="auto">
      <Radio v-model="settings.liveRoomHideEntryEffects" />
    </SettingsItem>
  </SettingsItemGroup>
</template>
