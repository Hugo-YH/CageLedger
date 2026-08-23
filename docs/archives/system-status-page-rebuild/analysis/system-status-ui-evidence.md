# System Status UI Evidence

## Automated browser evidence

- 管理员可看到缓存、HTTP 与 SQLite 运行指标，并可手动刷新。
- 房间管理员不会请求 `/api/system/environment`，也不会看到运维指标。
- 1280px、1180px、760px 与 844×390 手机横屏均无横向溢出。
- 运行脉搏带分别使用 5、3、2、3 列布局，保持单一响应式归属。
- Axe serious/critical 扫描通过；标题层级、交互名称与进度条可访问名称完整。

## Computed layout evidence

| Viewport | Pulse columns | Horizontal overflow |
| :------- | :------------ | :------------------ |
| 1280px   | 5             | None                |
| 1180px   | 3             | None                |
| 760px    | 2             | None                |
| 844×390  | 3             | None                |

## Validation evidence

- `npm run check`: 92 Vitest、202 Python tests 及全部静态门禁通过。
- 目标 Playwright：系统状态权限/刷新、视觉契约、登录导航和 Axe 通过。
- `npm run smoke:api`: 9 项通过。
- `npm run benchmark`: 10,000 笼位、100,000 记录基准通过。
- `npm run build`: 应用与 VitePress 生产构建通过。
