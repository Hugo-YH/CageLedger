import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import DocFigure from "./DocFigure.vue";
import type { Theme } from "vitepress";
import DocContributors from "./DocContributors.vue";
import "./styles.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DocFigure", DocFigure);
  },
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "nav-bar-content-after": () =>
        h(
          "a",
          {
            class: "cageledger-app-link VPButton medium brand",
            href: "/app",
            // VitePress intercepts same-origin links. A native navigation reaches
            // the React application's root route instead of the docs router.
            target: "_self",
          },
          "进入系统",
        ),
      "doc-footer-before": () => h(DocContributors),
    }),
} satisfies Theme;
