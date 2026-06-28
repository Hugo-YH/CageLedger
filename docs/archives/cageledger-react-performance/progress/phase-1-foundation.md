# Phase 1: 基线与构建

**Status**: Complete

- [x] Task 1.1：性能临时数据和基准脚本；10 万记录和 20 并发基准已输出。
- [x] Task 1.2：React/Vite/TypeScript、Vitest、Playwright 构建链；check/build/test/e2e 已运行。
- [x] Task 1.3：typed API、Query 缓存和 UI state；认证、bootstrap、API error 和 reducer 测试通过。

## Notes

- React 当前通过动态兼容模块装载完整旧业务界面，正式切换前逐页替换兼容模块。
- `jsQR` 已从首屏移出并生成独立异步 chunk。
