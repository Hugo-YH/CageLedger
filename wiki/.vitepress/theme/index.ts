import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import DocContributors from "./DocContributors.vue";
import "./styles.css";

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { "doc-footer-before": () => h(DocContributors) }),
};
