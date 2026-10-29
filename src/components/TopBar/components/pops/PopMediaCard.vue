<script setup lang="ts">
/** 共用左封面卡片骨架；业务内容走插槽，外层链接须为块级。 */
withDefaults(defineProps<{
  title: string
  /** 已由调用方加工好的封面图 URL（含 @尺寸后缀） */
  cover: string
  alt?: string
  /** 作者名；与 authorHref 同时提供时渲染默认作者链接行 */
  authorName?: string
  authorHref?: string
  /** 窄封面 120px（收藏 / 动态）；默认 160px（稍后再看 / 历史） */
  narrow?: boolean
  /** 交叉轴拉伸（动态弹窗需要文案区与封面列同高，把作者行压到底部） */
  stretch?: boolean
  /** 封面图按 contain 展示（历史的专栏封面） */
  contain?: boolean
  /** 追加到封面列 / 文案区 / 标题的自定义类 */
  coverClass?: string
  copyClass?: string
  titleClass?: string
}>(), {
  alt: '',
  narrow: false,
  stretch: false,
  contain: false,
})
</script>

<template>
  <section
    flex="~ gap-4"
    :items="stretch ? 'stretch' : 'start'"
  >
    <div
      class="bew-top-bar-media-column"
      :class="[coverClass, {
        'bew-top-bar-media-column--narrow': narrow,
      }]"
      bg="$bew-skeleton"
      pos="relative"
      of="hidden"
    >
      <slot name="coverTopLeft" />
      <slot name="coverTopRight" />

      <div class="bew-top-bar-media-frame">
        <img
          w-full h-full
          :src="cover"
          :alt="alt || title"
          object-cover
          :bg="contain ? 'contain' : undefined"
          loading="lazy"
          decoding="async"
        >

        <slot name="coverOverlay" />
      </div>

      <slot name="coverBelow" />
    </div>

    <div class="bew-top-bar-media-copy" :class="copyClass">
      <h3
        :title="title"
        class="bew-top-bar-media-title"
        :class="titleClass"
      >
        {{ title }}
      </h3>

      <slot name="byline">
        <div
          v-if="authorName"
          text="$bew-text-2"
          m="t-2"
          flex="~ items-center min-w-0"
        >
          <ALink
            :href="authorHref"
            type="topBar"
            :stop-propagation="true"
            class="bew-top-bar-media-author"
          >
            {{ authorName }}
          </ALink>

          <slot name="bylineExtra" />
        </div>
      </slot>

      <slot name="meta" />
    </div>
  </section>
</template>
