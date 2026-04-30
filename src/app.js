const STORAGE_KEY = "cageledger.v1";
const LEGACY_STORAGE_KEY = "lahcas.v1";
const API_AUTH_ME_URL = "/api/auth/me";
const API_LOGIN_URL = "/api/auth/login";
const API_LOGOUT_URL = "/api/auth/logout";
const API_USERS_URL = "/api/users";
const API_IACUC_INDEX_URL = "/api/iacuc-index";
const API_IACUC_UPLOAD_URL = "/api/iacuc-index/upload";
const API_PRINCIPAL_IDENTITIES_URL = "/api/principal-identities";
const API_SYSTEM_INFO_URL = "/api/system/info";
const API_SYSTEM_UPDATE_URL = "/api/system/update-check";
const API_BILLING_STATEMENT_GENERATE_URL = "/api/billing-statements/generate";
const API_QUANTITY_SHEETS_URL = "/api/quantity-sheets";
const API_INFRASTRUCTURE_URL = "/api/infrastructure";
const ENTITY_API_URLS = {
  rooms: "/api/rooms",
  racks: "/api/racks",
  slots: "/api/cage-slots",
  occupancies: "/api/occupancies",
  billingRules: "/api/billing-rules",
  adjustments: "/api/billing-adjustments",
  auditLogs: "/api/audit-events",
};
const SYSTEM_RELEASE_NOTES = [
  {
    version: "0.3.6",
    title: "登录审计记录",
    items: [
      "操作日志新增登录成功记录，便于追溯账号访问时间",
      "登录审计记录包含账号、角色、客户端 IP 和 User-Agent 信息",
      "同步版本号、部署文档、Release、离线包和容器镜像发布配置",
    ],
  },
  {
    version: "0.3.5",
    title: "用户手册完善",
    items: [
      "新增完整用户手册，覆盖角色权限、功能操作、SOP、常见问题和数据安全建议",
      "补充技术栈、项目结构、API 概览、数据表、部署更新和发布流程说明",
      "同步 README 文档入口，便于系统管理页和仓库首页查阅手册",
    ],
  },
  {
    version: "0.3.4",
    title: "权限与界面交互优化",
    items: [
      "房间管理员仅展示并可编辑已授权饲养间，禁止访问未授权房间的笼架和笼位数据",
      "笼位图与房间管理默认预览模式，编辑操作改为点击按钮后弹出编辑窗口",
      "饲养费核算子页改为“动态笼位图（自动）/数量统计表（录入）”，并优化必填提示与删除图标样式",
    ],
  },
  {
    version: "0.3.3",
    title: "房间和笼架管理优化",
    items: [
      "新增饲养间不再自动生成笼架，笼架可按实际编号单独添加、删除和编辑",
      "笼架新增后保留当前表单内容并自动递增编号，便于连续录入同规格笼架",
      "补齐 tag 发布自动化，推送 v* 标签后自动生成 Release、离线包和容器镜像",
    ],
  },
  {
    version: "0.3.2",
    title: "设施结构和窄屏导航修复",
    items: ["设施创建改为批量保存，避免笼位半量写入", "新增笼架编辑和非连续编号支持", "优化窄屏导航栏和退出按钮布局"],
  },
  {
    version: "0.3.1",
    title: "项目负责人汇总计费",
    items: ["按项目负责人汇总多个 IACUC 结算", "新增项目负责人身份管理和 20/10 笼免费额度", "支持阶梯计价、离线包和 Release 自动发布"],
  },
  {
    version: "0.3.0",
    title: "数量统计表结算",
    items: ["新增数量统计表录入与保存", "支持按纸质统计表生成饲养费明细和结算单", "完善表单提示和 IACUC 支撑经费回填"],
  },
  {
    version: "0.2.1",
    title: "离线部署和文档整理",
    items: ["支持 NAS 离线源码包构建", "README 拆分为入口文档、API 文档和部署文档", "补充环境变量模板和 Docker 构建忽略规则"],
  },
  {
    version: "0.2.0",
    title: "共享模式和权限基础",
    items: ["SQLite 拆表存储", "系统管理员和房间管理员账号", "IACUC CSV 上传、审计日志和系统更新检查"],
  },
];
const SYSTEM_DOC_LINKS = [
  { title: "API 和数据模型", href: "./docs/API.md", description: "接口路径、账号权限、实体 API、IACUC 索引和主要数据表。" },
  { title: "部署说明", href: "./docs/DEPLOYMENT.md", description: "Docker Compose、群晖、离线源码包和 GHCR 镜像发布。" },
  { title: "环境变量模板", href: "./.env.example", description: "后端监听、数据库路径、初始管理员、单位信息和更新检查配置。" },
];
const SYSTEM_API_GROUPS = [
  { title: "认证与账号", endpoints: ["POST /api/auth/login", "POST /api/auth/logout", "GET /api/auth/me", "GET /api/users", "POST /api/users"] },
  { title: "笼位与设施", endpoints: ["GET /api/rooms", "GET /api/racks", "GET /api/cage-slots", "GET /api/occupancies"] },
  { title: "计费与审计", endpoints: ["GET /api/billing-rules", "GET /api/billing-statements", "POST /api/billing-statements/generate", "GET /api/audit-events"] },
  { title: "系统与数据", endpoints: ["GET /api/health", "GET /api/system/info", "GET /api/system/update-check", "POST /api/iacuc-index/upload"] },
];
let IACUC_INDEX = [];
let IACUC_BY_NUMBER = new Map();
let PRINCIPAL_IDENTITIES = [];
let PRINCIPAL_IDENTITY_BY_NAME = new Map();
let iacucIndexMeta = null;
let systemUpdateInfo = null;
let systemInfo = {
  name: "CageLedger",
  title: "CageLedger 实验动物笼位管理与计费系统",
  description: "实验动物笼位管理与计费系统",
  version: "0.3.6",
  organization: "中山大学中山眼科中心",
  department: "实验动物中心",
  developer: "Hugo",
  contactEmail: "info@cellnucle.us",
  license: "Apache-2.0",
  copyright: "© 2026 中山大学中山眼科中心 实验动物中心. Licensed under Apache-2.0.",
};
let remotePersistence = false;
let currentUser = null;
let users = [];
const MONEY_FORMAT = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const BILLING_PRINCIPAL_PI = "pi";
const BILLING_PRINCIPAL_INDEPENDENT = "independent";
const FREE_CAGES_PI = 20;
const FREE_CAGES_INDEPENDENT = 10;
const FREE_CAGES_DEFAULT = FREE_CAGES_PI;
const BILLING_TIER_LIMIT = 160;
const BILLING_TIER_BASE_PRICE = 4.5;
const BILLING_TIER_OVER_PRICE = 6.5;

const today = formatLocalDate(new Date());

const seedData = {
  activeView: "dashboard",
  selectedRoomId: "room-spf-a",
  selectedRackId: "rack-spf-a-1",
  selectedSlotId: "slot-spf-a-1-1-1",
  selectedSlotIds: [],
  batchMode: false,
  samplingMode: "",
  sidebarCollapsed: false,
  rackFormDraft: {
    roomId: "",
    rows: 5,
    cols: 6,
  },
  showCageEditor: false,
  showRoomForm: false,
  showRackForm: false,
  billingSource: "cage_map",
  billingMonth: today.slice(0, 7),
  billingIacuc: "IACUC-2026-001",
  billingPi: "张教授",
  billingPrincipalType: BILLING_PRINCIPAL_PI,
  freeCageAllowance: FREE_CAGES_DEFAULT,
  selectedQuantitySheetId: "",
  quantitySheetDraft: makeQuantitySheetDraft(today.slice(0, 7)),
  quantitySheets: [],
  principalIdentityFilter: "",
  slotFilter: "all",
  baseRate: 4.5,
  rooms: [
    {
      id: "room-spf-a",
      name: "SPF 小鼠饲养间 A",
      area: "屏障区",
      rackCount: 2,
      rows: 5,
      cols: 6,
    },
    {
      id: "room-spf-b",
      name: "SPF 小鼠饲养间 B",
      area: "屏障区",
      rackCount: 1,
      rows: 4,
      cols: 5,
    },
  ],
  racks: [],
  slots: [],
  occupancies: [
    {
      id: "occ-001",
      slotId: "slot-spf-a-1-1-1",
      cageCode: "M-A001",
      status: "active",
      iacuc: "IACUC-2026-001",
      project: "肿瘤免疫治疗机制研究",
      pi: "张教授",
      owner: "李博士",
      startDate: `${today.slice(0, 7)}-01`,
      endDate: "",
      notes: "雌性 C57BL/6，8 周龄",
      updatedAt: today,
    },
    {
      id: "occ-002",
      slotId: "slot-spf-a-1-1-2",
      cageCode: "M-A002",
      status: "active",
      iacuc: "IACUC-2026-001",
      project: "肿瘤免疫治疗机制研究",
      pi: "张教授",
      owner: "李博士",
      startDate: `${today.slice(0, 7)}-05`,
      endDate: "",
      notes: "同批次扩笼",
      updatedAt: today,
    },
    {
      id: "occ-003",
      slotId: "slot-spf-a-1-2-1",
      cageCode: "M-B017",
      status: "active",
      iacuc: "IACUC-2026-002",
      project: "代谢表型观察",
      pi: "王老师",
      owner: "陈实验师",
      startDate: `${today.slice(0, 7)}-03`,
      endDate: "",
      notes: "高脂饲料组",
      updatedAt: today,
    },
    {
      id: "occ-004",
      slotId: "slot-spf-a-2-1-1",
      cageCode: "RES-009",
      status: "reserved",
      iacuc: "IACUC-2026-003",
      project: "行为学预实验",
      pi: "赵老师",
      owner: "周同学",
      startDate: addDays(today, 2),
      endDate: "",
      notes: "预计本周进驻",
      updatedAt: today,
    },
  ],
  auditLogs: [],
  billingRules: [
    {
      id: "rule-base-mouse",
      name: "小鼠 IVC 基础饲养费",
      unit: "cage_day",
      price: 4.5,
      effectiveStart: "2026-01-01",
      effectiveEnd: "",
    },
  ],
  adjustments: [],
};

let state = normalize(structuredClone(seedData));

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return structuredClone(seedData);

  try {
    return JSON.parse(raw);
  } catch {
    return structuredClone(seedData);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadPersistedState() {
  try {
    remotePersistence = true;
    const entityState = await loadEntityState();
    state = normalize(entityState);
    selectFirstAvailableCage();
    return;
  } catch {
    remotePersistence = false;
  }

  state = normalize(loadState());
}

async function loadEntityState() {
  const localState = loadState();
  const entries = await Promise.all(
    Object.entries(ENTITY_API_URLS).map(async ([key, url]) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load ${url}`);
      const payload = await response.json();
      return [key, payload.items || []];
    }),
  );
  const quantityResponse = await fetch(API_QUANTITY_SHEETS_URL, { cache: "no-store" });
  if (!quantityResponse.ok) throw new Error(`Failed to load ${API_QUANTITY_SHEETS_URL}`);
  const quantityPayload = await quantityResponse.json();
  const quantitySheets = quantityPayload.items || [];
  const entityData = Object.fromEntries(entries);

  const billingRules = entityData.billingRules || [];
  const firstIacuc = entityData.occupancies?.find((item) => item.iacuc)?.iacuc || "";
  const firstPi = entityData.occupancies?.find((item) => item.pi)?.pi || "";
  const knownIacucs = new Set((entityData.occupancies || []).map((item) => normalizeIacucNumber(item.iacuc)).filter(Boolean));
  const localBillingIacuc = knownIacucs.has(normalizeIacucNumber(localState.billingIacuc)) ? localState.billingIacuc : "";
  const knownPis = new Set([...(entityData.occupancies || []).map((item) => normalizePersonName(item.pi)), ...quantitySheets.map((item) => normalizePersonName(item.pi))].filter(Boolean));
  const localBillingPi = knownPis.has(normalizePersonName(localState.billingPi)) ? localState.billingPi : "";
  const selectedQuantitySheet = quantitySheets.find((sheet) => sheet.id === localState.selectedQuantitySheetId) || quantitySheets[0];

  return {
    ...structuredClone(seedData),
    activeView: localState.activeView || seedData.activeView,
    selectedRoomId: localState.selectedRoomId || "",
    selectedRackId: localState.selectedRackId || "",
    selectedSlotId: localState.selectedSlotId || "",
    billingSource: localState.billingSource || seedData.billingSource,
    billingMonth: localState.billingMonth || today.slice(0, 7),
    billingIacuc: localBillingIacuc || firstIacuc,
    billingPi: localBillingPi || selectedQuantitySheet?.pi || firstPi,
    billingPrincipalType: principalTypeForPi(localBillingPi || selectedQuantitySheet?.pi || firstPi),
    freeCageAllowance: Number(localState.freeCageAllowance ?? seedData.freeCageAllowance),
    selectedQuantitySheetId: selectedQuantitySheet?.id || "",
    quantitySheetDraft: selectedQuantitySheet || makeQuantitySheetDraft(localState.billingMonth || today.slice(0, 7)),
    quantitySheets,
    principalIdentityFilter: localState.principalIdentityFilter || "",
    slotFilter: localState.slotFilter || "all",
    baseRate: Number(billingRules.find((item) => item.unit === "cage_day")?.price ?? localState.baseRate ?? seedData.baseRate),
    rooms: entityData.rooms || [],
    racks: entityData.racks || [],
    slots: entityData.slots || [],
    occupancies: entityData.occupancies || [],
    billingRules,
    adjustments: entityData.adjustments || [],
    auditLogs: entityData.auditLogs || [],
  };
}

async function entityRequest(collection, method, item = null, itemId = "") {
  if (!remotePersistence) return { item, auditLogs: [] };

  const baseUrl = ENTITY_API_URLS[collection];
  const url = itemId ? `${baseUrl}/${encodeURIComponent(itemId)}` : baseUrl;
  const options = { method, headers: { "Content-Type": "application/json" } };
  if (method !== "DELETE") options.body = JSON.stringify(item);

  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "保存失败");
  }
  mergeServerAuditLogs(payload);
  return payload;
}

async function createEntity(collection, item) {
  return entityRequest(collection, "POST", item);
}

async function createInfrastructure(payload) {
  if (!remotePersistence) return { ...payload, auditLogs: [] };

  const response = await fetch(API_INFRASTRUCTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(result.error || "保存失败");
  }
  mergeServerAuditLogs(result);
  return result;
}

async function updateEntity(collection, itemId, item) {
  return entityRequest(collection, "PUT", item, itemId);
}

async function deleteEntityRequest(collection, itemId) {
  return entityRequest(collection, "DELETE", null, itemId);
}

function mergeServerAuditLogs(payload) {
  if (Array.isArray(payload?.auditLogs) && payload.auditLogs.length) {
    state.auditLogs = mergeAuditLogs(payload.auditLogs, state.auditLogs || []);
  }
}

function reportSaveError(error) {
  alert(error?.message || "保存失败");
}

function upsertById(items, item) {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
}

function upsertPrincipalIdentity(item) {
  const normalized = {
    ...item,
    pi: String(item.pi || "").trim(),
    principalType: normalizePrincipalType(item.principalType),
    freeCageAllowance: freeCageAllowanceForPrincipalType(item.principalType),
  };
  if (!normalized.pi) return;
  const index = PRINCIPAL_IDENTITIES.findIndex((existing) => normalizePersonName(existing.pi) === normalizePersonName(normalized.pi));
  if (index >= 0) {
    PRINCIPAL_IDENTITIES[index] = normalized;
  } else {
    PRINCIPAL_IDENTITIES.push(normalized);
  }
  PRINCIPAL_IDENTITY_BY_NAME = new Map(PRINCIPAL_IDENTITIES.map((item) => [normalizePersonName(item.pi), item]));
}

function normalize(data) {
  const next = { ...structuredClone(seedData), ...data };
  if (next.activeView === "settings") next.activeView = "rooms";
  next.selectedSlotIds = Array.isArray(next.selectedSlotIds) ? next.selectedSlotIds : [];
  next.quantitySheets = Array.isArray(next.quantitySheets) ? next.quantitySheets : [];
  next.quantitySheetDraft = normalizeQuantitySheetDraft(next.quantitySheetDraft || makeQuantitySheetDraft(next.billingMonth || today.slice(0, 7)));
  next.billingSource = next.billingSource === "quantity_sheet" ? "quantity_sheet" : "cage_map";
  next.billingPi = next.billingPi || piForIacuc(next.billingIacuc) || next.quantitySheetDraft.pi || "";
  next.billingPrincipalType = principalTypeForPi(next.billingPi);
  next.freeCageAllowance = Number(next.freeCageAllowance ?? FREE_CAGES_DEFAULT);
  next.principalIdentityFilter = String(next.principalIdentityFilter || "");
  next.batchMode = Boolean(next.batchMode);
  next.showCageEditor = Boolean(next.showCageEditor);
  next.showRoomForm = Boolean(next.showRoomForm);
  next.showRackForm = Boolean(next.showRackForm);
  next.sidebarCollapsed = Boolean(next.sidebarCollapsed);
  next.samplingMode = next.samplingMode || "";
  next.editingRackId = next.editingRackId || "";
  next.rackFormDraft = normalizeRackFormDraft(next.rackFormDraft);

  if (!next.racks.length || !next.slots.length) {
    const generated = generateInfrastructure(next.rooms);
    next.racks = generated.racks;
    next.slots = generated.slots;
  }

  next.rooms.forEach((room) => {
    const generatedRacks = next.racks.filter((rack) => rack.roomId === room.id);
    if (!generatedRacks.length) {
      const generated = generateInfrastructure([room]);
      next.racks.push(...generated.racks);
      next.slots.push(...generated.slots);
    }
  });

  updateSlotStatuses(next);
  return next;
}

function generateInfrastructure(rooms) {
  const racks = [];
  const slots = [];

  rooms.forEach((room) => {
    for (let rackIndex = 1; rackIndex <= Number(room.rackCount); rackIndex += 1) {
      const generated = generateRackInfrastructure(room, rackIndex, Number(room.rows), Number(room.cols));
      racks.push(generated.rack);
      slots.push(...generated.slots);
    }
  });

  return { racks, slots };
}

function generateRackInfrastructure(room, rackIndex, rows, cols, rackId = rackIdFor(room.id, rackIndex)) {
  const rack = {
    id: rackId,
    roomId: room.id,
    name: `${room.name} ${rackCode(rackIndex)} 号笼架`,
    rows: Number(rows),
    cols: Number(cols),
    index: rackIndex,
  };
  const slots = [];
  for (let row = 1; row <= Number(rows); row += 1) {
    for (let col = 1; col <= Number(cols); col += 1) {
      slots.push({
        id: slotIdForRack(rackId, row, col),
        rackId,
        row,
        col,
        code: `${columnLabel(col)}${row}`,
        status: "empty",
      });
    }
  }
  return { rack, slots };
}

function rackIdFor(roomId, rackIndex) {
  const suffix = roomId.replace(/^room-/, "");
  return `rack-${suffix}-${rackIndex}`;
}

function slotIdForRack(rackId, row, col) {
  const suffix = rackId.replace(/^rack-/, "");
  return `slot-${suffix}-${row}-${col}`;
}

function updateSlotStatuses(targetState = state) {
  const currentOccupancyBySlot = new Map();
  targetState.occupancies
    .filter((item) => item.status === "active" || item.status === "reserved")
    .forEach((item) => currentOccupancyBySlot.set(item.slotId, item));

  targetState.slots = targetState.slots.map((slot) => ({
    ...slot,
    status: currentOccupancyBySlot.get(slot.id)?.status ?? "empty",
  }));
}

function render() {
  if (remotePersistence && !currentUser) {
    document.querySelector("#app").innerHTML = renderLoginView();
    bindAuthEvents();
    return;
  }
  const adminViews = new Set(["data", "system", "users"]);
  if (currentUser?.role !== "admin" && adminViews.has(state.activeView)) {
    state.activeView = "cages";
  }

  saveState();
  document.querySelector("#app").innerHTML = `
    <div class="shell ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}">
      ${renderSidebar()}
      <main class="workspace">
        ${state.activeView === "dashboard" ? renderDashboardView() : ""}
        ${state.activeView === "cages" ? renderCageView() : ""}
        ${state.activeView === "billing" ? renderBillingView() : ""}
        ${state.activeView === "rooms" ? renderRoomManagementView() : ""}
        ${state.activeView === "data" ? renderDataManagementView() : ""}
        ${state.activeView === "system" ? renderSystemManagementView() : ""}
        ${state.activeView === "users" ? renderUserManagementView() : ""}
        ${state.activeView === "logs" ? renderAuditView() : ""}
        ${renderWorkspaceFooter()}
      </main>
    </div>
  `;

  bindEvents();
}

function renderSidebar() {
  const navItems = [
    ["dashboard", "首页", "home"],
    ["cages", "笼位图", "grid"],
    ...(currentUser ? [["rooms", "房间管理", "building"]] : []),
    ["billing", "饲养费核算", "receipt"],
    ...(currentUser?.role === "admin"
      ? [
          ["data", "数据管理", "database"],
          ["users", "账号管理", "users"],
          ["system", "系统管理", "settings"],
        ]
      : []),
    ["logs", "操作日志", "receipt"],
  ];

  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><img src="./assets/cageledger-icon.svg" alt="" /></div>
        <div>
          <strong>CageLedger</strong>
          <span>实验动物笼位管理与计费系统</span>
        </div>
      </div>
      <button
        class="nav-toggle"
        id="sidebarToggle"
        type="button"
        title="${state.sidebarCollapsed ? "展开导航栏" : "隐藏导航栏"}"
        aria-label="${state.sidebarCollapsed ? "展开导航栏" : "隐藏导航栏"}"
      >
        ${iconSvg(state.sidebarCollapsed ? "chevronRight" : "chevronLeft")}
        <span>${state.sidebarCollapsed ? "展开" : "隐藏导航栏"}</span>
      </button>
      <nav class="nav">
        ${navItems
          .map(
            ([view, label, icon]) => `
              <button class="nav-item ${state.activeView === view ? "active" : ""}" data-view="${view}" title="${escapeAttr(pageMeta(view).description)}" aria-label="${escapeAttr(label)}">
                ${iconSvg(icon)}
                <span>${label}</span>
              </button>
            `,
          )
          .join("")}
      </nav>
      ${renderSidebarAccount()}
    </aside>
  `;
}

function renderLoginView() {
  return `
    <main class="login-page">
      <section class="login-card">
        <div class="brand login-brand">
          <div class="brand-mark"><img src="./assets/cageledger-icon.svg" alt="" /></div>
          <div>
            <strong>CageLedger</strong>
            <span>实验动物笼位管理与计费系统</span>
          </div>
        </div>
        <form id="loginForm" class="form">
          <label>
            用户名
            <input name="username" autocomplete="username" placeholder="请输入用户名" required />
          </label>
          <label>
            密码
            <input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required />
          </label>
          <p class="login-error" id="loginError"></p>
          <button class="primary" type="submit">${iconSvg("save")}登录</button>
        </form>
        ${renderVersionMeta("login-version")}
      </section>
    </main>
  `;
}

function pageMeta(view) {
  return {
    cages: {
      title: "笼位图",
      description: "按饲养间和笼架查看、录入和维护笼位占用。",
    },
    billing: {
      title: "饲养费核算",
      description: "按项目负责人和月份汇总多个 IACUC 的饲养费用。",
    },
    rooms: {
      title: "房间管理",
      description: "维护饲养间、笼架和笼位基础结构。",
    },
    data: {
      title: "数据管理",
      description: "维护 IACUC 索引和外部数据源。",
    },
    system: {
      title: "系统管理",
      description: "查看系统版本、更新状态、更新记录和接口文档。",
    },
    users: {
      title: "账号管理",
      description: "维护系统管理员和房间管理员账号。",
    },
    logs: {
      title: "操作日志",
      description: "查看系统写入操作和审计记录。",
    },
  }[view] || {
    title: "CageLedger",
    description: "实验动物笼位管理与计费系统。",
  };
}

function renderSidebarAccount() {
  if (!currentUser) {
    return `
      <div class="sidebar-account">
        <span>运行模式</span>
        <strong>静态模式</strong>
        <small>${state.rooms.length} 个饲养间</small>
        ${renderVersionMeta("sidebar-version")}
      </div>
    `;
  }

  return `
    <div class="sidebar-account">
      <span>当前账号</span>
      <strong title="${escapeAttr(currentUser.displayName)}">${escapeText(currentUser.displayName)}</strong>
      <small>${currentUser.role === "admin" ? "管理员" : "房间管理员"} · ${state.rooms.length} 个饲养间</small>
      <button id="logoutButton" class="secondary logout-button" type="button" title="退出登录" aria-label="退出登录">
        ${iconSvg("logout")}
        <span>退出</span>
      </button>
      ${renderVersionMeta("sidebar-version")}
    </div>
  `;
}

function renderWorkspaceFooter() {
  return `
    <footer class="workspace-footer">
      ${renderVersionMeta("workspace-version")}
    </footer>
  `;
}

function renderVersionMeta(className) {
  const version = systemInfo.version ? `v${systemInfo.version}` : "版本未设置";
  return `
    <div class="version-meta ${className}">
      <span>${escapeText(systemInfo.name || "CageLedger")} ${escapeText(version)}</span>
      <small>${escapeText([systemInfo.organization, systemInfo.department].filter(Boolean).join(" · "))}</small>
      <small>${escapeText(systemInfo.copyright || "")}</small>
    </div>
  `;
}

function metric(label, value, tone) {
  return `
    <div class="metric ${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderDashboardView() {
  const counts = slotStatusCounts();
  const occupied = counts.active + counts.reserved;
  const activePct = percent(counts.active, counts.total);
  const reservedPct = percent(counts.reserved, counts.total);
  const emptyPct = percent(counts.empty, counts.total);
  const occupiedPct = percent(occupied, counts.total);

  return `
    <section class="dashboard-view">
      <div class="dashboard-hero">
        <div>
          <span class="dashboard-kicker">CageLedger · CL</span>
          <h1>实验动物笼位管理与计费系统</h1>
          <p>以笼位占用时间线作为计费依据，集中管理笼位状态、IACUC 项目归属和饲养费核算。</p>
        </div>
        <div class="dashboard-hero-stat">
          <span>总笼位</span>
          <strong>${counts.total}</strong>
          <small>${state.rooms.length} 个饲养间 · ${state.racks.length} 个笼架</small>
        </div>
      </div>

      <div class="dashboard-metrics">
        ${metric("总笼位", counts.total, "neutral")}
        ${metric("在用", counts.active, "active")}
        ${metric("已预约", counts.reserved, "reserved")}
        ${metric("空", counts.empty, "empty")}
      </div>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="panel-head compact">
            <div>
              <h2>笼位状态分布</h2>
              <p>按当前笼位状态统计，便于快速判断资源占用情况。</p>
            </div>
          </div>
          <div class="status-chart">
            <div
              class="donut-chart"
              style="--active:${activePct}; --reserved:${reservedPct}; --empty:${emptyPct};"
              aria-label="笼位状态分布图"
            >
              <span>${occupiedPct}%</span>
              <small>占用/预约</small>
            </div>
            <div class="chart-legend">
              ${chartLegend("active", "在用", counts.active, activePct)}
              ${chartLegend("reserved", "已预约", counts.reserved, reservedPct)}
              ${chartLegend("empty", "空", counts.empty, emptyPct)}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head compact">
            <div>
              <h2>饲养间使用情况</h2>
              <p>按饲养间展示在用、已预约和空笼位，便于比较各房间容量。</p>
            </div>
          </div>
          <div class="room-capacity-list">
            ${roomCapacityRows().map(renderRoomCapacityRow).join("")}
          </div>
        </section>
      </div>
    </section>
  `;
}

function slotStatusCounts() {
  const total = state.slots.length;
  const active = state.slots.filter((slot) => slot.status === "active").length;
  const reserved = state.slots.filter((slot) => slot.status === "reserved").length;
  const empty = Math.max(total - active - reserved, 0);
  return { total, active, reserved, empty };
}

function roomCapacityRows() {
  return visibleRooms().map((room) => {
    const rackIds = new Set(state.racks.filter((rack) => rack.roomId === room.id).map((rack) => rack.id));
    const slots = state.slots.filter((slot) => rackIds.has(slot.rackId));
    const total = slots.length;
    const active = slots.filter((slot) => slot.status === "active").length;
    const reserved = slots.filter((slot) => slot.status === "reserved").length;
    const empty = Math.max(total - active - reserved, 0);
    return {
      id: room.id,
      name: room.name,
      area: room.area,
      total,
      active,
      reserved,
      empty,
    };
  });
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function chartLegend(tone, label, value, pct) {
  return `
    <div class="chart-legend-item">
      <span class="status-dot ${tone}"></span>
      <strong>${label}</strong>
      <small>${value} 笼 · ${pct}%</small>
    </div>
  `;
}

function renderRoomCapacityRow(room) {
  const activePct = percent(room.active, room.total);
  const reservedPct = percent(room.reserved, room.total);
  const emptyPct = percent(room.empty, room.total);
  const occupiedPct = percent(room.active + room.reserved, room.total);
  return `
    <div class="room-capacity-row">
      <div class="room-capacity-head">
        <div>
          <strong>${escapeText(room.name)}</strong>
          <span>${escapeText(room.area || "未设置区域")} · ${room.total} 笼</span>
        </div>
        <em>${occupiedPct}% 占用/预约</em>
      </div>
      <div class="stacked-capacity-track" aria-label="${escapeAttr(room.name)} 笼位使用情况">
        <i class="active" style="width:${activePct}%"></i>
        <i class="reserved" style="width:${reservedPct}%"></i>
        <i class="empty" style="width:${emptyPct}%"></i>
      </div>
      <div class="room-capacity-meta">
        <span>在用 ${room.active}</span>
        <span>已预约 ${room.reserved}</span>
        <span>空 ${room.empty}</span>
      </div>
    </div>
  `;
}

function renderCageView() {
  const selectedRoom = getSelectedRoom();
  if (!selectedRoom) {
    return `
      <section class="content-grid">
        <div class="panel large">
          <div class="empty-state">
            ${iconSvg("grid")}
            <h2>尚未创建饲养间</h2>
            <p>先在饲养间管理中创建饲养间和笼架，再录入笼位占用信息。</p>
            ${currentUser?.role === "admin" ? `<button class="primary" type="button" data-view="rooms">${iconSvg("plus")}新增饲养间</button>` : ""}
          </div>
        </div>
      </section>
    `;
  }
  const racks = state.racks.filter((rack) => rack.roomId === selectedRoom.id);
  const selectedRack = getSelectedRack(racks);
  if (!selectedRack) {
    return `
      <section class="content-grid">
        <div class="panel large">
          <div class="empty-state">
            ${iconSvg("grid")}
            <h2>尚未创建笼架</h2>
            <p>当前饲养间还没有笼架，请先添加笼架后再录入笼位。</p>
            ${currentUser ? `<button class="primary" type="button" data-view="rooms">${iconSvg("plus")}新增笼架</button>` : ""}
          </div>
        </div>
      </section>
    `;
  }
  const slots = state.slots.filter((slot) => slot.rackId === selectedRack.id);
  const visibleSlots = state.slotFilter === "all" ? slots : slots.filter((slot) => slot.status === state.slotFilter);
  const selectedSlot = getSelectedSlot(visibleSlots, slots);
  const selectedBatchSlots = slots.filter((slot) => state.selectedSlotIds.includes(slot.id));

  return `
    <section class="cage-layout">
      <div class="panel large cage-preview">
        <div class="panel-head">
          <div>
            <h2>动态笼位图</h2>
            <p>${selectedRoom.name} · ${rackDisplayName(selectedRack, selectedRoom)}</p>
          </div>
          <div class="toolbar">
            <select id="roomSelect">
              ${visibleRooms().map((room) => `<option value="${room.id}" ${room.id === selectedRoom.id ? "selected" : ""}>${room.name}</option>`).join("")}
            </select>
            <select id="rackSelect">
              ${racks.map((rack) => `<option value="${rack.id}" ${rack.id === selectedRack.id ? "selected" : ""}>${escapeText(rackDisplayName(rack, selectedRoom))}</option>`).join("")}
            </select>
            <button class="secondary" type="button" id="openCageEditor">${iconSvg("edit")}编辑笼位图</button>
          </div>
        </div>
        <div class="legend">
          ${legend("empty", "空")}
          ${legend("reserved", "已预约")}
          ${legend("active", "在用")}
        </div>
        <div class="filter-row" role="group" aria-label="笼位状态筛选">
          ${filterButton("all", "全部")}
          ${filterButton("active", "在用")}
          ${filterButton("reserved", "已预约")}
          ${filterButton("empty", "空")}
          <button class="segmented batch-toggle ${state.batchMode ? "active" : ""}" id="batchModeToggle" type="button">
            ${iconSvg("grid")}多选录入${state.selectedSlotIds.length ? ` (${state.selectedSlotIds.length})` : ""}
          </button>
          ${
            state.batchMode
              ? `
                <button class="segmented" id="selectVisibleSlots" type="button">全选当前</button>
                <button class="segmented" id="clearBatchSelection" type="button">清空选择</button>
              `
              : ""
          }
        </div>
        <div class="rack-grid" style="--cols:${selectedRack.cols}">
          ${visibleSlots.map((slot) => renderSlot(slot)).join("")}
        </div>
      </div>
      ${
        state.showCageEditor
          ? `
            <div class="editor-modal-backdrop" id="closeCageEditor"></div>
            <div class="panel detail-panel cage-editor editor-modal">
              <div class="editor-modal-actions">
                <button class="secondary" type="button" id="closeCageEditorButton">${iconSvg("chevronRight")}关闭编辑</button>
              </div>
              ${state.batchMode ? renderBatchSlotDetail(selectedBatchSlots) : renderSlotDetail(selectedSlot)}
            </div>
          `
          : ""
      }
    </section>
  `;
}

function legend(status, label) {
  return `<span class="legend-item"><i class="status-dot ${status}"></i>${label}</span>`;
}

function filterButton(value, label) {
  return `<button class="segmented ${state.slotFilter === value ? "active" : ""}" data-filter="${value}">${label}</button>`;
}

function renderSlot(slot) {
  const occupancy = currentOccupancy(slot.id);
  const isSelected = slot.id === state.selectedSlotId || state.selectedSlotIds.includes(slot.id);
  const slotCode = cageCodeForSlot(slot.id);
  const title = occupancy
    ? `${slotCode} ${occupancy.iacuc || ""} ${occupancy.pi || ""} ${occupancy.owner || ""} ${occupancy.startDate || ""}`
    : `${slotCode} 空`;

  return `
    <button class="slot ${slot.status} ${isSelected ? "selected" : ""} ${state.selectedSlotIds.includes(slot.id) ? "batch-selected" : ""}" data-slot="${slot.id}" title="${escapeAttr(title)}">
      <span class="slot-code">${slotCode}</span>
      ${
        occupancy
          ? `
            <strong class="slot-iacuc">${escapeText(occupancy.iacuc || "未填写 IACUC")}</strong>
            <span class="slot-person">${escapeText(occupancy.pi || "未填写PI")} / ${escapeText(occupancy.owner || "未填写实验负责人")}</span>
            <span class="slot-date">${escapeText(occupancy.startDate || "未设置入住时间")}</span>
          `
          : `
            <strong class="slot-empty-text">空</strong>
          `
      }
      ${state.batchMode && state.selectedSlotIds.includes(slot.id) ? `<span class="slot-selected-label">已选</span>` : ""}
    </button>
  `;
}

function renderSlotDetail(slot) {
  if (!slot) {
    return `
      <div class="empty-state">
        ${iconSvg("grid")}
        <h2>没有符合筛选条件的笼位</h2>
      </div>
    `;
  }

  const current = currentOccupancy(slot.id);
  const occupancy = current ?? emptyOccupancy(slot.id);
  const history = state.occupancies.filter((item) => item.slotId === slot.id);

  return `
    <div class="panel-head compact">
      <div>
        <h2>笼位 ${slotPositionCode(slot)}</h2>
        <p>${statusLabel(slot.status)}</p>
      </div>
      <span class="pill ${slot.status}">${statusLabel(slot.status)}</span>
    </div>

    <form id="slotForm" class="form compact-slot-form">
      <input type="hidden" name="slotId" value="${slot.id}" />
      <div class="compact-form-row two-one">
        <label class="field-required">
          状态
          <select name="status">
            ${statusOption("empty", occupancy.status)}
            ${statusOption("reserved", occupancy.status)}
            ${statusOption("active", occupancy.status)}
          </select>
        </label>
        <label>
          笼盒编号
          <input name="cageCode" value="${escapeAttr(occupancy.cageCode)}" placeholder="请输入笼盒编号，如 M-A001" />
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-required">
          IACUC 编号
          <input name="iacuc" value="${escapeAttr(occupancy.iacuc)}" placeholder="请输入或选择 IACUC 编号" list="iacucOptions" />
        </label>
        <label class="field-auto">
          项目名称
          <textarea name="project" rows="2" placeholder="选择 IACUC 后自动填充，也可手动输入">${escapeText(occupancy.project)}</textarea>
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-auto">
          项目负责人
          <input name="pi" value="${escapeAttr(occupancy.pi)}" placeholder="选择 IACUC 后自动填充" />
        </label>
        <label class="field-auto">
          实验负责人
          <input name="owner" value="${escapeAttr(occupancy.owner)}" placeholder="选择 IACUC 后自动填充" />
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-required">
          开始日期
          <input type="date" name="startDate" value="${occupancy.startDate || today}" placeholder="请选择开始日期" />
        </label>
        <label>
          结束/最后计费日期
          <input type="date" name="endDate" value="${occupancy.endDate}" placeholder="请选择结束日期" />
        </label>
      </div>
      <label class="full-field">
        备注
        <textarea name="notes" rows="3" placeholder="请输入品系、周龄、特殊饲养要求等备注">${escapeText(occupancy.notes)}</textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="primary">${iconSvg("save")}保存笼位</button>
        ${
          occupancy.status === "active"
            ? `<button type="button" class="secondary" id="openSampleSlot">${iconSvg("check")}已取材</button>`
            : ""
        }
        <button type="button" class="ghost" id="clearSlot">${iconSvg("trash")}设为空</button>
      </div>
      ${occupancy.status === "active" && state.samplingMode === "single" ? renderSamplingPanel("single", occupancy.endDate || today) : ""}
    </form>

    <datalist id="iacucOptions">
      ${iacucOptions(occupancy.iacuc)
        .map((item) => `<option value="${escapeAttr(item.iacuc)}" label="${escapeAttr(item.project || item.pi || "")}"></option>`)
        .join("")}
    </datalist>

    <div class="history">
      <h3>占用历史</h3>
      ${history.length ? history.map(renderHistoryItem).join("") : `<p class="muted">暂无历史记录。</p>`}
    </div>
  `;
}

function renderBatchSlotDetail(slots) {
  if (!slots.length) {
    return `
      <div class="empty-state">
        ${iconSvg("grid")}
        <h2>请选择要批量录入的笼位</h2>
        <p class="muted">开启多选录入后，点击笼位可加入或移出批量选择。</p>
      </div>
    `;
  }

  const batchState = getBatchEditState(slots);
  const activeCount = selectedActiveOccupancies(slots).length;
  if (batchState.hasConflict) {
    return `
      <div class="panel-head compact">
        <div>
          <h2>批量编辑冲突</h2>
          <p>已选择 ${slots.length} 个笼位，但包含多个不同 IACUC 编号。</p>
        </div>
        <span class="pill ended">需重新选择</span>
      </div>

      <div class="selected-list">
        ${slots.map((slot) => `<span>${slotPositionCode(slot)}</span>`).join("")}
      </div>

      <div class="warning-box">
        <strong>请只选择相同 IACUC 编号的笼位进行批量编辑。</strong>
        <p>当前选择包含：${batchState.iacucs.map((iacuc) => escapeText(iacuc)).join("、")}。为了避免误覆盖项目负责人、实验负责人和计费归属，系统已暂停批量保存。</p>
      </div>

      <div class="form-actions">
        <button type="button" class="secondary" id="clearBatchSelection">${iconSvg("refresh")}重新选择</button>
        ${
          activeCount
            ? `<button type="button" class="secondary" id="openSampleBatchSlots">${iconSvg("check")}批量已取材 (${activeCount})</button>`
            : ""
        }
        <button type="button" class="ghost" id="clearBatchSlots">${iconSvg("trash")}批量设为空</button>
      </div>
      ${activeCount && state.samplingMode === "batch" ? renderSamplingPanel("batch", today, activeCount) : ""}
    `;
  }

  const draft = batchState.draft;

  return `
    <div class="panel-head compact">
      <div>
        <h2>批量录入</h2>
        <p>${draft.iacuc ? `已自动带入 ${escapeText(draft.iacuc)} 的项目信息。` : `已选择 ${slots.length} 个笼位，保存后写入相同项目信息。`}</p>
      </div>
      <span class="pill active">${slots.length} 个笼位</span>
    </div>

    <div class="selected-list">
      ${slots.map((slot) => `<span>${slotPositionCode(slot)}</span>`).join("")}
    </div>

    <form id="batchSlotForm" class="form compact-slot-form">
      <div class="compact-form-row third">
        <label class="field-required">
          状态
          <select name="status">
            ${statusOption("active", draft.status)}
            ${statusOption("reserved", draft.status)}
          </select>
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-required">
          IACUC 编号
          <input name="iacuc" value="${escapeAttr(draft.iacuc)}" placeholder="请输入或选择 IACUC 编号" list="iacucOptions" />
        </label>
        <label class="field-auto">
          项目名称
          <textarea name="project" rows="2" placeholder="选择 IACUC 后自动填充，也可手动输入">${escapeText(draft.project)}</textarea>
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-auto">
          项目负责人
          <input name="pi" value="${escapeAttr(draft.pi)}" placeholder="选择 IACUC 后自动填充" />
        </label>
        <label class="field-auto">
          实验负责人
          <input name="owner" value="${escapeAttr(draft.owner)}" placeholder="选择 IACUC 后自动填充" />
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-required">
          开始日期
          <input type="date" name="startDate" value="${draft.startDate}" placeholder="请选择开始日期" />
        </label>
        <label>
          结束/最后计费日期
          <input type="date" name="endDate" value="${draft.endDate}" placeholder="请选择结束日期" />
        </label>
      </div>
      <label class="full-field">
        备注
        <textarea name="notes" rows="3" placeholder="请输入批量备注，笼盒编号请单笼维护">${escapeText(draft.notes)}</textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="primary">${iconSvg("save")}批量保存</button>
        ${
          activeCount
            ? `<button type="button" class="secondary" id="openSampleBatchSlots">${iconSvg("check")}批量已取材 (${activeCount})</button>`
            : ""
        }
        <button type="button" class="ghost" id="clearBatchSlots">${iconSvg("trash")}批量设为空</button>
      </div>
      ${activeCount && state.samplingMode === "batch" ? renderSamplingPanel("batch", today, activeCount) : ""}
    </form>

    <datalist id="iacucOptions">
      ${iacucOptions(draft.iacuc)
        .map((item) => `<option value="${escapeAttr(item.iacuc)}" label="${escapeAttr(item.project || item.pi || "")}"></option>`)
        .join("")}
    </datalist>
  `;
}

function statusOption(status, current) {
  return `<option value="${status}" ${status === current ? "selected" : ""}>${statusLabel(status)}</option>`;
}

function renderSamplingPanel(mode, defaultDate, count = 1) {
  return `
    <div class="sampling-panel" data-sampling-mode="${mode}">
      <label>
        取材日期（最后计费日期）
        <input type="date" id="${mode === "batch" ? "batchSampleDate" : "sampleDate"}" value="${defaultDate || today}" placeholder="请选择取材日期" />
      </label>
      <div class="form-actions compact-actions">
        <button type="button" class="primary" id="${mode === "batch" ? "confirmSampleBatchSlots" : "confirmSampleSlot"}">
          ${iconSvg("check")}${mode === "batch" ? `确认 ${count} 笼已取材` : "确认已取材"}
        </button>
        <button type="button" class="secondary" id="cancelSampling">取消</button>
      </div>
    </div>
  `;
}

function getBatchEditState(slots) {
  const occupiedItems = slots.map((slot) => currentOccupancy(slot.id)).filter(Boolean);
  const iacucByKey = new Map();

  occupiedItems.forEach((item) => {
    const key = normalizeIacucNumber(item.iacuc);
    if (key) iacucByKey.set(key, item.iacuc);
  });

  const iacucs = [...iacucByKey.values()];
  const hasConflict = iacucs.length > 1;
  const draft = hasConflict ? emptyBatchDraft() : buildBatchDraft(occupiedItems);

  return {
    hasConflict,
    iacucs,
    draft,
  };
}

function buildBatchDraft(occupiedItems) {
  const iacuc = commonValue(occupiedItems, "iacuc");
  const matched = iacuc ? findIacucInfo(iacuc) : null;

  return {
    status: commonValue(occupiedItems, "status") || "active",
    iacuc: matched?.iacuc || iacuc,
    project: commonValue(occupiedItems, "project") || matched?.project || "",
    pi: commonValue(occupiedItems, "pi") || matched?.pi || "",
    owner: commonValue(occupiedItems, "owner") || matched?.owner || "",
    startDate: commonValue(occupiedItems, "startDate") || today,
    endDate: commonValue(occupiedItems, "endDate"),
    notes: commonValue(occupiedItems, "notes"),
  };
}

function emptyBatchDraft() {
  return {
    status: "active",
    iacuc: "",
    project: "",
    pi: "",
    owner: "",
    startDate: today,
    endDate: "",
    notes: "",
  };
}

function commonValue(items, key) {
  if (!items.length) return "";
  const values = [...new Set(items.map((item) => item[key] || ""))];
  return values.length === 1 ? values[0] : "";
}

function selectedActiveOccupancies(slots) {
  return slots
    .map((slot) => currentOccupancy(slot.id))
    .filter((item) => item?.status === "active");
}

function renderHistoryItem(item) {
  return `
    <div class="history-item">
      <span class="pill ${item.endReason === "sampled" ? "sampled" : item.status}">${historyStatusLabel(item)}</span>
      <div>
        <strong>${item.cageCode || "未填写笼盒编号"}</strong>
        <p>${item.iacuc || "无 IACUC"} · ${item.startDate || "-"} 至 ${item.endDate || "至今"}</p>
      </div>
    </div>
  `;
}

function renderBillingView() {
  return `
    <section class="billing-source-tabs" role="tablist" aria-label="饲养费核算方式">
      <button class="segmented ${state.billingSource === "cage_map" ? "active" : ""}" type="button" data-billing-source="cage_map">动态笼位图（自动）</button>
      <button class="segmented ${state.billingSource === "quantity_sheet" ? "active" : ""}" type="button" data-billing-source="quantity_sheet">数量统计表（录入）</button>
    </section>
    ${state.billingSource === "quantity_sheet" ? renderQuantitySheetBillingView() : renderCageMapBillingView()}
  `;
}

function renderCageMapBillingView() {
  const statement = buildStatement(state.billingPi, state.billingMonth);
  const billingInfo = statementInfoForExport(statement);
  const canGenerateStatement = !remotePersistence || currentUser?.role === "admin";
  const principalType = principalTypeForPi(state.billingPi);

  return `
    <section class="billing-layout">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>月度结算单</h2>
            <p>按每天实际在养笼数计算，已预约默认不计费。</p>
          </div>
          <div class="toolbar">
            <input id="billingMonth" type="month" value="${state.billingMonth}" placeholder="请选择结算月份" />
            <input id="billingPi" type="text" value="${escapeAttr(state.billingPi)}" list="billingPiOptions" placeholder="请输入或选择项目负责人" />
            <button id="exportBilling" class="secondary" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("download")}导出饲养明细 CSV</button>
            <button id="exportSettlementPdf" class="primary" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("download")}导出结算单 PDF</button>
          </div>
        </div>

        <datalist id="billingPiOptions">
          ${piOptions(state.billingPi)
            .map((item) => `<option value="${escapeAttr(item.pi)}" label="${escapeAttr(item.iacucs.join("、"))}"></option>`)
            .join("")}
        </datalist>

        <div class="statement-summary">
          ${summaryTile("项目负责人", state.billingPi || "-")}
          ${summaryTile("伦理编号", statement.iacucs.length ? statement.iacucs.join("、") : "-")}
          ${summaryTile("项目数量", statement.iacucs.length)}
          ${summaryTile("免费笼数/天", statement.freeCageAllowance)}
          ${summaryTile("累计笼日", statement.totalCageDays)}
          ${summaryTile("收费笼日", statement.totalBillableCageDays)}
          ${summaryTile("应收金额", `¥${MONEY_FORMAT.format(statement.totalAmount)}`)}
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>合计笼数</th>
                <th>免费笼数</th>
                <th>收费笼数</th>
                <th>4.5元笼数</th>
                <th>6.5元笼数</th>
                <th>当日费用</th>
                <th>累计费用</th>
              </tr>
            </thead>
            <tbody>
              ${statement.rows.map(renderBillingRow).join("")}
            </tbody>
          </table>
        </div>
        ${
          canGenerateStatement
            ? ""
            : `<p class="muted">共享模式下只有系统管理员可以生成和导出正式结算单。</p>`
        }
      </div>

      <div class="panel">
        <div class="panel-head compact">
          <div>
            <h2>计费规则</h2>
            <p>按项目负责人每日合计笼数计费，免费额度优先抵扣首单元。</p>
          </div>
        </div>
        ${
          currentUser?.role === "admin"
            ? `
              <form id="rateForm" class="form">
                <label>
                  负责人类型
                  <select name="principalType">
                    <option value="${BILLING_PRINCIPAL_PI}" ${principalType === BILLING_PRINCIPAL_PI ? "selected" : ""}>PI（20 笼/天免费）</option>
                    <option value="${BILLING_PRINCIPAL_INDEPENDENT}" ${principalType === BILLING_PRINCIPAL_INDEPENDENT ? "selected" : ""}>独立科研人员（10 笼/天免费）</option>
                  </select>
                </label>
                <label>
                  当前免费笼数/天
                  <input type="number" value="${statement.freeCageAllowance}" readonly />
                </label>
                <button class="primary" type="submit">${iconSvg("save")}保存项目负责人减免</button>
              </form>
            `
            : `<p class="muted">当前账号只能查看计费规则，不能修改免费笼数。</p>`
        }
        <div class="rule-list">
          <div class="rule-item"><strong>首单元</strong><span>前 ${BILLING_TIER_LIMIT} 笼按 ¥${MONEY_FORMAT.format(BILLING_TIER_BASE_PRICE)} /笼/天</span></div>
          <div class="rule-item"><strong>超额单元</strong><span>超过 ${BILLING_TIER_LIMIT} 笼按 ¥${MONEY_FORMAT.format(BILLING_TIER_OVER_PRICE)} /笼/天</span></div>
        </div>
        <div class="rule-list">
          ${state.adjustments.map(renderAdjustment).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderQuantitySheetBillingView() {
  const draft = state.quantitySheetDraft || makeQuantitySheetDraft(state.billingMonth);
  const statement = buildQuantitySheetStatement(draft);
  const canGenerateStatement = !remotePersistence || Boolean(currentUser);

  return `
    <section class="billing-layout quantity-billing-layout">
      <div class="panel large">
        <form id="quantitySheetForm">
          <div class="panel-head">
            <div>
              <h2>数量统计表结算</h2>
              <p>录入纸质数量统计表中的变更行，系统按每日结余笼数展开明细。</p>
            </div>
            <div class="toolbar">
              <select id="quantitySheetSelect" aria-label="选择数量统计表">
                <option value="">请选择统计表或新建</option>
                ${state.quantitySheets
                  .map((sheet) => `<option value="${escapeAttr(sheet.id)}" ${sheet.id === draft.id ? "selected" : ""}>${escapeText(sheet.month)} · ${escapeText(sheet.iacuc)}</option>`)
                  .join("")}
              </select>
              <button id="newQuantitySheet" class="secondary" type="button">${iconSvg("plus")}新建</button>
              <button id="saveQuantitySheet" class="secondary" type="submit">${iconSvg("save")}保存统计表</button>
              <button id="exportBilling" class="secondary" type="button" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("download")}导出饲养明细 CSV</button>
              <button id="exportSettlementPdf" class="primary" type="button" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("download")}导出结算单 PDF</button>
            </div>
          </div>

          <div class="quantity-sheet-fields">
            <label class="field-required">
              结算月份
              <input id="quantitySheetMonth" name="month" type="month" value="${escapeAttr(draft.month || state.billingMonth)}" placeholder="请选择结算月份" required />
            </label>
            <label>
              饲养间
              <select name="roomId">
                <option value="">请选择饲养间或手动填写房间号</option>
                ${visibleRooms().map((room) => `<option value="${escapeAttr(room.id)}" ${room.id === draft.roomId ? "selected" : ""}>${escapeText(room.name)}</option>`).join("")}
              </select>
            </label>
            <label>
              房间号
              <input name="roomName" value="${escapeAttr(draft.roomName)}" placeholder="请输入房间号，如 8101" />
            </label>
            <label>
              管理员
              <input name="manager" value="${escapeAttr(draft.manager)}" placeholder="请输入管理员姓名" />
            </label>
            <label class="field-required">
              IACUC 编号
              <input name="iacuc" value="${escapeAttr(draft.iacuc)}" list="quantityIacucOptions" placeholder="请输入或选择 IACUC 编号" required />
            </label>
            <label class="field-auto">
              项目负责人
              <input name="pi" value="${escapeAttr(draft.pi)}" placeholder="选择 IACUC 后自动填充" />
            </label>
            <label class="field-auto">
              实验负责人
              <input name="owner" value="${escapeAttr(draft.owner)}" placeholder="选择 IACUC 后自动填充" />
            </label>
            <label>
              联系电话
              <input name="contact" value="${escapeAttr(draft.contact)}" placeholder="请输入联系电话" />
            </label>
            <label class="wide field-auto">
              项目名称
              <input name="project" value="${escapeAttr(draft.project)}" placeholder="选择 IACUC 后自动填充，也可手动输入" />
            </label>
            <label class="field-auto">
              支撑经费
              <input name="funding" value="${escapeAttr(draft.funding)}" placeholder="选择 IACUC 后自动填充" />
            </label>
            <label class="month-opening-field">
              月初结余动物数
              <input name="initialAnimalCount" type="number" min="0" value="${draft.initialAnimalCount ?? 0}" placeholder="请输入月初动物数" />
            </label>
            <label class="month-opening-field field-required">
              月初结余笼数
              <input name="initialCageCount" type="number" min="0" value="${draft.initialCageCount ?? 0}" placeholder="请输入月初笼数" />
            </label>
            <label class="month-opening-field">
              计费口径
              <select name="billingUnit">
                <option value="cage_day" selected>笼/天</option>
              </select>
            </label>
          </div>
          <datalist id="quantityIacucOptions">
            ${iacucOptions(draft.iacuc)
              .map((item) => `<option value="${escapeAttr(item.iacuc)}" label="${escapeAttr(item.project || item.pi || "")}"></option>`)
              .join("")}
          </datalist>

          <div class="table-wrap quantity-entry-wrap">
            <table class="quantity-entry-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>新增</th>
                  <th>新增类型</th>
                  <th>减少</th>
                  <th>减少类型</th>
                  <th>结余总数</th>
                  <th>结余笼数</th>
                  <th>备注</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${draft.rows.map((row, index) => renderQuantitySheetRow(row, index)).join("")}
              </tbody>
            </table>
          </div>
          <button id="addQuantitySheetRow" class="secondary" type="button">${iconSvg("plus")}添加变更行</button>
        </form>

        <div class="quantity-preview-section">
          <div class="panel-head compact">
            <div>
              <h2>结算预览</h2>
              <p>预览会按同月同项目负责人名下全部统计表汇总展开。</p>
            </div>
          </div>
          <div class="statement-summary compact-summary">
            ${summaryTile("项目负责人", statement.pi || draft.pi || "-")}
            ${summaryTile("伦理编号", statement.iacucs.length ? statement.iacucs.join("、") : "-")}
            ${summaryTile("免费笼数/天", statement.freeCageAllowance)}
            ${summaryTile("累计笼日", statement.totalCageDays)}
            ${summaryTile("收费笼日", statement.totalBillableCageDays)}
            ${summaryTile("应收金额", `¥${MONEY_FORMAT.format(statement.totalAmount)}`)}
          </div>
          <div class="table-wrap mini-statement">
            <table>
              <thead><tr><th>日期</th><th>动物数</th><th>笼数</th><th>收费笼数</th><th>费用</th></tr></thead>
              <tbody>${statement.rows.filter((row) => row.cageCount || row.animalCount).map(renderQuantityPreviewRow).join("") || `<tr><td colspan="5">录入月初结余或变更行后显示明细</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;
}

function summaryTile(label, value) {
  return `
    <div class="summary-tile">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderBillingRow(row) {
  return `
    <tr>
      <td>${row.date}</td>
      <td>${row.cageCount}</td>
      <td>${row.freeCages}</td>
      <td>${row.billableCages}</td>
      <td>${row.tier1BillableCages}</td>
      <td>${row.tier2BillableCages}</td>
      <td>¥${MONEY_FORMAT.format(row.amount)}</td>
      <td>¥${MONEY_FORMAT.format(row.cumulative)}</td>
    </tr>
  `;
}

function renderQuantitySheetRow(row, index) {
  return `
    <tr data-quantity-row="${index}">
      <td><input name="rowDate" type="date" value="${escapeAttr(row.date)}" placeholder="请选择日期" required /></td>
      <td><input name="addedCount" type="number" min="0" value="${row.addedCount ?? ""}" placeholder="请输入" /></td>
      <td>
        <select name="addedType">
          ${["", "购入", "转入", "分笼"].map((value) => `<option value="${value}" ${row.addedType === value ? "selected" : ""}>${value || "请选择"}</option>`).join("")}
        </select>
      </td>
      <td><input name="removedCount" type="number" min="0" value="${row.removedCount ?? ""}" placeholder="请输入" /></td>
      <td>
        <select name="removedType">
          ${["", "取材", "死亡", "转出"].map((value) => `<option value="${value}" ${row.removedType === value ? "selected" : ""}>${value || "请选择"}</option>`).join("")}
        </select>
      </td>
      <td><input name="animalCount" type="number" min="0" value="${row.animalCount ?? ""}" placeholder="请输入" /></td>
      <td><input name="cageCount" type="number" min="0" value="${row.cageCount ?? ""}" placeholder="请输入" /></td>
      <td><input name="notes" value="${escapeAttr(row.notes)}" placeholder="请输入备注" /></td>
      <td><button class="icon-danger" type="button" data-remove-qrow="${index}" title="删除行">${iconSvg("trash")}</button></td>
    </tr>
  `;
}

function renderQuantityPreviewRow(row) {
  return `
    <tr>
      <td>${row.date}</td>
      <td>${row.animalCount}</td>
      <td>${row.cageCount}</td>
      <td>${row.billableCages}</td>
      <td>¥${MONEY_FORMAT.format(row.amount)}</td>
    </tr>
  `;
}

function renderAdjustment(item) {
  const valueLabel = item.type === "free_cages" ? `${principalTypeLabel(item.principalType)} · ${item.value} 笼/天免费` : item.type === "discount" ? `${item.value}% 减免` : item.value;
  return `
    <div class="rule-card">
      <strong>${item.targetId}</strong>
      <span>${valueLabel}</span>
      <p>${item.reason}</p>
    </div>
  `;
}

function renderRoomManagementView() {
  const rackDraft = currentRackFormDraft();
  const rackFormRoomId = rackDraft.roomId;
  const canManageRooms = !remotePersistence || currentUser?.role === "admin";
  return `
    <section class="content-grid">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>饲养间与笼架</h2>
            <p>饲养间下可维护多个笼架，每个笼架可设置独立行列数。</p>
          </div>
          ${canManageRooms ? `<button id="resetDemo" class="secondary">${iconSvg("refresh")}重置示例数据</button>` : ""}
        </div>
        <div class="room-list">
          ${visibleRooms().map(renderRoomCard).join("") || `<p class="muted">当前账号没有授权饲养间。</p>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head compact">
          <div>
            <h2>编辑操作</h2>
            <p>默认展示预览，点击按钮后弹出对应编辑窗口。</p>
          </div>
        </div>
        <div class="form-actions">
          ${canManageRooms ? `<button class="secondary" type="button" id="openRoomForm">${iconSvg("plus")}新增饲养间</button>` : ""}
          <button class="secondary" type="button" id="openRackForm" ${visibleRooms().length ? "" : "disabled"}>${iconSvg("plus")}新增笼架</button>
        </div>
      </div>
      ${
        canManageRooms && state.showRoomForm
          ? `
            <div class="editor-modal-backdrop" id="closeRoomForm"></div>
            <div class="panel detail-panel editor-modal">
              <div class="editor-modal-actions">
                <button class="secondary" type="button" id="closeRoomFormButton">${iconSvg("chevronRight")}关闭编辑</button>
              </div>
              <div class="panel-head compact">
                <div>
                  <h2>新增饲养间</h2>
                  <p>先建立饲养间，再按实际摆放新增笼架。</p>
                </div>
              </div>
              <form id="roomForm" class="form">
                <label class="field-required">
                  饲养间名称
                  <input name="name" required placeholder="请输入饲养间名称，如 SPF 小鼠饲养间 C" />
                </label>
                <label>
                  区域
                  <input name="area" placeholder="请输入区域，如 屏障区" />
                </label>
                <button class="primary" type="submit">${iconSvg("plus")}新增饲养间</button>
              </form>
            </div>
          `
          : ""
      }
      ${
        state.showRackForm
          ? `
            <div class="editor-modal-backdrop" id="closeRackForm"></div>
            <div class="panel detail-panel editor-modal">
              <div class="editor-modal-actions">
                <button class="secondary" type="button" id="closeRackFormButton">${iconSvg("chevronRight")}关闭编辑</button>
              </div>
              <div class="panel-head compact">
                <div>
                  <h2>新增笼架</h2>
                  <p>给已创建饲养间添加一个独立规格的笼架。</p>
                </div>
              </div>
              <form id="rackForm" class="form">
                <label class="field-required">
                  所属饲养间
                  <select name="roomId" required>
                    <option value="" disabled ${visibleRooms().length ? "" : "selected"}>请选择饲养间</option>
                    ${visibleRooms()
                      .map((room) => `<option value="${escapeAttr(room.id)}" ${room.id === rackFormRoomId ? "selected" : ""}>${escapeText(room.name)}</option>`)
                      .join("")}
                  </select>
                </label>
                <label class="field-required">
                  笼架编号
                  <input type="number" name="index" min="1" value="${suggestedRackIndex(rackFormRoomId)}" placeholder="请输入笼架编号" required />
                </label>
                <div class="form-row">
                  <label class="field-required">
                    行数 X
                    <input type="number" name="rows" min="1" value="${escapeAttr(rackDraft.rows)}" placeholder="请输入行数" required />
                  </label>
                  <label class="field-required">
                    列数 Y
                    <input type="number" name="cols" min="1" value="${escapeAttr(rackDraft.cols)}" placeholder="请输入列数" required />
                  </label>
                </div>
                <button class="primary" type="submit">${iconSvg("plus")}新增笼架</button>
              </form>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderUserManagementView() {
  return `
    <section class="content-grid">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>账号管理</h2>
            <p>查看系统管理员和房间管理员账号。</p>
          </div>
        </div>
        <div class="user-list">
          ${users.map(renderUserRow).join("") || `<p class="muted">暂无账号。</p>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head compact">
          <div>
            <h2>创建账号</h2>
            <p>为各饲养间管理员创建独立账号。</p>
          </div>
        </div>
        <form id="userForm" class="form">
          <label class="field-required">
            用户名
            <input name="username" required placeholder="请输入登录名，如 room_a_admin" />
          </label>
          <label class="field-required">
            显示姓名
            <input name="displayName" required placeholder="请输入显示姓名，如 SPF A 管理员" />
          </label>
          <label class="field-required">
            初始密码
            <input name="password" type="password" placeholder="请输入初始密码" required />
          </label>
          <label>
            角色
            <select name="role">
              <option value="room_admin">房间管理员</option>
              <option value="admin">系统管理员</option>
            </select>
          </label>
          <div class="room-checkboxes">
            ${state.rooms
              .map(
                (room) => `
                  <label>
                    <input type="checkbox" name="roomIds" value="${escapeAttr(room.id)}" />
                    ${escapeText(room.name)}
                  </label>
                `,
              )
              .join("")}
          </div>
          <button class="primary" type="submit">${iconSvg("plus")}创建账号</button>
        </form>
      </div>
    </section>
  `;
}

function renderDataManagementView() {
  return `
    <section class="content-grid">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>数据管理</h2>
            <p>维护系统外部数据源和后续导入导出任务。</p>
          </div>
        </div>
        ${renderIacucStatusCard()}
        ${renderPrincipalIdentityPanel()}
      </div>
      <div class="panel">
        ${renderIacucAdminPanel()}
      </div>
    </section>
  `;
}

function renderSystemManagementView() {
  return `
    <section class="system-layout">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>系统管理</h2>
            <p>查看系统状态、版本更新和项目说明文档。</p>
          </div>
        </div>
        ${renderSystemUpdateCard()}
        ${renderReleaseNotes()}
      </div>
      <div class="system-side">
        <div class="panel">
          ${renderSystemDocsPanel()}
        </div>
        <div class="panel">
          ${renderApiReferencePanel()}
        </div>
      </div>
    </section>
  `;
}

function renderIacucStatusCard() {
  return `
    <div class="rule-card">
      <strong>IACUC 索引</strong>
      <span>${IACUC_INDEX.length} 条记录</span>
      <p>${iacucIndexMeta?.updatedAt ? `最后更新：${escapeText(formatLogTime(iacucIndexMeta.updatedAt))}` : "尚未上传索引文件。"}</p>
      <p>索引用于录入笼位和生成结算单时自动匹配项目名称、项目负责人、实验负责人和支撑经费。</p>
    </div>
  `;
}

function renderPrincipalIdentityPanel() {
  const allItems = principalIdentityRows();
  const items = filteredPrincipalIdentityRows(allItems);
  return `
    <div class="system-section">
      <div class="panel-head compact">
        <div>
          <h2>项目负责人身份</h2>
          <p>默认按独立科研人员计算 10 笼/天免费；需要减免 20 笼/天的负责人改为 PI。</p>
        </div>
      </div>
      <div class="toolbar">
        <input id="principalIdentityFilter" type="search" value="${escapeAttr(state.principalIdentityFilter)}" placeholder="检索姓名、PI、独立科研人员、10 或 20" />
        <button id="applyPrincipalIdentityFilter" class="secondary" type="button">${iconSvg("search")}检索</button>
        <button id="clearPrincipalIdentityFilter" class="secondary" type="button">清空</button>
        <span class="muted">${items.length} / ${allItems.length} 人</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>项目负责人</th>
              <th>IACUC 数</th>
              <th>负责人身份</th>
              <th>免费笼数/天</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              items.length
                ? items.map(renderPrincipalIdentityRow).join("")
                : `<tr><td colspan="5">${allItems.length ? "没有匹配的项目负责人。" : "上传 IACUC 汇总表后显示项目负责人。"}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPrincipalIdentityRow(item) {
  const principalType = normalizePrincipalType(item.principalType);
  return `
    <tr>
      <td>${escapeText(item.pi)}</td>
      <td>${item.iacucCount}</td>
      <td>
        <select data-principal-type="${escapeAttr(item.pi)}">
          <option value="${BILLING_PRINCIPAL_INDEPENDENT}" ${principalType === BILLING_PRINCIPAL_INDEPENDENT ? "selected" : ""}>独立科研人员</option>
          <option value="${BILLING_PRINCIPAL_PI}" ${principalType === BILLING_PRINCIPAL_PI ? "selected" : ""}>PI</option>
        </select>
      </td>
      <td>${freeCageAllowanceForPrincipalType(principalType)}</td>
      <td><button class="secondary" type="button" data-save-principal="${escapeAttr(item.pi)}">${iconSvg("save")}保存</button></td>
    </tr>
  `;
}

function renderSystemUpdateCard() {
  const info = systemUpdateInfo;
  const statusText = updateStatusText(info);

  return `
    <div class="rule-card update-card">
      <strong>系统更新</strong>
      <span>${escapeText(statusText)}</span>
      <p>系统版本：${escapeText(systemInfo.version ? `v${systemInfo.version}` : "未设置")}</p>
      <p>所属单位：${escapeText(systemInfo.organization || "-")} · ${escapeText(systemInfo.department || "-")}</p>
      <p>开发人员：${escapeText(systemInfo.developer || "-")} · ${escapeText(systemInfo.contactEmail || "-")}</p>
      <p>开源协议：${escapeText(systemInfo.license || "-")}</p>
      <p>版权信息：${escapeText(systemInfo.copyright || "-")}</p>
      ${info?.latestShort ? `<p>GitHub 最新版本：${escapeText(info.latestShort)}${info.latestMessage ? ` · ${escapeText(info.latestMessage)}` : ""}</p>` : ""}
      ${info?.currentShort ? `<p>当前运行版本：${escapeText(info.currentShort)}</p>` : ""}
      ${info?.checkedAt ? `<p>检查时间：${escapeText(formatLogTime(info.checkedAt))}</p>` : ""}
      ${info?.error ? `<p class="error-text">${escapeText(info.error)}</p>` : ""}
      <button id="checkSystemUpdate" class="secondary" type="button">${iconSvg("refresh")}${info?.loading ? "检查中" : "检查更新"}</button>
    </div>
  `;
}

function renderReleaseNotes() {
  return `
    <div class="system-section">
      <div class="panel-head compact">
        <div>
          <h2>更新记录</h2>
          <p>记录当前系统主要版本变化。</p>
        </div>
      </div>
      <div class="release-list">
        ${SYSTEM_RELEASE_NOTES.map(renderReleaseNote).join("")}
      </div>
    </div>
  `;
}

function renderReleaseNote(note) {
  return `
    <article class="release-card">
      <div>
        <strong>v${escapeText(note.version)}</strong>
        <span>${escapeText(note.title)}</span>
      </div>
      <ul>
        ${note.items.map((item) => `<li>${escapeText(item)}</li>`).join("")}
      </ul>
    </article>
  `;
}

function renderSystemDocsPanel() {
  return `
    <div class="panel-head compact">
      <div>
        <h2>说明文档</h2>
        <p>系统维护相关文档入口。</p>
      </div>
    </div>
    <div class="doc-link-list">
      ${SYSTEM_DOC_LINKS.map(
        (doc) => `
          <a class="doc-link" href="${escapeAttr(doc.href)}" target="_blank" rel="noreferrer">
            <strong>${escapeText(doc.title)}</strong>
            <span>${escapeText(doc.description)}</span>
          </a>
        `,
      ).join("")}
    </div>
  `;
}

function renderApiReferencePanel() {
  return `
    <div class="panel-head compact">
      <div>
        <h2>API 概览</h2>
        <p>后端常用接口分组。</p>
      </div>
    </div>
    <div class="api-group-list">
      ${SYSTEM_API_GROUPS.map(
        (group) => `
          <div class="api-group">
            <strong>${escapeText(group.title)}</strong>
            <code>${group.endpoints.map(escapeText).join("<br />")}</code>
          </div>
        `,
      ).join("")}
    </div>
  `;
}

function updateStatusText(info) {
  if (!info) return "尚未检查 GitHub 最新版本。";
  if (info.loading) return "正在检查 GitHub 最新版本。";
  if (info.error) return "检查失败";
  if (info.updateAvailable === true) return "发现新版本";
  if (info.updateAvailable === false) return "当前已是最新版本";
  return "已获取远端版本，当前运行版本未知";
}

function renderIacucAdminPanel() {
  return `
    <div class="panel-head compact">
      <div>
        <h2>IACUC 索引</h2>
        <p>上传 CSV 汇总表后，用于自动回填项目名称、项目负责人和实验负责人。</p>
      </div>
    </div>
    <form id="iacucUploadForm" class="form">
          <label class="field-required">
            动物实验申请汇总表 CSV
        <input name="file" type="file" accept=".csv,text/csv" required />
      </label>
      <button class="primary" type="submit">${iconSvg("upload")}上传并生成索引</button>
    </form>
    <p class="muted iacuc-index-status">
      当前索引：${IACUC_INDEX.length} 条${iacucIndexMeta?.updatedAt ? ` · ${escapeText(formatLogTime(iacucIndexMeta.updatedAt))}` : ""}
    </p>
  `;
}

function renderUserRow(user) {
  const isCurrent = currentUser?.id === user.id;
  return `
    <form class="user-row user-edit-form" data-user-id="${escapeAttr(user.id)}">
      <div class="user-fields">
        <label>
          登录名
          <input name="username" value="${escapeAttr(user.username)}" placeholder="请输入登录名" ${isCurrent ? "disabled" : "required"} />
        </label>
        <label>
          显示姓名
          <input name="displayName" value="${escapeAttr(user.displayName)}" placeholder="请输入显示姓名" ${isCurrent ? "disabled" : "required"} />
        </label>
        <label>
          新密码
          <input name="password" type="password" placeholder="请输入新密码，留空不修改" ${isCurrent ? "disabled" : ""} />
        </label>
        <label>
          角色
          <select name="role" ${isCurrent ? "disabled" : ""}>
            <option value="room_admin" ${user.role === "room_admin" ? "selected" : ""}>房间管理员</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>系统管理员</option>
          </select>
        </label>
      </div>
      <div class="user-room-access">
        ${state.rooms
          .map(
            (room) => `
              <label>
                <input type="checkbox" name="roomIds" value="${escapeAttr(room.id)}" ${user.roomIds.includes(room.id) ? "checked" : ""} ${isCurrent || user.role === "admin" ? "disabled" : ""} />
                ${escapeText(room.name)}
              </label>
            `,
          )
          .join("")}
        <p>${user.role === "admin" ? "系统管理员默认拥有全部饲养间权限。" : "房间管理员仅可编辑勾选饲养间。"}</p>
      </div>
      <div class="user-row-actions">
        ${
          isCurrent
            ? `<span class="muted">当前账号</span>`
            : `
              <button class="secondary" type="submit">${iconSvg("save")}保存</button>
              <button class="icon-danger" type="button" data-delete-user="${escapeAttr(user.id)}" aria-label="删除 ${escapeAttr(user.displayName)}">${iconSvg("trash")}</button>
            `
        }
      </div>
    </form>
  `;
}

function renderAuditView() {
  const logs = state.auditLogs || [];
  return `
    <section class="panel large">
      <div class="panel-head">
        <div>
          <h2>操作日志</h2>
          <p>记录账号、动作、笼位和时间，便于追溯。</p>
        </div>
      </div>
      <div class="audit-list">
        ${
          logs.length
            ? logs.map(renderAuditLog).join("")
            : `<div class="empty-state">${iconSvg("receipt")}<h2>暂无操作日志</h2></div>`
        }
      </div>
    </section>
  `;
}

function renderAuditLog(log) {
  const actor = log.actorDisplayName || "未记录账号";
  return `
    <div class="audit-row">
      <div>
        <strong>${escapeText(log.message || "操作记录")}</strong>
        <p>${escapeText(actor)} · ${escapeText(log.action || "manual")}</p>
      </div>
      <time>${escapeText(formatLogTime(log.at))}</time>
    </div>
  `;
}

function renderRoomCard(room) {
  const racks = state.racks.filter((rack) => rack.roomId === room.id);
  const slots = racks.flatMap((rack) => state.slots.filter((slot) => slot.rackId === rack.id));
  const active = slots.filter((slot) => slot.status === "active").length;
  const reserved = slots.filter((slot) => slot.status === "reserved").length;
  const canManageRooms = !remotePersistence || currentUser?.role === "admin";

  return `
    <div class="room-tree">
      <div class="room-tree-head">
        <div>
          <h3>${room.name}</h3>
          <p>${room.area || "未设置区域"} · ${racks.length} 个笼架 · ${slots.length} 个笼位</p>
        </div>
        <div class="tree-actions">
          <span>${slots.length} 笼位</span>
          <span>${active} 在用</span>
          <span>${reserved} 预约</span>
          ${
            canManageRooms
              ? `
                <button type="button" class="icon-danger" data-delete-room="${room.id}" title="删除饲养间" aria-label="删除饲养间 ${room.name}">
                  ${iconSvg("trash")}
                </button>
              `
              : ""
          }
        </div>
      </div>
      <div class="rack-tree">
        ${racks.map((rack) => renderRackTreeItem(room, rack)).join("")}
      </div>
    </div>
  `;
}

function renderRackTreeItem(room, rack) {
  const slots = state.slots.filter((slot) => slot.rackId === rack.id);
  const active = slots.filter((slot) => slot.status === "active").length;
  const reserved = slots.filter((slot) => slot.status === "reserved").length;

  return `
    <div class="rack-tree-item">
      <div class="rack-name">
        <span class="tree-branch"></span>
        <strong>笼架 ${rackCode(rack)}</strong>
        <small>${rack.rows} 行 * ${rack.cols} 列</small>
      </div>
      <div class="tree-actions">
        <span>${slots.length} 笼位</span>
        <span>${active} 在用</span>
        <span>${reserved} 预约</span>
        <button type="button" class="secondary compact-action" data-edit-rack="${rack.id}" title="编辑笼架" aria-label="编辑 ${room.name} 笼架 ${rackCode(rack)}">
          ${iconSvg("edit")}编辑
        </button>
        <button type="button" class="icon-danger" data-delete-rack="${rack.id}" title="删除笼架" aria-label="删除 ${room.name} 笼架 ${rackCode(rack)}">
          ${iconSvg("trash")}
        </button>
      </div>
      ${state.editingRackId === rack.id ? renderRackEditForm(room, rack) : ""}
    </div>
  `;
}

function renderRackEditForm(room, rack) {
  return `
    <form class="rack-edit-form" data-rack-edit-form="${escapeAttr(rack.id)}">
      <input type="hidden" name="rackId" value="${escapeAttr(rack.id)}" />
      <label class="field-required">
        编号
        <input type="number" name="index" min="1" value="${escapeAttr(rack.index)}" required />
      </label>
      <label class="field-required">
        行数 X
        <input type="number" name="rows" min="1" value="${escapeAttr(rack.rows)}" required />
      </label>
      <label class="field-required">
        列数 Y
        <input type="number" name="cols" min="1" value="${escapeAttr(rack.cols)}" required />
      </label>
      <div class="rack-edit-actions">
        <button class="primary" type="submit">${iconSvg("save")}保存</button>
        <button class="secondary" type="button" data-cancel-rack-edit="${escapeAttr(rack.id)}">取消</button>
      </div>
    </form>
  `;
}

function bindEvents() {
  decorateRequiredFields();
  document.querySelector("#logoutButton")?.addEventListener("click", logout);
  document.querySelector("#sidebarToggle")?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    render();
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      render();
    });
  });

  document.querySelector("#roomSelect")?.addEventListener("change", (event) => {
    state.selectedRoomId = event.target.value;
    state.selectedRackId = state.racks.find((rack) => rack.roomId === state.selectedRoomId)?.id;
    state.selectedSlotId = state.slots.find((slot) => slot.rackId === state.selectedRackId)?.id;
    state.selectedSlotIds = [];
    render();
  });

  document.querySelector("#rackSelect")?.addEventListener("change", (event) => {
    state.selectedRackId = event.target.value;
    state.selectedSlotId = state.slots.find((slot) => slot.rackId === state.selectedRackId)?.id;
    state.selectedSlotIds = [];
    render();
  });

  document.querySelectorAll("[data-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.batchMode) {
        toggleBatchSlot(button.dataset.slot);
      } else {
        state.selectedSlotId = button.dataset.slot;
        state.selectedSlotIds = [];
      }
      render();
    });
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.slotFilter = button.dataset.filter;
      state.selectedSlotIds = [];
      render();
    });
  });

  document.querySelector("#batchModeToggle")?.addEventListener("click", () => {
    state.batchMode = !state.batchMode;
    state.selectedSlotIds = state.batchMode && state.selectedSlotId ? [state.selectedSlotId] : [];
    render();
  });
  document.querySelector("#selectVisibleSlots")?.addEventListener("click", selectVisibleSlots);
  document.querySelector("#clearBatchSelection")?.addEventListener("click", () => {
    state.selectedSlotIds = [];
    render();
  });
  document.querySelector("#slotForm")?.addEventListener("submit", handleSlotSubmit);
  document.querySelector("#slotForm input[name='iacuc']")?.addEventListener("input", updateIacucOptions);
  document.querySelector("#slotForm input[name='iacuc']")?.addEventListener("change", autofillIacucFields);
  document.querySelector("#slotForm input[name='iacuc']")?.addEventListener("blur", autofillIacucFields);
  document.querySelector("#batchSlotForm")?.addEventListener("submit", handleBatchSlotSubmit);
  document.querySelector("#batchSlotForm input[name='iacuc']")?.addEventListener("input", updateIacucOptions);
  document.querySelector("#batchSlotForm input[name='iacuc']")?.addEventListener("change", autofillIacucFields);
  document.querySelector("#batchSlotForm input[name='iacuc']")?.addEventListener("blur", autofillIacucFields);
  document.querySelector("#openSampleSlot")?.addEventListener("click", () => openSampling("single"));
  document.querySelector("#openSampleBatchSlots")?.addEventListener("click", () => openSampling("batch"));
  document.querySelector("#confirmSampleSlot")?.addEventListener("click", sampleSelectedSlot);
  document.querySelector("#confirmSampleBatchSlots")?.addEventListener("click", sampleBatchSlots);
  document.querySelector("#cancelSampling")?.addEventListener("click", () => {
    state.samplingMode = "";
    render();
  });
  document.querySelector("#clearSlot")?.addEventListener("click", clearSelectedSlot);
  document.querySelector("#clearBatchSlots")?.addEventListener("click", clearBatchSlots);
  document.querySelector("#openCageEditor")?.addEventListener("click", () => {
    state.showCageEditor = true;
    render();
  });
  document.querySelector("#closeCageEditor")?.addEventListener("click", () => {
    state.showCageEditor = false;
    render();
  });
  document.querySelector("#closeCageEditorButton")?.addEventListener("click", () => {
    state.showCageEditor = false;
    render();
  });
  document.querySelectorAll("[data-billing-source]").forEach((button) => {
    button.addEventListener("click", () => {
      captureQuantitySheetDraft();
      state.billingSource = button.dataset.billingSource;
      render();
    });
  });
  document.querySelector("#billingMonth")?.addEventListener("change", (event) => {
    state.billingMonth = event.target.value;
    render();
  });
  document.querySelector("#billingPi")?.addEventListener("change", (event) => {
    updateBillingPi(event.target.value);
  });
  document.querySelector("#billingPi")?.addEventListener("blur", (event) => {
    updateBillingPi(event.target.value);
  });
  document.querySelector("#billingPi")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      updateBillingPi(event.target.value);
    }
  });
  document.querySelector("#exportBilling")?.addEventListener("click", exportBillingCsv);
  document.querySelector("#exportSettlementPdf")?.addEventListener("click", exportSettlementPdf);
  document.querySelector("#quantitySheetForm")?.addEventListener("submit", handleQuantitySheetSubmit);
  document.querySelector("#quantitySheetSelect")?.addEventListener("change", handleQuantitySheetSelect);
  document.querySelector("#newQuantitySheet")?.addEventListener("click", newQuantitySheetDraft);
  document.querySelector("#addQuantitySheetRow")?.addEventListener("click", addQuantitySheetRow);
  document.querySelectorAll("[data-remove-qrow]").forEach((button) => {
    button.addEventListener("click", () => removeQuantitySheetRow(Number(button.dataset.removeQrow)));
  });
  document.querySelector("#quantitySheetForm input[name='iacuc']")?.addEventListener("input", updateIacucOptions);
  document.querySelector("#quantitySheetForm input[name='iacuc']")?.addEventListener("change", autofillQuantitySheetIacucFields);
  document.querySelector("#quantitySheetForm input[name='iacuc']")?.addEventListener("blur", autofillQuantitySheetIacucFields);
  document.querySelector("#quantitySheetForm select[name='roomId']")?.addEventListener("change", syncQuantitySheetRoomName);
  document.querySelector("#rateForm")?.addEventListener("submit", handleRateSubmit);
  document.querySelector("#roomForm")?.addEventListener("submit", handleRoomSubmit);
  document.querySelector("#rackForm")?.addEventListener("submit", handleRackSubmit);
  document.querySelector("#rackForm select[name='roomId']")?.addEventListener("change", syncRackFormIndex);
  document.querySelectorAll("#rackForm input[name='rows'], #rackForm input[name='cols']").forEach((input) => {
    input.addEventListener("input", updateRackFormDraft);
  });
  document.querySelectorAll("[data-edit-rack]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingRackId = button.dataset.editRack;
      render();
    });
  });
  document.querySelectorAll("[data-cancel-rack-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.editingRackId === button.dataset.cancelRackEdit) state.editingRackId = "";
      render();
    });
  });
  document.querySelectorAll("[data-rack-edit-form]").forEach((form) => {
    form.addEventListener("submit", handleRackEditSubmit);
  });
  document.querySelector("#userForm")?.addEventListener("submit", handleUserSubmit);
  document.querySelectorAll(".user-edit-form").forEach((form) => {
    form.addEventListener("submit", handleUserUpdate);
    form.querySelector("select[name='role']")?.addEventListener("change", (event) => {
      const isAdmin = event.target.value === "admin";
      form.querySelectorAll("input[name='roomIds']").forEach((input) => {
        input.disabled = isAdmin;
      });
      form.querySelector(".user-room-access p").textContent = isAdmin ? "系统管理员默认拥有全部饲养间权限。" : "房间管理员仅可编辑勾选饲养间。";
    });
  });
  document.querySelector("#iacucUploadForm")?.addEventListener("submit", handleIacucUpload);
  document.querySelector("#principalIdentityFilter")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyPrincipalIdentityFilter();
    }
  });
  document.querySelector("#applyPrincipalIdentityFilter")?.addEventListener("click", applyPrincipalIdentityFilter);
  document.querySelector("#clearPrincipalIdentityFilter")?.addEventListener("click", () => {
    state.principalIdentityFilter = "";
    render();
  });
  document.querySelectorAll("[data-save-principal]").forEach((button) => {
    button.addEventListener("click", () => {
      const pi = button.dataset.savePrincipal;
      const select = document.querySelector(`[data-principal-type="${cssEscape(pi)}"]`);
      savePrincipalIdentityFromTable(pi, select?.value);
    });
  });
  document.querySelector("#checkSystemUpdate")?.addEventListener("click", checkSystemUpdate);
  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", () => deleteUser(button.dataset.deleteUser));
  });
  document.querySelectorAll("[data-delete-room]").forEach((button) => {
    button.addEventListener("click", () => deleteRoom(button.dataset.deleteRoom));
  });
  document.querySelectorAll("[data-delete-rack]").forEach((button) => {
    button.addEventListener("click", () => deleteRack(button.dataset.deleteRack));
  });
  document.querySelector("#openRoomForm")?.addEventListener("click", () => {
    state.showRoomForm = true;
    render();
  });
  document.querySelector("#openRackForm")?.addEventListener("click", () => {
    state.showRackForm = true;
    render();
  });
  document.querySelector("#closeRoomForm")?.addEventListener("click", () => {
    state.showRoomForm = false;
    render();
  });
  document.querySelector("#closeRackForm")?.addEventListener("click", () => {
    state.showRackForm = false;
    render();
  });
  document.querySelector("#closeRoomFormButton")?.addEventListener("click", () => {
    state.showRoomForm = false;
    render();
  });
  document.querySelector("#closeRackFormButton")?.addEventListener("click", () => {
    state.showRackForm = false;
    render();
  });
  document.querySelector("#resetDemo")?.addEventListener("click", () => {
    if (remotePersistence) {
      alert("共享模式下不支持重置示例数据。");
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    state = normalize(structuredClone(seedData));
    render();
  });
}

function bindAuthEvents() {
  document.querySelector("#loginForm")?.addEventListener("submit", login);
}

function toggleBatchSlot(slotId) {
  state.selectedSlotId = slotId;
  if (state.selectedSlotIds.includes(slotId)) {
    state.selectedSlotIds = state.selectedSlotIds.filter((id) => id !== slotId);
  } else {
    state.selectedSlotIds = [...state.selectedSlotIds, slotId];
  }
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const error = document.querySelector("#loginError");
  if (error) error.textContent = "";
  try {
    const response = await fetch(API_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      if (error) error.textContent = payload.error || "登录失败";
      return;
    }
    currentUser = payload.user;
    await Promise.all([loadIacucIndex(), loadPersistedState(), loadUsers()]);
    render();
  } catch {
    if (error) error.textContent = "无法连接后端服务";
  }
}

async function logout() {
  await fetch(API_LOGOUT_URL, { method: "POST" }).catch(() => {});
  currentUser = null;
  users = [];
  render();
}

async function loadCurrentUser() {
  try {
    const response = await fetch(API_AUTH_ME_URL, { cache: "no-store" });
    if (response.ok) {
      remotePersistence = true;
      const payload = await response.json();
      currentUser = payload.user;
      return;
    }
    if (response.status === 401) {
      remotePersistence = true;
      currentUser = null;
      return;
    }
  } catch {
    remotePersistence = false;
    currentUser = null;
  }
}

async function loadUsers() {
  if (!currentUser || currentUser.role !== "admin") {
    users = [];
    return;
  }
  try {
    const response = await fetch(API_USERS_URL, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    users = payload.users || [];
  } catch {
    users = [];
  }
}

async function handleUserSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const roomIds = form.getAll("roomIds");
  const response = await fetch(API_USERS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: form.get("username"),
      displayName: form.get("displayName"),
      password: form.get("password"),
      role: form.get("role"),
      roomIds,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    alert(payload.error || "创建账号失败");
    return;
  }
  await loadUsers();
  render();
}

async function handleUserUpdate(event) {
  event.preventDefault();
  const formElement = event.target;
  const userId = formElement.dataset.userId;
  const form = new FormData(formElement);
  const role = form.get("role");
  const response = await fetch(`${API_USERS_URL}/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: form.get("username"),
      displayName: form.get("displayName"),
      password: form.get("password"),
      role,
      roomIds: role === "admin" ? [] : form.getAll("roomIds"),
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    alert(payload.error || "保存账号失败");
    return;
  }
  await loadUsers();
  render();
}

async function deleteUser(userId) {
  const user = users.find((item) => item.id === userId);
  if (!user) return;
  if (!confirm(`确认删除账号“${user.displayName}”？该账号将无法继续登录。`)) return;

  const response = await fetch(`${API_USERS_URL}/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    alert(payload.error || "删除账号失败");
    return;
  }
  await loadUsers();
  render();
}

async function handleIacucUpload(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const file = form.get("file");
  if (!file || !file.name) return;

  try {
    const response = await fetch(API_IACUC_UPLOAD_URL, {
      method: "POST",
      body: form,
    });
    const payload = await response.json();
    if (!response.ok) {
      alert(payload.error || "上传失败");
      return;
    }
    IACUC_INDEX = payload.items || [];
    IACUC_BY_NUMBER = new Map(IACUC_INDEX.map((item) => [normalizeIacucNumber(item.iacuc), item]));
    await loadPrincipalIdentities();
    iacucIndexMeta = {
      count: payload.count,
      updatedAt: payload.updatedAt,
      source: "data",
    };
    mergeServerAuditLogs(payload);
    alert(`已生成 IACUC 索引 ${payload.count} 条，重复编号 ${payload.duplicateCount || 0} 条。`);
    render();
  } catch {
    alert("上传失败，请检查网络或文件格式");
  }
}

async function savePrincipalIdentityFromTable(pi, principalType) {
  try {
    const item = await savePrincipalIdentity(pi, normalizePrincipalType(principalType));
    pushLog(`更新 ${item.pi} 负责人身份为 ${principalTypeLabel(item.principalType)}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function applyPrincipalIdentityFilter() {
  const input = document.querySelector("#principalIdentityFilter");
  state.principalIdentityFilter = input?.value || "";
  render();
}

async function savePrincipalIdentity(pi, principalType) {
  const normalizedType = normalizePrincipalType(principalType);
  const item = {
    pi,
    principalType: normalizedType,
    freeCageAllowance: freeCageAllowanceForPrincipalType(normalizedType),
  };
  if (!remotePersistence) {
    upsertPrincipalIdentity(item);
    return item;
  }
  const response = await fetch(`${API_PRINCIPAL_IDENTITIES_URL}/${encodeURIComponent(pi)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "保存项目负责人身份失败");
  }
  mergeServerAuditLogs(payload);
  upsertPrincipalIdentity(payload.item || item);
  return payload.item || item;
}

async function checkSystemUpdate() {
  systemUpdateInfo = { loading: true };
  render();

  try {
    const response = await fetch(API_SYSTEM_UPDATE_URL, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      systemUpdateInfo = { error: payload.error || "检查更新失败" };
      render();
      return;
    }
    systemUpdateInfo = payload;
    render();
  } catch {
    systemUpdateInfo = { error: "无法连接后端服务" };
    render();
  }
}

function selectVisibleSlots() {
  const selectedRoom = getSelectedRoom();
  if (!selectedRoom) return;
  const racks = state.racks.filter((rack) => rack.roomId === selectedRoom.id);
  const selectedRack = getSelectedRack(racks);
  if (!selectedRack) return;
  const slots = state.slots.filter((slot) => slot.rackId === selectedRack.id);
  const visibleSlots = state.slotFilter === "all" ? slots : slots.filter((slot) => slot.status === state.slotFilter);
  state.selectedSlotIds = visibleSlots.map((slot) => slot.id);
  state.selectedSlotId = state.selectedSlotIds[0] ?? state.selectedSlotId;
  render();
}

async function handleSlotSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const slotId = form.get("slotId");
  const status = form.get("status");
  const current = currentOccupancy(slotId);

  if (status === "empty") {
    try {
      await closeOccupancy(slotId, form.get("endDate") || today);
    } catch (error) {
      reportSaveError(error);
    }
    return;
  }

  const payload = {
    id: current?.id || crypto.randomUUID(),
    slotId,
    cageCode: form.get("cageCode").trim() || cageCodeForSlot(slotId),
    status,
    iacuc: form.get("iacuc").trim(),
    project: form.get("project").trim(),
    pi: form.get("pi").trim(),
    owner: form.get("owner").trim(),
    startDate: form.get("startDate") || today,
    endDate: form.get("endDate"),
    notes: form.get("notes").trim(),
    updatedAt: today,
  };

  try {
    const response = current
      ? await updateEntity("occupancies", current.id, payload)
      : await createEntity("occupancies", payload);
    upsertById(state.occupancies, response.item || payload);
    pushLog(`${current ? "更新" : "新增"}笼位 ${slotId} ${statusLabel(status)}`);
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function handleBatchSlotSubmit(event) {
  event.preventDefault();
  if (!state.selectedSlotIds.length) return;

  const selectedSlots = state.slots.filter((slot) => state.selectedSlotIds.includes(slot.id));
  const batchState = getBatchEditState(selectedSlots);
  if (batchState.hasConflict) {
    alert("当前选择包含多个不同 IACUC 编号，请只选择相同 IACUC 的笼位进行批量编辑。");
    return;
  }

  const form = new FormData(event.target);
  const payload = {
    status: form.get("status"),
    iacuc: form.get("iacuc").trim(),
    project: form.get("project").trim(),
    pi: form.get("pi").trim(),
    owner: form.get("owner").trim(),
    startDate: form.get("startDate") || today,
    endDate: form.get("endDate"),
    notes: form.get("notes").trim(),
    updatedAt: today,
  };

  try {
    const savedItems = [];
    for (const slotId of state.selectedSlotIds) {
      const current = currentOccupancy(slotId);
      const next = {
        id: current?.id || crypto.randomUUID(),
        ...payload,
        slotId,
        cageCode: current?.cageCode || cageCodeForSlot(slotId),
      };
      const response = current
        ? await updateEntity("occupancies", current.id, next)
        : await createEntity("occupancies", next);
      savedItems.push(response.item || next);
    }
    savedItems.forEach((item) => upsertById(state.occupancies, item));
    pushLog(`批量更新 ${state.selectedSlotIds.length} 个笼位为 ${statusLabel(payload.status)}`);
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function autofillIacucFields(event) {
  const form = event.target.form;
  const match = findIacucInfo(event.target.value);
  if (!form || !match) return;

  const projectInput = form.elements.project;
  const piInput = form.elements.pi;
  const ownerInput = form.elements.owner;

  if (projectInput && match.project) projectInput.value = match.project;
  if (piInput && match.pi) piInput.value = match.pi;
  if (ownerInput && match.owner) ownerInput.value = match.owner;
  event.target.value = match.iacuc;
}

function updateIacucOptions(event) {
  const listId = event.target.getAttribute("list");
  if (!listId) return;
  const datalist = document.getElementById(listId);
  if (!datalist) return;
  datalist.innerHTML = iacucOptions(event.target.value)
    .map((item) => `<option value="${escapeAttr(item.iacuc)}" label="${escapeAttr(item.project || item.pi || "")}"></option>`)
    .join("");
}

async function clearSelectedSlot() {
  try {
    await closeOccupancy(state.selectedSlotId, today, "cleared", { renderAfterSave: false });
    state.samplingMode = "";
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function openSampling(mode) {
  state.samplingMode = mode;
  render();
}

async function sampleSelectedSlot() {
  const current = currentOccupancy(state.selectedSlotId);
  if (!current || current.status !== "active") return;

  const sampledDate = document.querySelector("#sampleDate")?.value;
  if (!sampledDate) return;
  if (!validateEndDate(current, sampledDate)) return;

  try {
    await closeOccupancy(state.selectedSlotId, sampledDate, "sampled", { renderAfterSave: false });
    state.samplingMode = "";
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function sampleBatchSlots() {
  const selectedSlots = state.slots.filter((slot) => state.selectedSlotIds.includes(slot.id));
  const activeItems = selectedActiveOccupancies(selectedSlots);
  if (!activeItems.length) return;

  const sampledDate = document.querySelector("#batchSampleDate")?.value;
  if (!sampledDate) return;
  if (activeItems.some((item) => !validateEndDate(item, sampledDate))) return;
  if (!confirm(`确定将 ${activeItems.length} 笼标记为已取材，并以 ${sampledDate} 作为最后计费日期？`)) return;

  try {
    const savedItems = [];
    for (const item of activeItems) {
      savedItems.push(await closeOccupancy(item.slotId, sampledDate, "sampled", { renderAfterSave: false }));
    }
    savedItems.filter(Boolean).forEach((item) => upsertById(state.occupancies, item));
    pushLog(`批量标记已取材 ${activeItems.length} 个笼位，最后计费日期 ${sampledDate}`);
    state.samplingMode = "";
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function clearBatchSlots() {
  if (!state.selectedSlotIds.length) return;
  if (!confirm(`确定将已选择的 ${state.selectedSlotIds.length} 个笼位全部设为空？`)) return;

  try {
    const savedItems = [];
    for (const slotId of state.selectedSlotIds) {
      savedItems.push(await closeOccupancy(slotId, today, "cleared", { renderAfterSave: false }));
    }
    savedItems.filter(Boolean).forEach((item) => upsertById(state.occupancies, item));
    pushLog(`批量设空 ${state.selectedSlotIds.length} 个笼位`);
    state.samplingMode = "";
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function closeOccupancy(slotId, endDate, reason = "cleared", options = {}) {
  const { renderAfterSave = true } = options;
  const current = currentOccupancy(slotId);
  if (!current) {
    if (renderAfterSave) render();
    return null;
  }

  const next = {
    ...current,
    status: "ended",
    endDate,
    endReason: reason,
    updatedAt: today,
  };

  const response = await updateEntity("occupancies", current.id, next);
  const saved = response.item || next;
  upsertById(state.occupancies, saved);
  pushLog(`${reason === "sampled" ? "已取材" : "设为空"}：结束笼位 ${slotId} 占用，最后计费日期 ${endDate}`);
  updateSlotStatuses();
  if (renderAfterSave) render();
  return saved;
}

async function handleRateSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const principalType = normalizePrincipalType(form.get("principalType"));
  const freeCageAllowance = freeCageAllowanceForPrincipalType(principalType);
  const targetPi = state.billingPi || state.quantitySheetDraft?.pi || "";
  if (!targetPi) {
    alert("请先选择项目负责人。");
    return;
  }
  try {
    await savePrincipalIdentity(targetPi, principalType);
    state.freeCageAllowance = freeCageAllowance;
    state.billingPrincipalType = principalType;
    pushLog(`更新 ${targetPi} 负责人类型为 ${principalTypeLabel(principalType)}，免费笼数 ${freeCageAllowance}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function updateBillingPi(value) {
  const trimmed = value.trim();
  const match = piOptions(trimmed).find((item) => normalizePersonName(item.pi) === normalizePersonName(trimmed));
  state.billingPi = match?.pi || trimmed;
  state.billingPrincipalType = principalTypeForPi(state.billingPi);
  state.freeCageAllowance = freeCageAllowanceForPi(state.billingPi);
  render();
}

async function handleQuantitySheetSubmit(event) {
  event.preventDefault();
  try {
    const sheet = await saveQuantitySheetDraft();
    pushLog(`保存数量统计表：${sheet.iacuc} ${sheet.month}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function handleQuantitySheetSelect(event) {
  captureQuantitySheetDraft();
  const sheet = state.quantitySheets.find((item) => item.id === event.target.value);
  state.selectedQuantitySheetId = sheet?.id || "";
  state.quantitySheetDraft = normalizeQuantitySheetDraft(sheet || makeQuantitySheetDraft(state.billingMonth));
  state.billingMonth = state.quantitySheetDraft.month || state.billingMonth;
  state.billingIacuc = state.quantitySheetDraft.iacuc || state.billingIacuc;
  state.billingPi = state.quantitySheetDraft.pi || state.billingPi;
  state.billingPrincipalType = principalTypeForPi(state.billingPi);
  state.freeCageAllowance = freeCageAllowanceForPi(state.billingPi);
  render();
}

function newQuantitySheetDraft() {
  captureQuantitySheetDraft();
  state.selectedQuantitySheetId = "";
  state.quantitySheetDraft = makeQuantitySheetDraft(state.billingMonth || today.slice(0, 7));
  render();
}

function addQuantitySheetRow() {
  captureQuantitySheetDraft();
  state.quantitySheetDraft.rows.push(makeQuantitySheetRow(state.quantitySheetDraft.month));
  render();
}

function removeQuantitySheetRow(index) {
  captureQuantitySheetDraft();
  state.quantitySheetDraft.rows.splice(index, 1);
  render();
}

function captureQuantitySheetDraft() {
  const form = document.querySelector("#quantitySheetForm");
  if (!form) return;
  state.quantitySheetDraft = readQuantitySheetForm(form);
  state.billingMonth = state.quantitySheetDraft.month || state.billingMonth;
  state.billingIacuc = state.quantitySheetDraft.iacuc || state.billingIacuc;
  state.billingPi = state.quantitySheetDraft.pi || state.billingPi;
  state.billingPrincipalType = principalTypeForPi(state.billingPi);
  state.freeCageAllowance = freeCageAllowanceForPi(state.billingPi);
}

async function saveQuantitySheetDraft() {
  const form = document.querySelector("#quantitySheetForm");
  if (form) state.quantitySheetDraft = readQuantitySheetForm(form);
  const sheet = normalizeQuantitySheetDraft(state.quantitySheetDraft);
  if (!remotePersistence) {
    upsertById(state.quantitySheets, sheet);
    state.selectedQuantitySheetId = sheet.id;
    state.quantitySheetDraft = sheet;
    return sheet;
  }

  const exists = state.quantitySheets.some((item) => item.id === sheet.id);
  const response = await fetch(exists ? `${API_QUANTITY_SHEETS_URL}/${encodeURIComponent(sheet.id)}` : API_QUANTITY_SHEETS_URL, {
    method: exists ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "保存数量统计表失败");
  }
  mergeServerAuditLogs(payload);
  upsertById(state.quantitySheets, payload.item || sheet);
  state.selectedQuantitySheetId = (payload.item || sheet).id;
  state.quantitySheetDraft = payload.item || sheet;
  return state.quantitySheetDraft;
}

function readQuantitySheetForm(form) {
  const data = new FormData(form);
  const room = state.rooms.find((item) => item.id === data.get("roomId"));
  const month = data.get("month") || state.billingMonth || today.slice(0, 7);
  const rows = [...form.querySelectorAll("[data-quantity-row]")]
    .map((row) => ({
      id: state.quantitySheetDraft?.rows?.[Number(row.dataset.quantityRow)]?.id || crypto.randomUUID(),
      date: row.querySelector("[name='rowDate']")?.value || "",
      addedCount: numericOrNull(row.querySelector("[name='addedCount']")?.value),
      addedType: row.querySelector("[name='addedType']")?.value || "",
      removedCount: numericOrNull(row.querySelector("[name='removedCount']")?.value),
      removedType: row.querySelector("[name='removedType']")?.value || "",
      animalCount: numericOrNull(row.querySelector("[name='animalCount']")?.value),
      cageCount: numericOrNull(row.querySelector("[name='cageCount']")?.value),
      notes: row.querySelector("[name='notes']")?.value.trim() || "",
    }))
    .filter((row) => row.date || row.addedCount || row.removedCount || row.animalCount !== null || row.cageCount !== null);

  return normalizeQuantitySheetDraft({
    id: state.quantitySheetDraft?.id || crypto.randomUUID(),
    month,
    roomId: data.get("roomId") || "",
    roomName: data.get("roomName")?.trim() || room?.name || "",
    manager: data.get("manager")?.trim() || "",
    iacuc: normalizeIacucNumber(data.get("iacuc") || ""),
    project: data.get("project")?.trim() || "",
    pi: data.get("pi")?.trim() || "",
    owner: data.get("owner")?.trim() || "",
    contact: data.get("contact")?.trim() || "",
    funding: data.get("funding")?.trim() || "",
    billingUnit: data.get("billingUnit") || "cage_day",
    initialAnimalCount: numericOrZero(data.get("initialAnimalCount")),
    initialCageCount: numericOrZero(data.get("initialCageCount")),
    rows,
  });
}

function makeQuantitySheetDraft(month = today.slice(0, 7)) {
  return normalizeQuantitySheetDraft({
    id: crypto.randomUUID(),
    month,
    roomId: "",
    roomName: "",
    manager: currentUser?.displayName || "",
    iacuc: "",
    project: "",
    pi: "",
    owner: "",
    contact: "",
    funding: "",
    billingUnit: "cage_day",
    initialAnimalCount: 0,
    initialCageCount: 0,
    rows: [makeQuantitySheetRow(month)],
  });
}

function makeQuantitySheetRow(month = today.slice(0, 7)) {
  return {
    id: crypto.randomUUID(),
    date: `${month}-01`,
    addedCount: null,
    addedType: "",
    removedCount: null,
    removedType: "",
    animalCount: null,
    cageCount: null,
    notes: "",
  };
}

function normalizeQuantitySheetDraft(sheet) {
  const month = sheet?.month || today.slice(0, 7);
  return {
    id: sheet?.id || crypto.randomUUID(),
    month,
    roomId: sheet?.roomId || "",
    roomName: sheet?.roomName || "",
    manager: sheet?.manager || "",
    iacuc: normalizeIacucNumber(sheet?.iacuc || ""),
    project: sheet?.project || "",
    pi: sheet?.pi || "",
    owner: sheet?.owner || "",
    contact: sheet?.contact || "",
    funding: sheet?.funding || "",
    billingUnit: "cage_day",
    initialAnimalCount: numericOrZero(sheet?.initialAnimalCount),
    initialCageCount: numericOrZero(sheet?.initialCageCount),
    rows: Array.isArray(sheet?.rows) ? sheet.rows.map((row) => normalizeQuantitySheetDraftRow(row, month)) : [],
    updatedAt: sheet?.updatedAt || "",
  };
}

function normalizeQuantitySheetDraftRow(row, month) {
  return {
    id: row?.id || crypto.randomUUID(),
    date: row?.date || `${month}-01`,
    addedCount: numericOrNull(row?.addedCount),
    addedType: row?.addedType || "",
    removedCount: numericOrNull(row?.removedCount),
    removedType: row?.removedType || "",
    animalCount: numericOrNull(row?.animalCount),
    cageCount: numericOrNull(row?.cageCount),
    notes: row?.notes || "",
  };
}

function autofillQuantitySheetIacucFields(event) {
  const form = event.target.form;
  const match = findIacucInfo(event.target.value);
  if (!form || !match) return;
  if (form.elements.project && match.project) form.elements.project.value = match.project;
  if (form.elements.pi && match.pi) form.elements.pi.value = match.pi;
  if (form.elements.owner && match.owner) form.elements.owner.value = match.owner;
  if (form.elements.funding && match.funding) form.elements.funding.value = match.funding;
  event.target.value = match.iacuc;
}

function syncQuantitySheetRoomName(event) {
  const room = state.rooms.find((item) => item.id === event.target.value);
  const roomNameInput = event.target.form?.elements.roomName;
  if (room && roomNameInput && !roomNameInput.value) roomNameInput.value = room.name;
}

function numericOrNull(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function numericOrZero(value) {
  return Number(value || 0);
}

function syncRackFormIndex(event) {
  state.rackFormDraft = normalizeRackFormDraft({
    ...state.rackFormDraft,
    roomId: event.target.value,
  });
  const indexInput = event.target.form?.elements.index;
  if (indexInput) indexInput.value = suggestedRackIndex(event.target.value);
}

function updateRackFormDraft(event) {
  const form = event.target.form;
  state.rackFormDraft = normalizeRackFormDraft({
    roomId: form?.elements.roomId?.value || state.rackFormDraft?.roomId,
    rows: form?.elements.rows?.value || state.rackFormDraft?.rows,
    cols: form?.elements.cols?.value || state.rackFormDraft?.cols,
  });
}

function normalizeRackFormDraft(draft = {}) {
  return {
    roomId: draft.roomId || "",
    rows: Math.max(Number(draft.rows) || 5, 1),
    cols: Math.max(Number(draft.cols) || 6, 1),
  };
}

function currentRackFormDraft() {
  const draft = normalizeRackFormDraft(state.rackFormDraft);
  const rooms = visibleRooms();
  const roomExists = rooms.some((room) => room.id === draft.roomId);
  return {
    ...draft,
    roomId: roomExists ? draft.roomId : rooms.find((room) => room.id === state.selectedRoomId)?.id || rooms[0]?.id || "",
  };
}

async function handleRoomSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const name = form.get("name").trim();
  const room = {
    id: `room-${slugify(name)}-${Date.now()}`,
    name,
    area: form.get("area").trim(),
    rackCount: 0,
    rows: 0,
    cols: 0,
  };

  try {
    const response = await createInfrastructure({
      rooms: [room],
    });

    state.rooms.push(...(response.rooms || [room]));
    state.selectedRoomId = room.id;
    state.selectedRackId = "";
    state.selectedSlotId = "";
    state.activeView = "rooms";
    state.showRoomForm = false;
    pushLog(`新增饲养间 ${room.name}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function handleRackSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  state.rackFormDraft = normalizeRackFormDraft({
    roomId: form.get("roomId"),
    rows: form.get("rows"),
    cols: form.get("cols"),
  });
  const room = state.rooms.find((item) => item.id === state.rackFormDraft.roomId);
  if (!room) {
    alert("请选择有效的饲养间。");
    return;
  }

  const roomRacks = state.racks.filter((item) => item.roomId === room.id);
  const rackIndex = Number(form.get("index"));
  if (roomRacks.some((item) => Number(item.index) === rackIndex)) {
    alert("同一饲养间内笼架编号不能重复。");
    return;
  }
  const rows = state.rackFormDraft.rows;
  const cols = state.rackFormDraft.cols;
  const rackId = `rack-${room.id.replace(/^room-/, "")}-${Date.now()}`;
  const generated = generateRackInfrastructure(room, rackIndex, rows, cols, rackId);
  const updatedRoom = { ...room, rackCount: roomRacks.length + 1 };

  try {
    const response = await createInfrastructure({
      roomUpdates: [updatedRoom],
      racks: [generated.rack],
      slots: generated.slots,
    });

    Object.assign(room, (response.roomUpdates || [updatedRoom])[0]);
    state.racks.push(...(response.racks || [generated.rack]));
    state.slots.push(...(response.slots || generated.slots));
    state.selectedRoomId = room.id;
    state.selectedRackId = generated.rack.id;
    state.selectedSlotId = generated.slots[0]?.id;
    state.activeView = "rooms";
    state.editingRackId = "";
    state.showRackForm = false;
    pushLog(`新增${room.name} 笼架 ${rackCode(rackIndex)}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function handleRackEditSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const rackId = form.get("rackId");
  const rack = state.racks.find((item) => item.id === rackId);
  if (!rack) return;

  const room = state.rooms.find((item) => item.id === rack.roomId);
  if (!room) {
    alert("笼架关联的饲养间不存在。");
    return;
  }

  const rackIndex = Number(form.get("index"));
  const duplicate = state.racks.some((item) => item.roomId === room.id && item.id !== rack.id && Number(item.index) === rackIndex);
  if (duplicate) {
    alert("同一饲养间内笼架编号不能重复。");
    return;
  }

  const rows = Number(form.get("rows"));
  const cols = Number(form.get("cols"));
  const generated = generateRackInfrastructure(room, rackIndex, rows, cols, rack.id);
  const existingSlots = state.slots.filter((slot) => slot.rackId === rack.id);
  const nextSlots = generated.slots;
  const nextPositions = new Set(nextSlots.map(slotPositionKey));
  const existingPositions = new Set(existingSlots.map(slotPositionKey));
  const slotCreates = nextSlots.filter((slot) => !existingPositions.has(slotPositionKey(slot)));
  const slotDeletes = existingSlots.filter((slot) => !nextPositions.has(slotPositionKey(slot)));
  const activeDeleted = slotDeletes.filter((slot) => currentOccupancy(slot.id));
  if (activeDeleted.length) {
    alert(`缩小行列范围会移除 ${activeDeleted.length} 个在用或预约笼位，请先处理这些笼位。`);
    return;
  }

  try {
    const response = await createInfrastructure({
      rackUpdates: [generated.rack],
      slots: slotCreates,
      slotDeletes: slotDeletes.map((slot) => slot.id),
    });

    Object.assign(rack, (response.rackUpdates || [generated.rack])[0]);
    state.slots.push(...(response.slots || slotCreates));
    const deletedIds = new Set(response.slotDeletes || slotDeletes.map((slot) => slot.id));
    state.slots = state.slots.filter((slot) => !deletedIds.has(slot.id));
    state.selectedSlotIds = state.selectedSlotIds.filter((slotId) => !deletedIds.has(slotId));
    state.editingRackId = "";
    state.selectedRackId = rack.id;
    state.selectedSlotId = state.slots.find((slot) => slot.rackId === rack.id)?.id || "";
    pushLog(`更新${room.name} 笼架 ${rackCode(rack)}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function deleteRoom(roomId) {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;

  if (state.rooms.length <= 1) {
    alert("至少需要保留一个饲养间。");
    return;
  }

  const racks = state.racks.filter((rack) => rack.roomId === roomId);
  const rackIds = new Set(racks.map((rack) => rack.id));
  const slotIds = new Set(state.slots.filter((slot) => rackIds.has(slot.rackId)).map((slot) => slot.id));
  const occupancyCount = state.occupancies.filter((item) => slotIds.has(item.slotId)).length;
  const message = occupancyCount
    ? `确定删除 ${room.name}？这会删除 ${racks.length} 个笼架和 ${slotIds.size} 个笼位，${occupancyCount} 条占用记录会作为历史保留。`
    : `确定删除 ${room.name}？这会同时删除 ${racks.length} 个笼架和 ${slotIds.size} 个笼位。`;

  if (!confirm(message)) return;

  try {
    await deleteEntityRequest("rooms", roomId);
    state.rooms = state.rooms.filter((item) => item.id !== roomId);
    state.racks = state.racks.filter((rack) => rack.roomId !== roomId);
    state.slots = state.slots.filter((slot) => !slotIds.has(slot.id));
    state.selectedSlotIds = state.selectedSlotIds.filter((slotId) => !slotIds.has(slotId));
    if (racks.some((rack) => rack.id === state.editingRackId)) state.editingRackId = "";
    pushLog(`删除饲养间 ${room.name}`);
    selectFirstAvailableCage();
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function deleteRack(rackId) {
  const rack = state.racks.find((item) => item.id === rackId);
  if (!rack) return;

  const room = state.rooms.find((item) => item.id === rack.roomId);
  const roomRacks = state.racks.filter((item) => item.roomId === rack.roomId);
  const slots = state.slots.filter((slot) => slot.rackId === rackId);
  const slotIds = new Set(slots.map((slot) => slot.id));
  const occupancyCount = state.occupancies.filter((item) => slotIds.has(item.slotId)).length;
  const rackLabel = `${room?.name ?? "饲养间"} 笼架 ${rackCode(rack)}`;
  const message = occupancyCount
    ? `确定删除 ${rackLabel}？这会删除 ${slots.length} 个笼位，${occupancyCount} 条占用记录会作为历史保留。`
    : `确定删除 ${rackLabel}？这会同时删除 ${slots.length} 个笼位。`;

  if (!confirm(message)) return;

  try {
    const updatedRoom = room ? { ...room, rackCount: Math.max(roomRacks.length - 1, 0) } : null;
    await createInfrastructure({
      roomUpdates: updatedRoom ? [updatedRoom] : [],
      rackDeletes: [rackId],
    });
    state.racks = state.racks.filter((item) => item.id !== rackId);
    state.slots = state.slots.filter((slot) => slot.rackId !== rackId);
    state.selectedSlotIds = state.selectedSlotIds.filter((slotId) => !slotIds.has(slotId));
    if (state.editingRackId === rackId) state.editingRackId = "";
    if (room) {
      Object.assign(room, updatedRoom);
    }
    pushLog(`删除${rackLabel}`);
    selectFirstAvailableCage();
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function suggestedRackIndex(roomId) {
  const indexes = state.racks
    .filter((item) => item.roomId === roomId)
    .map((item) => Number(item.index))
    .filter((value) => Number.isFinite(value) && value > 0);
  return indexes.length ? Math.max(...indexes) + 1 : 1;
}

function slotPositionKey(slot) {
  return `${Number(slot.row)}:${Number(slot.col)}`;
}

function selectFirstAvailableCage() {
  const rooms = visibleRooms();
  const room = rooms.find((item) => item.id === state.selectedRoomId) ?? rooms[0];
  state.selectedRoomId = room?.id;

  const rack =
    state.racks.find((item) => item.id === state.selectedRackId && item.roomId === state.selectedRoomId) ??
    state.racks.find((item) => item.roomId === state.selectedRoomId);
  state.selectedRackId = rack?.id;

  const slot =
    state.slots.find((item) => item.id === state.selectedSlotId && item.rackId === state.selectedRackId) ??
    state.slots.find((item) => item.rackId === state.selectedRackId);
  state.selectedSlotId = slot?.id;
  state.selectedSlotIds = state.selectedSlotIds.filter((id) => state.slots.some((slotItem) => slotItem.id === id));
}

function buildQuantitySheetStatement(sheet) {
  const normalizedSheet = normalizeQuantitySheetDraft(sheet);
  const month = normalizedSheet.month || state.billingMonth;
  const pi = normalizedSheet.pi || state.billingPi || "";
  const sheets = quantitySheetsForStatement(normalizedSheet, month, pi);
  const dates = datesInMonth(month);
  const sheetStates = sheets.map((item) => {
    const rowsByDate = new Map();
    for (const row of item.rows || []) {
      if (!row.date) continue;
      rowsByDate.set(row.date, [...(rowsByDate.get(row.date) || []), row]);
    }
    return {
      sheet: item,
      rowsByDate,
      animalCount: numericOrZero(item.initialAnimalCount),
      cageCount: numericOrZero(item.initialCageCount),
    };
  });

  const freeCageAllowance = freeCageAllowanceForPi(pi);
  let cumulative = 0;
  const rows = dates.map((date) => {
    let animalCount = 0;
    let cageCount = 0;
    const quantitySheetRowIds = [];
    const iacucBreakdown = [];
    for (const item of sheetStates) {
      const dayRows = item.rowsByDate.get(date) || [];
      for (const row of dayRows) {
        item.animalCount = row.animalCount !== null ? numericOrZero(row.animalCount) : Math.max(item.animalCount + numericOrZero(row.addedCount) - numericOrZero(row.removedCount), 0);
        if (row.cageCount !== null) item.cageCount = numericOrZero(row.cageCount);
      }
      animalCount += item.animalCount;
      cageCount += item.cageCount;
      quantitySheetRowIds.push(...dayRows.map((row) => row.id));
      if (item.cageCount || item.animalCount) {
        iacucBreakdown.push({
          iacuc: item.sheet.iacuc,
          project: item.sheet.project,
          animalCount: item.animalCount,
          cageCount: item.cageCount,
        });
      }
    }
    const charge = tieredDailyCharge(cageCount, freeCageAllowance);
    const amount = charge.amount;
    cumulative += amount;
    return {
      date,
      animalCount,
      cageCount,
      ...charge,
      amount,
      cumulative,
      iacucBreakdown,
      quantitySheetRowIds,
    };
  });

  const iacucs = [...new Set(sheets.map((item) => item.iacuc).filter(Boolean))].sort();
  return {
    iacuc: iacucs.join("、") || normalizedSheet.iacuc,
    iacucs,
    month,
    project: uniqueJoined(sheets.map((item) => item.project)),
    pi,
    owner: uniqueJoined(sheets.map((item) => item.owner)),
    funding: uniqueJoined(sheets.map((item) => item.funding)),
    roomName: uniqueJoined(sheets.map((item) => item.roomName)),
    manager: uniqueJoined(sheets.map((item) => item.manager)),
    sourceType: "quantity_sheet",
    sourceId: normalizedSheet.id,
    sourceIds: sheets.map((item) => item.id),
    billingUnit: "cage_day",
    unitPrice: BILLING_TIER_BASE_PRICE,
    baseUnitPrice: BILLING_TIER_BASE_PRICE,
    overageUnitPrice: BILLING_TIER_OVER_PRICE,
    tierLimit: BILLING_TIER_LIMIT,
    freeCageAllowance,
    rows,
    totalCageDays: rows.reduce((sum, row) => sum + row.cageCount, 0),
    totalAnimalDays: rows.reduce((sum, row) => sum + row.animalCount, 0),
    totalFreeCageDays: rows.reduce((sum, row) => sum + row.freeCages, 0),
    totalBillableCageDays: rows.reduce((sum, row) => sum + row.billableCages, 0),
    totalTier1CageDays: rows.reduce((sum, row) => sum + row.tier1BillableCages, 0),
    totalTier2CageDays: rows.reduce((sum, row) => sum + row.tier2BillableCages, 0),
    totalAmount: cumulative,
  };
}

function buildStatement(pi, month) {
  const dates = datesInMonth(month);
  let cumulative = 0;
  const normalizedPi = normalizePersonName(pi);
  const freeCageAllowance = freeCageAllowanceForPi(pi);

  const rows = dates.map((date) => {
    const activeItems = activeOccupanciesOnDate(date).filter((item) => normalizePersonName(item.pi) === normalizedPi);
    const charge = tieredDailyCharge(activeItems.length, freeCageAllowance);
    const amount = charge.amount;
    cumulative += amount;

    return {
      date,
      cageCount: activeItems.length,
      ...charge,
      amount,
      cumulative,
      iacucBreakdown: occupancyBreakdown(activeItems),
    };
  });

  const iacucs = [...new Set(state.occupancies.filter((item) => normalizePersonName(item.pi) === normalizedPi).map((item) => normalizeIacucNumber(item.iacuc)).filter(Boolean))].sort();
  const info = piInfo(pi);
  return {
    iacuc: iacucs.join("、"),
    iacucs,
    month,
    project: info.project,
    pi,
    owner: info.owner,
    funding: info.funding,
    sourceType: "cage_map",
    billingUnit: "cage_day",
    unitPrice: BILLING_TIER_BASE_PRICE,
    baseUnitPrice: BILLING_TIER_BASE_PRICE,
    overageUnitPrice: BILLING_TIER_OVER_PRICE,
    tierLimit: BILLING_TIER_LIMIT,
    freeCageAllowance,
    rows,
    totalCageDays: rows.reduce((sum, row) => sum + row.cageCount, 0),
    totalFreeCageDays: rows.reduce((sum, row) => sum + row.freeCages, 0),
    totalBillableCageDays: rows.reduce((sum, row) => sum + row.billableCages, 0),
    totalTier1CageDays: rows.reduce((sum, row) => sum + row.tier1BillableCages, 0),
    totalTier2CageDays: rows.reduce((sum, row) => sum + row.tier2BillableCages, 0),
    totalAmount: cumulative,
  };
}

function activeOccupanciesOnDate(date) {
  return state.occupancies.filter((item) => {
    if (item.status !== "active" && item.status !== "ended") return false;
    if (!item.startDate || item.startDate > date) return false;
    if (item.endDate && item.endDate < date) return false;
    return true;
  });
}

function tieredDailyCharge(cageCount, freeCageAllowance) {
  const totalCages = Math.max(numericOrZero(cageCount), 0);
  const freeCages = Math.min(Math.max(numericOrZero(freeCageAllowance), 0), totalCages);
  const tier1Cages = Math.min(totalCages, BILLING_TIER_LIMIT);
  const tier2Cages = Math.max(totalCages - BILLING_TIER_LIMIT, 0);
  const tier1Free = Math.min(freeCages, tier1Cages);
  const tier2Free = Math.min(Math.max(freeCages - tier1Free, 0), tier2Cages);
  const tier1BillableCages = Math.max(tier1Cages - tier1Free, 0);
  const tier2BillableCages = Math.max(tier2Cages - tier2Free, 0);
  return {
    freeCages,
    billableCages: tier1BillableCages + tier2BillableCages,
    tier1Cages,
    tier2Cages,
    tier1BillableCages,
    tier2BillableCages,
    unitPrice: BILLING_TIER_BASE_PRICE,
    overageUnitPrice: BILLING_TIER_OVER_PRICE,
    discountPercent: 0,
    amount: tier1BillableCages * BILLING_TIER_BASE_PRICE + tier2BillableCages * BILLING_TIER_OVER_PRICE,
  };
}

function quantitySheetsForStatement(currentSheet, month, pi) {
  const normalizedPi = normalizePersonName(pi);
  const byId = new Map();
  [...state.quantitySheets, currentSheet].forEach((sheet) => {
    const normalized = normalizeQuantitySheetDraft(sheet);
    if (normalized.month === month && normalizePersonName(normalized.pi) === normalizedPi) byId.set(normalized.id, normalized);
  });
  return [...byId.values()].sort((a, b) => a.iacuc.localeCompare(b.iacuc, "zh-CN"));
}

function occupancyBreakdown(items) {
  const byIacuc = new Map();
  items.forEach((item) => {
    const iacuc = normalizeIacucNumber(item.iacuc);
    if (!iacuc) return;
    const current = byIacuc.get(iacuc) || { iacuc, project: item.project || "", cageCount: 0 };
    current.cageCount += 1;
    byIacuc.set(iacuc, current);
  });
  return [...byIacuc.values()].sort((a, b) => a.iacuc.localeCompare(b.iacuc, "zh-CN"));
}

function freeCageAllowanceForPi(pi) {
  return freeCageAllowanceForPrincipalType(principalTypeForPi(pi));
}

function principalTypeForPi(pi) {
  const normalizedPi = normalizePersonName(pi);
  const identity = PRINCIPAL_IDENTITY_BY_NAME.get(normalizedPi);
  if (identity?.principalType) return normalizePrincipalType(identity.principalType);
  return BILLING_PRINCIPAL_INDEPENDENT;
}

function normalizePrincipalType(value) {
  return value === BILLING_PRINCIPAL_INDEPENDENT ? BILLING_PRINCIPAL_INDEPENDENT : BILLING_PRINCIPAL_PI;
}

function freeCageAllowanceForPrincipalType(value) {
  return normalizePrincipalType(value) === BILLING_PRINCIPAL_INDEPENDENT ? FREE_CAGES_INDEPENDENT : FREE_CAGES_PI;
}

function principalTypeLabel(value) {
  return normalizePrincipalType(value) === BILLING_PRINCIPAL_INDEPENDENT ? "独立科研人员" : "PI";
}

function principalIdentityRows() {
  const byPi = new Map();
  const add = (pi, iacuc = "") => {
    const name = String(pi || "").trim();
    if (!name) return;
    const key = normalizePersonName(name);
    const current = byPi.get(key) || {
      pi: name,
      iacucs: new Set(),
      principalType: principalTypeForPi(name),
    };
    if (iacuc) current.iacucs.add(normalizeIacucNumber(iacuc));
    byPi.set(key, current);
  };
  IACUC_INDEX.forEach((item) => add(item.pi, item.iacuc));
  state.occupancies.forEach((item) => add(item.pi, item.iacuc));
  state.quantitySheets.forEach((item) => add(item.pi, item.iacuc));
  PRINCIPAL_IDENTITIES.forEach((item) => add(item.pi));
  return [...byPi.values()]
    .map((item) => ({
      pi: item.pi,
      principalType: principalTypeForPi(item.pi),
      iacucCount: [...item.iacucs].filter(Boolean).length,
    }))
    .sort((a, b) => a.pi.localeCompare(b.pi, "zh-CN"));
}

function filteredPrincipalIdentityRows(items) {
  const keyword = normalizeSearchText(state.principalIdentityFilter);
  if (!keyword) return items;
  return items.filter((item) => {
    const typeLabel = principalTypeLabel(item.principalType);
    const freeCages = String(freeCageAllowanceForPrincipalType(item.principalType));
    return normalizeSearchText(`${item.pi} ${typeLabel} ${item.principalType} ${freeCages}`).includes(keyword);
  });
}

function normalizeSearchText(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function piInfo(pi) {
  const normalizedPi = normalizePersonName(pi);
  const applications = IACUC_INDEX.filter((item) => normalizePersonName(item.pi) === normalizedPi);
  const occupancies = state.occupancies.filter((item) => normalizePersonName(item.pi) === normalizedPi);
  return {
    project: uniqueJoined([...applications.map((item) => item.project), ...occupancies.map((item) => item.project)]),
    pi,
    owner: uniqueJoined([...applications.map((item) => item.owner), ...occupancies.map((item) => item.owner)]),
    funding: uniqueJoined([...applications.map((item) => item.funding), ...occupancies.map((item) => item.funding)]),
  };
}

function uniqueJoined(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")).join("、");
}

function unitPriceFor(date) {
  const rule = state.billingRules.find((item) => {
    const afterStart = !item.effectiveStart || item.effectiveStart <= date;
    const beforeEnd = !item.effectiveEnd || item.effectiveEnd >= date;
    return item.unit === "cage_day" && afterStart && beforeEnd;
  });
  return Number(rule?.price ?? state.baseRate ?? 4.5);
}

function discountFor(iacuc, date) {
  const adjustment = state.adjustments.find((item) => {
    const inRange = (!item.effectiveStart || item.effectiveStart <= date) && (!item.effectiveEnd || item.effectiveEnd >= date);
    return item.targetType === "iacuc" && item.targetId === iacuc && item.type === "discount" && inRange;
  });
  return Number(adjustment?.value ?? 0);
}

async function exportBillingCsv() {
  const { statement } = await statementForExport().catch((error) => {
    reportSaveError(error);
    return {};
  });
  if (!statement) return;
  const isQuantitySheet = statement.sourceType === "quantity_sheet";
  const header = isQuantitySheet
    ? ["日期", "结余动物数", "合计笼数", "免费笼数", "收费笼数", "4.5元笼数", "6.5元笼数", "当日费用", "累计费用", "伦理明细"]
    : ["日期", "合计笼数", "免费笼数", "收费笼数", "4.5元笼数", "6.5元笼数", "当日费用", "累计费用", "伦理明细"];
  const rows = statement.rows.map((row) => [
    row.date,
    ...(isQuantitySheet ? [row.animalCount, row.cageCount] : [row.cageCount]),
    row.freeCages,
    row.billableCages,
    row.tier1BillableCages,
    row.tier2BillableCages,
    row.amount.toFixed(2),
    row.cumulative.toFixed(2),
    (row.iacucBreakdown || []).map((item) => `${item.iacuc}:${item.cageCount}笼`).join("；"),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${statement.pi || state.billingPi || state.billingIacuc}-${statement.month || state.billingMonth}-饲养明细.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportSettlementPdf() {
  const opened = window.open("", "_blank");
  if (!opened) {
    alert("浏览器阻止了弹出窗口，请允许弹出窗口后重试。");
    return;
  }

  const exportData = await statementForExport().catch((error) => {
    opened.close();
    reportSaveError(error);
    return null;
  });
  if (!exportData) return;

  const { statement, info } = exportData;
  const rowsWithCages = statement.rows.filter((row) => row.cageCount > 0);
  const nonZeroRows = rowsWithCages.length ? rowsWithCages : statement.rows;

  opened.document.write(settlementHtml(statement, info, nonZeroRows));
  opened.document.close();
  opened.focus();
  opened.print();
}

async function statementForExport() {
  if (state.billingSource === "quantity_sheet") {
    return quantitySheetStatementForExport();
  }
  if (!state.billingPi || !state.billingMonth) {
    throw new Error("请先选择项目负责人和结算月份");
  }
  if (!remotePersistence) {
    const statement = buildStatement(state.billingPi, state.billingMonth);
    return { statement, info: statementInfoForExport(statement) };
  }
  if (currentUser?.role !== "admin") {
    throw new Error("共享模式下只有系统管理员可以生成和导出正式结算单");
  }

  const response = await fetch(API_BILLING_STATEMENT_GENERATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pi: state.billingPi,
      month: state.billingMonth,
      status: "draft",
      replaceDraft: true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "生成结算单失败");
  }
  if (!payload.statement) {
    throw new Error("生成结算单失败：服务端未返回结算单");
  }

  mergeServerAuditLogs(payload);
  const statement = statementPayloadForExport(payload.statement, payload.lines || []);
  pushLog(`生成结算单：${statement.pi} ${statement.month}，应收 ${MONEY_FORMAT.format(statement.totalAmount)} 元`);
  render();
  return { statement, info: statementInfoForExport(statement) };
}

async function quantitySheetStatementForExport() {
  const sheet = await saveQuantitySheetDraft();
  if (!sheet.iacuc || !sheet.month) {
    throw new Error("请先填写 IACUC 编号和结算月份");
  }
  if (!remotePersistence) {
    const statement = buildQuantitySheetStatement(sheet);
    return { statement, info: statementInfoForExport(statement) };
  }

  const response = await fetch(`${API_QUANTITY_SHEETS_URL}/${encodeURIComponent(sheet.id)}/generate-statement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "draft", replaceDraft: true }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "根据数量统计表生成结算单失败");
  }
  if (!payload.statement) {
    throw new Error("生成结算单失败：服务端未返回结算单");
  }

  mergeServerAuditLogs(payload);
  const statement = statementPayloadForExport(payload.statement, payload.lines || []);
  pushLog(`根据数量统计表生成结算单：${statement.pi || statement.iacuc} ${statement.month}，应收 ${MONEY_FORMAT.format(statement.totalAmount)} 元`);
  render();
  return { statement, info: statementInfoForExport(statement) };
}

function statementPayloadForExport(statement, lines) {
  const rows = lines.map((line) => ({
    date: line.date,
    animalCount: Number(line.animalCount || 0),
    cageCount: Number(line.cageCount || 0),
    freeCages: Number(line.freeCages || 0),
    billableCages: Number(line.billableCages ?? line.billableCount ?? line.cageCount ?? 0),
    tier1BillableCages: Number(line.tier1BillableCages || 0),
    tier2BillableCages: Number(line.tier2BillableCages || 0),
    unitPrice: Number(line.unitPrice || 0),
    overageUnitPrice: Number(line.overageUnitPrice || 0),
    discountPercent: Number(line.discountPercent || 0),
    amount: Number(line.amount || 0),
    cumulative: Number(line.cumulative || 0),
    iacucBreakdown: Array.isArray(line.iacucBreakdown) ? line.iacucBreakdown : [],
  }));
  return {
    ...statement,
    unitPrice: rows.find((row) => row.unitPrice)?.unitPrice ?? unitPriceFor(`${statement.month}-01`),
    rows,
    totalCageDays: Number(statement.totalCageDays || 0),
    totalAnimalDays: Number(statement.totalAnimalDays || 0),
    totalFreeCageDays: Number(statement.totalFreeCageDays || 0),
    totalBillableCageDays: Number(statement.totalBillableCageDays || 0),
    totalTier1CageDays: Number(statement.totalTier1CageDays || 0),
    totalTier2CageDays: Number(statement.totalTier2CageDays || 0),
    totalAmount: Number(statement.totalAmount || 0),
  };
}

function statementInfoForExport(statement) {
  const indexed = findIacucInfo(statement.iacuc) || {};
  return {
    project: statement.project || indexed.project || "",
    funding: statement.funding || indexed.funding || "",
    pi: statement.pi || indexed.pi || "",
    owner: statement.owner || indexed.owner || "",
  };
}

function settlementHtml(statement, info, rows) {
  const generatedAt = statement.generatedAt
    ? formatLogTime(statement.generatedAt)
    : new Date().toLocaleString("zh-CN", { hour12: false });
  const isQuantitySheet = statement.sourceType === "quantity_sheet";
  const project = info.project || "-";
  const funding = info.funding || "-";
  const pi = info.pi || "-";
  const owner = info.owner || "-";
  const rowsHtml = rows
    .map(
      (row) =>
        isQuantitySheet
          ? `
            <tr>
              <td>${escapeText(row.date)}</td>
              <td>${row.animalCount ?? 0}</td>
              <td>${row.cageCount}</td>
              <td>${row.freeCages}</td>
              <td>${row.billableCages}</td>
              <td>${row.tier1BillableCages}</td>
              <td>${row.tier2BillableCages}</td>
              <td>${MONEY_FORMAT.format(row.amount)}</td>
            </tr>
          `
          : `
            <tr>
              <td>${escapeText(row.date)}</td>
              <td>${row.cageCount}</td>
              <td>${row.freeCages}</td>
              <td>${row.billableCages}</td>
              <td>${row.tier1BillableCages}</td>
              <td>${row.tier2BillableCages}</td>
              <td>${MONEY_FORMAT.format(row.amount)}</td>
            </tr>
          `,
    )
    .join("");
  const billableTotalLabel = "收费笼日";
  const billableTotal = statement.totalBillableCageDays ?? statement.totalCageDays;

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${escapeText(statement.pi || state.billingPi || state.billingIacuc)}-${escapeText(statement.month || state.billingMonth)}-饲养费结算单</title>
        <style>
          @page { size: A4; margin: 18mm; }
          body { color: #1f2a2e; font-family: "PingFang SC", "Microsoft YaHei", Arial, sans-serif; font-size: 12px; line-height: 1.5; }
          h1 { text-align: center; font-size: 22px; margin: 0 0 18px; }
          .meta { color: #66757c; text-align: right; margin-bottom: 10px; }
          .section { margin-top: 14px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #cfd8dc; border-bottom: 0; border-right: 0; }
          .cell { min-height: 34px; border-right: 1px solid #cfd8dc; border-bottom: 1px solid #cfd8dc; padding: 7px 9px; }
          .cell.full { grid-column: 1 / -1; }
          .label { color: #66757c; display: inline-block; min-width: 84px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { border: 1px solid #cfd8dc; padding: 7px 8px; text-align: right; }
          th:first-child, td:first-child { text-align: left; }
          th { background: #eef4f3; color: #1f2a2e; }
          .total { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; }
          .total div { border: 1px solid #cfd8dc; padding: 9px; }
          .total strong { display: block; font-size: 18px; margin-top: 4px; }
          .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 34px; }
          .sign div { border-top: 1px solid #1f2a2e; padding-top: 8px; color: #66757c; }
        </style>
      </head>
      <body>
        <h1>实验动物饲养费结算单</h1>
        <div class="meta">生成时间：${escapeText(generatedAt)}</div>
        <div class="section grid">
          <div class="cell"><span class="label">结算月份</span>${escapeText(statement.month)}</div>
          <div class="cell"><span class="label">项目负责人</span>${escapeText(statement.pi || "-")}</div>
          <div class="cell full"><span class="label">IACUC编号</span>${escapeText(statement.iacuc || "-")}</div>
          ${isQuantitySheet ? `<div class="cell"><span class="label">数据来源</span>数量统计表</div><div class="cell"><span class="label">房间/管理员</span>${escapeText(statement.roomName || "-")} / ${escapeText(statement.manager || "-")}</div>` : ""}
          <div class="cell full"><span class="label">项目名称</span>${escapeText(project)}</div>
          <div class="cell"><span class="label">项目负责人</span>${escapeText(pi)}</div>
          <div class="cell"><span class="label">实验负责人</span>${escapeText(owner)}</div>
          <div class="cell full"><span class="label">支撑经费</span>${escapeText(funding)}</div>
        </div>
        <div class="section total">
          <div><span class="label">${billableTotalLabel}</span><strong>${billableTotal}</strong></div>
          <div><span class="label">阶梯价格</span><strong>${MONEY_FORMAT.format(BILLING_TIER_BASE_PRICE)} / ${MONEY_FORMAT.format(BILLING_TIER_OVER_PRICE)} 元</strong></div>
          <div><span class="label">应收金额</span><strong>${MONEY_FORMAT.format(statement.totalAmount)} 元</strong></div>
        </div>
        <div class="section">
          <strong>饲养费明细</strong>
          <table>
            <thead>
              ${
                isQuantitySheet
                  ? `<tr><th>日期</th><th>动物数</th><th>合计笼数</th><th>免费笼数</th><th>收费笼数</th><th>4.5元笼数</th><th>6.5元笼数</th><th>当日费用</th></tr>`
                  : `<tr><th>日期</th><th>合计笼数</th><th>免费笼数</th><th>收费笼数</th><th>4.5元笼数</th><th>6.5元笼数</th><th>当日费用</th></tr>`
              }
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="sign">
          <div>项目负责人确认</div>
          <div>动物房审核</div>
          <div>财务审核</div>
        </div>
      </body>
    </html>
  `;
}

function datesInMonth(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1, 1);
  const dates = [];
  while (date.getMonth() === monthIndex - 1) {
    dates.push(formatLocalDate(date));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function getSelectedRoom() {
  const rooms = visibleRooms();
  return rooms.find((room) => room.id === state.selectedRoomId) ?? rooms[0];
}

function roomNameById(roomId) {
  return state.rooms.find((room) => room.id === roomId)?.name || roomId;
}

function visibleRooms() {
  if (!remotePersistence || !currentUser || currentUser.role === "admin") return state.rooms;
  const allowed = new Set(currentUser.roomIds || []);
  return state.rooms.filter((room) => allowed.has(room.id));
}

function getSelectedRack(racks) {
  return racks.find((rack) => rack.id === state.selectedRackId) ?? racks[0];
}

function getSelectedSlot(visibleSlots, allSlots) {
  return visibleSlots.find((slot) => slot.id === state.selectedSlotId) ?? visibleSlots[0] ?? allSlots[0];
}

function slotPositionCode(slot) {
  return `${columnLabel(Number(slot.col))}${Number(slot.row)}`;
}

function rackCode(rackOrIndex) {
  const value = typeof rackOrIndex === "object" ? rackOrIndex?.index : rackOrIndex;
  const index = Number(value);
  return Number.isFinite(index) && index > 0 ? String(index).padStart(2, "0") : String(value || "");
}

function rackDisplayName(rack, room) {
  if (!rack) return "";
  const roomName = room?.name || roomNameById(rack.roomId);
  return `${roomName} ${rackCode(rack)} 号笼架`;
}

function columnLabel(index) {
  let value = Number(index);
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label || "A";
}

function cageCodeForSlot(slotId) {
  const slot = state.slots.find((item) => item.id === slotId);
  if (!slot) return "";

  const rack = state.racks.find((item) => item.id === slot.rackId);
  const room = rack ? state.rooms.find((item) => item.id === rack.roomId) : null;
  if (!rack || !room) return slotPositionCode(slot);

  return `${room.name}-${rackCode(rack)}-${slotPositionCode(slot)}`;
}

function currentOccupancy(slotId) {
  return state.occupancies.find((item) => item.slotId === slotId && (item.status === "active" || item.status === "reserved"));
}

function emptyOccupancy(slotId) {
  return {
    slotId,
    cageCode: cageCodeForSlot(slotId),
    status: "active",
    iacuc: "",
    project: "",
    pi: "",
    owner: "",
    startDate: today,
    endDate: "",
    notes: "",
  };
}

function uniqueIacucs() {
  const values = [...state.occupancies.map((item) => item.iacuc), ...IACUC_INDEX.map((item) => item.iacuc)].filter(Boolean);
  return [...new Set(values)].sort();
}

function iacucOptions(currentValue = "") {
  const fromIndex = IACUC_INDEX.map((item) => ({
    iacuc: item.iacuc,
    project: item.project,
    pi: item.pi,
    owner: item.owner,
    funding: item.funding,
  }));
  const fromOccupancies = state.occupancies
    .filter((item) => item.iacuc)
    .map((item) => ({
      iacuc: item.iacuc,
      project: item.project,
      pi: item.pi,
      owner: item.owner,
      funding: "",
    }));
  const typedValue = String(currentValue || "").trim();
  const fromCurrentValue = typedValue ? [{ iacuc: typedValue, project: "", pi: "", owner: "", funding: "" }] : [];
  const byNumber = new Map();
  [...fromIndex, ...fromOccupancies, ...fromCurrentValue].forEach((item) => {
    const key = normalizeIacucNumber(item.iacuc);
    if (!byNumber.has(key)) byNumber.set(key, item);
  });
  return [...byNumber.values()].sort((a, b) => a.iacuc.localeCompare(b.iacuc, "zh-CN"));
}

function piOptions(currentValue = "") {
  const fromIndex = IACUC_INDEX.map((item) => ({
    pi: item.pi,
    iacuc: item.iacuc,
  }));
  const fromOccupancies = state.occupancies.map((item) => ({
    pi: item.pi,
    iacuc: item.iacuc,
  }));
  const fromSheets = state.quantitySheets.map((item) => ({
    pi: item.pi,
    iacuc: item.iacuc,
  }));
  const typedValue = String(currentValue || "").trim();
  const fromCurrentValue = typedValue ? [{ pi: typedValue, iacuc: "" }] : [];
  const byPi = new Map();
  [...fromIndex, ...fromOccupancies, ...fromSheets, ...fromCurrentValue].forEach((item) => {
    const key = normalizePersonName(item.pi);
    if (!key) return;
    const current = byPi.get(key) || { pi: item.pi, iacucs: [] };
    if (item.iacuc) current.iacucs.push(normalizeIacucNumber(item.iacuc));
    byPi.set(key, current);
  });
  return [...byPi.values()]
    .map((item) => ({ ...item, iacucs: [...new Set(item.iacucs)].sort() }))
    .sort((a, b) => a.pi.localeCompare(b.pi, "zh-CN"));
}

function findIacucInfo(value) {
  const key = normalizeIacucNumber(value);
  if (!key) return null;

  const indexed = IACUC_BY_NUMBER.get(key);
  if (indexed) return indexed;

  const occupancy = state.occupancies.find((item) => normalizeIacucNumber(item.iacuc) === key);
  if (!occupancy) return null;

  return {
    iacuc: occupancy.iacuc,
    project: occupancy.project,
    pi: occupancy.pi,
    owner: occupancy.owner,
    funding: "",
  };
}

function piForIacuc(value) {
  const info = findIacucInfo(value);
  return info?.pi || "";
}

function normalizeIacucNumber(value) {
  return String(value ?? "")
    .trim()
    .replace(/（.*?）/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizePersonName(value) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function statusLabel(status) {
  return {
    empty: "空",
    reserved: "已预约",
    active: "在用",
    ended: "已结束",
  }[status];
}

function historyStatusLabel(item) {
  if (item.status === "ended" && item.endReason === "sampled") return "已取材";
  if (item.status === "ended" && item.endReason === "cleared") return "已设空";
  return statusLabel(item.status);
}

function validateEndDate(occupancy, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    alert("日期格式需要为 YYYY-MM-DD。");
    return false;
  }
  if (occupancy.startDate && endDate < occupancy.startDate) {
    alert(`取材日期不能早于入住日期 ${occupancy.startDate}。`);
    return false;
  }
  return true;
}

function pushLog(message) {
  if (remotePersistence) return;
  state.auditLogs.unshift({
    id: crypto.randomUUID(),
    message,
    at: new Date().toISOString(),
  });
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLogTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function mergeAuditLogs(incoming, existing) {
  const seen = new Set();
  const merged = [];
  [...incoming, ...existing].forEach((item) => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  });
  return merged.slice(0, 500);
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

function escapeAttr(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function iconSvg(name) {
  const icons = {
    home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>`,
    grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>`,
    receipt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zm2 5h6v2H9zm0 4h6v2H9z"/></svg>`,
    building: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l8-3 8 3v16h-6v-5h-4v5zm3-3h2v-2H7zm0-4h2v-2H7zm0-4h2V8H7zm4 4h2v-2h-2zm0-4h2V8h-2zm4 4h2v-2h-2zm0-4h2V8h-2z"/></svg>`,
    database: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zm0 2C8.2 5 6 6 6 6s2.2 1 6 1 6-1 6-1-2.2-1-6-1zM6 9v3c.8.5 2.9 1 6 1s5.2-.5 6-1V9c-1.4.6-3.5 1-6 1s-4.6-.4-6-1zm0 6v3c.8.5 2.9 1 6 1s5.2-.5 6-1v-3c-1.4.6-3.5 1-6 1s-4.6-.4-6-1z"/></svg>`,
    users: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4zm7.5-9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 8c-.7 0-1.4.1-2 .3 1.6 1 2.5 2.6 2.5 4.7v2h4v-2c0-2.8-2-5-4.5-5z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13.5a7.9 7.9 0 0 0 .1-1.5 7.9 7.9 0 0 0-.1-1.5l2-1.5-2-3.4-2.4 1a7.7 7.7 0 0 0-2.5-1.4L14.2 3h-4.4l-.4 2.2A7.7 7.7 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5A7.9 7.9 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.4 2.4-1a7.7 7.7 0 0 0 2.5 1.4l.4 2.2h4.4l.4-2.2a7.7 7.7 0 0 0 2.5-1.4l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>`,
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5zM8 5v5h8V5zm1 11h6v3H9z"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5V20h2.5L17.8 8.7l-2.5-2.5zM19.7 6.8a1 1 0 0 0 0-1.4l-1.1-1.1a1 1 0 0 0-1.4 0l-.8.8 2.5 2.5z"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h9v2H7v12h7v2H5zm11.6 4.6L20 12l-3.4 3.4-1.4-1.4 1-1H10v-2h6.2l-1-1z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2m-8 0 1 12h8l1-12M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 16h2V7l3 3 1.4-1.4L12 3.2 6.6 8.6 8 10l3-3zM5 18h14v2H5z"/></svg>`,
    download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v9l3-3 1.4 1.4L12 16.8l-5.4-5.4L8 10l3 3zM5 18h14v2H5z"/></svg>`,
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 0 1 5.1 10.5l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3z"/></svg>`,
    chevronLeft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 6.3-1.4-1.4L6.2 12l7.1 7.1 1.4-1.4L10 13h8v-2h-8z"/></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.3 17.7 1.4 1.4 7.1-7.1-7.1-7.1-1.4 1.4L14 11H6v2h8z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`,
  };
  return icons[name] ?? "";
}

function decorateRequiredFields() {
  document.querySelectorAll(".field-required input, .field-required textarea").forEach((input) => {
    const raw = input.getAttribute("placeholder") || "";
    const hint = raw.trim();
    if (!hint) {
      input.setAttribute("placeholder", "必填");
      return;
    }
    if (!hint.startsWith("必填")) {
      input.setAttribute("placeholder", `必填 · ${hint}`);
    }
  });
}

initialize();

async function initialize() {
  await loadSystemInfo();
  await loadCurrentUser();
  if (!remotePersistence || currentUser) {
    await Promise.all([loadIacucIndex(), loadPrincipalIdentities(), loadPersistedState(), loadUsers()]);
  }
  render();
}

async function loadSystemInfo() {
  try {
    const response = await fetch(API_SYSTEM_INFO_URL, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    systemInfo = { ...systemInfo, ...payload };
  } catch {
    // Keep the bundled metadata fallback for static or offline runs.
  }
}

async function loadIacucIndex() {
  try {
    const response = await fetch(API_IACUC_INDEX_URL, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    IACUC_INDEX = payload.items || [];
    iacucIndexMeta = {
      count: payload.count,
      updatedAt: payload.updatedAt,
      source: payload.source,
    };
    IACUC_BY_NUMBER = new Map(IACUC_INDEX.map((item) => [normalizeIacucNumber(item.iacuc), item]));
  } catch {
    IACUC_INDEX = [];
    IACUC_BY_NUMBER = new Map();
    iacucIndexMeta = null;
  }
}

async function loadPrincipalIdentities() {
  if (!remotePersistence && !currentUser) {
    PRINCIPAL_IDENTITIES = [];
    PRINCIPAL_IDENTITY_BY_NAME = new Map();
    return;
  }
  try {
    const response = await fetch(API_PRINCIPAL_IDENTITIES_URL, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    PRINCIPAL_IDENTITIES = (payload.items || []).map((item) => ({
      ...item,
      principalType: normalizePrincipalType(item.principalType),
      freeCageAllowance: freeCageAllowanceForPrincipalType(item.principalType),
    }));
    PRINCIPAL_IDENTITY_BY_NAME = new Map(PRINCIPAL_IDENTITIES.map((item) => [normalizePersonName(item.pi), item]));
  } catch {
    PRINCIPAL_IDENTITIES = [];
    PRINCIPAL_IDENTITY_BY_NAME = new Map();
  }
}
