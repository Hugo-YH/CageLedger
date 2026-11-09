<script setup lang="ts">
import { withBase } from "vitepress";

defineProps<{ src: string; alt: string; caption: string; kind?: "screenshot" | "diagram" }>();
</script>

<template>
  <figure class="doc-figure" :class="{ 'doc-figure-diagram': kind === 'diagram' }">
    <a :href="withBase(src)" target="_blank" rel="noopener" :aria-label="`${alt}，在新标签页查看原图`">
      <img
        :src="withBase(src)"
        :alt="alt"
        :width="kind === 'diagram' ? 984 : 1440"
        :height="kind === 'diagram' ? 528 : 960"
        loading="lazy"
        decoding="async"
      />
    </a>
    <figcaption>{{ caption }} <span>点击图片可查看原图。</span></figcaption>
  </figure>
</template>
