import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTheme } from "../../src/theme/visual-system.mjs";

const palette = resolveTheme("light");

// Original project diagrams. Edges express dependencies or a reading order;
// exact permissions and exceptional transitions remain in the adjacent prose.
const diagrams = [
  [
    "system-architecture",
    "系统结构与数据边界",
    "业务数据由 Python API 读写；文档站独立构建，共用视觉 Token。",
    [
      ["浏览器工作台", "React · Ant Design · Query"],
      ["HTTP 与鉴权", "Python 标准库服务"],
      ["领域服务", "校验 · 权限 · 事务 · 审计"],
      ["业务导出", "PDF · Excel · 冻结快照"],
      ["Repository", "SQL 与兼容读写"],
      ["持久存储", "SQLite + 附件目录"],
    ],
    "VitePress 文档站 → /docs/；生产工作台与 /api 由同一服务提供。",
    false,
  ],
  [
    "request-lifecycle",
    "一次业务写入的处理链",
    "页面不直接操作数据库；成功写入后仅刷新相关查询。",
    [
      ["View 与 typed hook", "收集输入与局部草稿"],
      ["API client / handler", "请求契约 · 鉴权 · 响应"],
      ["领域 service", "业务校验 · 事务边界"],
      ["Repository / SQLite", "持久化与兼容数据处理"],
      ["审计与缓存", "记录操作 · 刷新领域缓存"],
      ["Query 与界面", "失效相关查询 · 展示结果"],
    ],
    "失败时保留可恢复输入；并发冲突需重新核对，不能静默覆盖。",
  ],
  [
    "release-delivery",
    "云端发布与交付",
    "日常提交与正式发布分开；每个阶段保留同一源码的证据。",
    [
      ["准备版本与说明", "同步版本 · 更新日志"],
      ["验证与 ARM64 构建", "相关验收 · 构建 · 冒烟"],
      ["推送代码与附注标签", "来源与产物对应"],
      ["Packages 核验", "镜像身份 · 不可变摘要"],
      ["显式发表 Release", "校验既有证据与产物"],
      ["后续显式操作", "更新 latest / 授权部署"],
    ],
    "离线镜像需显式选择；Mac 本地发布为独立的手动备用路径。",
  ],
  [
    "backup-restore",
    "备份与恢复演练",
    "先确认实际数据库路径；SQLite 备份和附件共同组成恢复材料。",
    [
      ["定位运行数据", "DB 路径 · 附件 · 配置"],
      ["取得一致备份", "按备份工具约束执行"],
      ["校验与异地保留", "摘要 · 时间 · 版本"],
      ["恢复到隔离目录", "不覆盖在线数据"],
      ["验证恢复结果", "健康检查 · 记录 · 附件"],
      ["生产恢复", "单独授权后安排切换"],
    ],
    "只复制正在写入的 SQLite 主文件不能代替一致备份；保留 WAL 相关边界。",
  ],
  [
    "business-journey",
    "从动物接收到费用登记",
    "接收、检疫、占用与计费分别记录；相邻业务不会自动代替人工确认。",
    [
      ["预约与笼卡", "识别核对 · 保存 · 打印"],
      ["到货与独立接收", "确认到货 · 实际登记"],
      ["检疫与入驻", "检测确认 / 预留与占用"],
      ["日常巡检", "异常 · 处置 · 复查"],
      ["费用来源", "数量统计表 / 技术服务明细"],
      ["结算与单据跟踪", "分别出单 · 登记 · 锁定"],
    ],
    "此图为业务阅读顺序；检疫不自动限制接收或入驻，笼位图不自动生成正式饲养费账单。",
  ],
  [
    "settlement-lifecycle",
    "流程阶段与归档状态",
    "已登记仍未归档；已发起和已登记都可按授权锁定。",
    [
      ["已生成 · 未归档", "结算列表处理"],
      ["已发起 · 未归档", "进入单据跟踪"],
      ["已登记 · 未归档", "保存结算单交回登记"],
      ["撤回 / 撤销", "按权限与原因逐级处理"],
      ["锁定 · 已归档", "已发起或已登记均可锁定"],
      ["解锁 · 未归档", "恢复锁定前阶段与资料"],
    ],
    "上排：生成 → 发起 → 登记。下排为独立操作说明；锁定授权与资金关联保护始终有效。",
    false,
  ],
  [
    "quarantine-workflow",
    "检疫批次与报告版本",
    "检测出具与整批完成分别确认，历史报告保留独立版本。",
    [
      ["待检疫来源", "全部接收 / 手工来源"],
      ["建立检疫批次", "冻结编号 · 保存覆盖范围"],
      ["检测与原始资料", "寄生虫 · ELISA · PCR"],
      ["出具与异常处理", "正式报告 · 分供应商复检"],
      ["人工确认完成", "所需报告与最终结论齐备"],
      ["更正或复检", "重新进入检疫中并再确认"],
    ],
    "检疫完成不改写接收状态；下载汇总草稿不推进批次或检测状态。",
  ],
  [
    "quantity-billing",
    "数量统计表到月度饲养费",
    "正式核算以数量统计表为来源，按项目负责人逐日计算。",
    [
      ["读取每日实际数量", "月份 · 房间 · IACUC"],
      ["区分收费范围", "自定义部分独立计费"],
      ["判断减免资格", "计费日期内的 IACUC 有效期"],
      ["分配 PI 每日额度", "全免 · 固定优先 · 余量分配"],
      ["计算标准与梯度费用", "自定义部分不参与累计"],
      ["汇总与冻结版本", "按月 / PI 出单 · 发起时冻结"],
    ],
    "本图概括核算步骤；设施、物种、计费单位与适用减免规则详见正文。",
  ],
];
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const out = resolve(import.meta.dirname, "../../wiki/public/diagrams");
mkdirSync(out, { recursive: true });
for (const [id, title, description, nodes, note, snake = true] of diagrams) {
  const positions = snake
    ? [
        [32, 132],
        [352, 132],
        [672, 132],
        [672, 308],
        [352, 308],
        [32, 308],
      ]
    : [
        [32, 132],
        [352, 132],
        [672, 132],
        [32, 308],
        [352, 308],
        [672, 308],
      ];
  let edges = snake
    ? '<path d="M312 184H344 M632 184H664 M812 236V300 M672 360H640 M352 360H320"/>'
    : '<path d="M312 184H344 M632 184H664"/>';
  if (id === "system-architecture")
    edges = '<path d="M312 184H344 M632 184H664 M812 236V272H492V300 M492 272H172V300 M632 360H664"/>';
  // SVG markers apply to a path's final vertex: keep every connection separate.
  const edgeMarkup = [...edges.matchAll(/d="([^"]+)"/g)]
    .flatMap(([, path]) =>
      path
        .split(/(?=M)/)
        .filter(Boolean)
        .map((segment) => `<path d="${segment}"/>`),
    )
    .join("");
  const noteLines = [];
  let line = "";
  let units = 0;
  for (const character of note) {
    const width = character.charCodeAt(0) < 128 ? 0.55 : 1;
    if (units + width > 59) {
      noteLines.push(line);
      line = "";
      units = 0;
    }
    line += character;
    units += width;
  }
  if (line) noteLines.push(line);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="984" height="528" viewBox="0 0 984 528" role="img" aria-labelledby="${id}-title ${id}-desc">
<title id="${id}-title">${escape(title)}</title><desc id="${id}-desc">${escape(description + " " + nodes.map((n, i) => `${i + 1}. ${n.join("：")}`).join("；") + "。" + note)}</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="${palette.blue7}"/></marker></defs>
<rect width="984" height="528" rx="8" fill="${palette.colorBgContainer}"/>
<g font-family="${escape(palette.fontFamily)}">
<text x="32" y="48" fill="${palette.colorText}" font-size="26" font-weight="600">${escape(title)}</text>
<text x="32" y="84" fill="${palette.colorTextSecondary}" font-size="17">${escape(description)}</text>
<g fill="none" stroke="${palette.blue7}" stroke-width="2" marker-end="url(#arrow)">${edgeMarkup}</g>
${nodes
  .map(([label, detail], index) => {
    const [x, y] = positions[index];
    return `<g><rect x="${x}" y="${y}" width="280" height="104" rx="8" fill="${palette.colorPrimaryBg}" stroke="${palette.colorPrimaryBorder}"/><text x="${x + 20}" y="${y + 34}" fill="${palette.blue7}" font-size="14" font-weight="600">0${index + 1}</text><text x="${x + 20}" y="${y + 61}" fill="${palette.colorText}" font-size="21" font-weight="600">${escape(label)}</text><text x="${x + 20}" y="${y + 86}" fill="${palette.colorTextSecondary}" font-size="16">${escape(detail)}</text></g>`;
  })
  .join("\n")}
<path d="M32 448H952" stroke="${palette.colorBorderSecondary}"/>${noteLines.map((text, index) => `<text x="32" y="${478 + index * 24}" fill="${palette.colorTextSecondary}" font-size="15">${escape(text)}</text>`).join("")}</g></svg>\n`;
  writeFileSync(resolve(out, `${id}.svg`), svg);
}
console.log(`Generated ${diagrams.length} original documentation diagrams.`);
