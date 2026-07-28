<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";

const { frontmatter } = useData();

const contributors = computed(() => {
  const value = frontmatter.value.contributors;
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
});
</script>

<template>
  <section class="cageledger-doc-contributors" aria-label="文档维护信息">
    <a class="cageledger-doc-llms-link" href="/docs/LLMs" title="查看面向 AI 助手的文档索引">LLMs.md</a>
    <p v-if="contributors.length">
      <span>文档贡献者</span>
      <strong>{{ contributors.join("、") }}</strong>
    </p>
    <p v-else>文档由 CageLedger 维护者持续更新。</p>
  </section>
</template>
