export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: ["data/**", "dist/**", "docs/archives/**", "node_modules/**", "src/vendor/**", "web-dist/**"],
  rules: {
    "custom-property-pattern": null,
    "declaration-property-value-keyword-no-deprecated": null,
    "keyframes-name-pattern": null,
    "no-descending-specificity": null,
    "no-duplicate-selectors": null,
    "selector-class-pattern": null,
    "selector-id-pattern": null,
  },
};
