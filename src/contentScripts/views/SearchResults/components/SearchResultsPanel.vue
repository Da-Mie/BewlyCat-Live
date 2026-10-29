<script setup lang="ts">
import { computed, ref } from 'vue'

import AllSearchPage from '../pages/AllSearchPage.vue'
import ArticleSearchPage from '../pages/ArticleSearchPage.vue'
import BangumiSearchPage from '../pages/BangumiSearchPage.vue'
import LiveSearchPage from '../pages/LiveSearchPage.vue'
import MediaFtSearchPage from '../pages/MediaFtSearchPage.vue'
import UserSearchPage from '../pages/UserSearchPage.vue'
import VideoSearchPage from '../pages/VideoSearchPage.vue'
import type { SearchCategory } from '../types'

const props = defineProps<{
  currentCategory: SearchCategory
  keyword: string
  videoFilters: {
    order: string
    duration: number
    timeRange: string
    customStartDate: string
    customEndDate: string
  }
  userFilters: {
    order: string
    userType: number
  }
  liveFilters: {
    subCategory: 'all' | 'live_room' | 'live_user'
    roomOrder: string
    userOrder: string
  }
  initialPage: number
}>()

const emit = defineEmits<{
  updatePage: [page: number]
  switchToLiveUser: []
}>()

// Page 组件的 refs
const allPageRef = ref<InstanceType<typeof AllSearchPage>>()
const videoPageRef = ref<InstanceType<typeof VideoSearchPage>>()
const bangumiPageRef = ref<InstanceType<typeof BangumiSearchPage>>()
const mediaFtPageRef = ref<InstanceType<typeof MediaFtSearchPage>>()
const userPageRef = ref<InstanceType<typeof UserSearchPage>>()
const livePageRef = ref<InstanceType<typeof LiveSearchPage>>()
const articlePageRef = ref<InstanceType<typeof ArticleSearchPage>>()

// 当前激活的 Page 组件
const currentPageRef = computed(() => {
  switch (props.currentCategory) {
    case 'all':
      return allPageRef.value
    case 'video':
      return videoPageRef.value
    case 'bangumi':
      return bangumiPageRef.value
    case 'media_ft':
      return mediaFtPageRef.value
    case 'user':
      return userPageRef.value
    case 'live':
      return livePageRef.value
    case 'article':
      return articlePageRef.value
    default:
      return null
  }
})

// 处理滚动到底部事件
function handleReachBottom() {
  const page = currentPageRef.value
  if (page?.isLoading)
    return

  if (page && page.requestLoadMore) {
    page.requestLoadMore()
  }
}

// 处理页码更新
function handleUpdatePage(page: number) {
  emit('updatePage', page)
}

defineExpose({
  handleReachBottom,
})
</script>

<template>
  <div class="search-results-panel">
    <AllSearchPage
      v-if="currentCategory === 'all'"
      ref="allPageRef"
      :keyword="keyword"
      :filters="videoFilters"
      :initial-page="initialPage"
      @update-page="handleUpdatePage"
    />

    <VideoSearchPage
      v-if="currentCategory === 'video'"
      ref="videoPageRef"
      :keyword="keyword"
      :filters="videoFilters"
      :initial-page="initialPage"
      @update-page="handleUpdatePage"
    />

    <BangumiSearchPage
      v-if="currentCategory === 'bangumi'"
      ref="bangumiPageRef"
      :keyword="keyword"
      :initial-page="initialPage"
      @update-page="handleUpdatePage"
    />

    <MediaFtSearchPage
      v-if="currentCategory === 'media_ft'"
      ref="mediaFtPageRef"
      :keyword="keyword"
      :initial-page="initialPage"
      @update-page="handleUpdatePage"
    />

    <UserSearchPage
      v-if="currentCategory === 'user'"
      ref="userPageRef"
      :keyword="keyword"
      :filters="userFilters"
      :initial-page="initialPage"
      @update-page="handleUpdatePage"
    />

    <LiveSearchPage
      v-if="currentCategory === 'live'"
      ref="livePageRef"
      :keyword="keyword"
      :filters="liveFilters"
      :initial-page="initialPage"
      @update-page="handleUpdatePage"
      @switch-to-live-user="emit('switchToLiveUser')"
    />

    <ArticleSearchPage
      v-if="currentCategory === 'article'"
      ref="articlePageRef"
      :keyword="keyword"
      :initial-page="initialPage"
      @update-page="handleUpdatePage"
    />
  </div>
</template>

<style scoped lang="scss">
.search-results-panel {
  width: 100%;
}
</style>
