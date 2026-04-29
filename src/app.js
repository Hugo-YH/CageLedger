const STORAGE_KEY = "cageledger.v1";
const LEGACY_STORAGE_KEY = "lahcas.v1";
const API_AUTH_ME_URL = "/api/auth/me";
const API_LOGIN_URL = "/api/auth/login";
const API_LOGOUT_URL = "/api/auth/logout";
const API_USERS_URL = "/api/users";
const API_IACUC_INDEX_URL = "/api/iacuc-index";
const API_IACUC_UPLOAD_URL = "/api/iacuc-index/upload";
const API_SYSTEM_INFO_URL = "/api/system/info";
const API_SYSTEM_UPDATE_URL = "/api/system/update-check";
const ENTITY_API_URLS = {
  rooms: "/api/rooms",
  racks: "/api/racks",
  slots: "/api/cage-slots",
  occupancies: "/api/occupancies",
  billingRules: "/api/billing-rules",
  adjustments: "/api/billing-adjustments",
  auditLogs: "/api/audit-events",
};
let IACUC_INDEX = [];
let IACUC_BY_NUMBER = new Map();
let iacucIndexMeta = null;
let systemUpdateInfo = null;
let systemInfo = {
  name: "CageLedger",
  title: "CageLedger 实验动物笼位管理与计费系统",
  description: "实验动物笼位管理与计费系统",
  version: "0.2.1",
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
  billingMonth: today.slice(0, 7),
  billingIacuc: "IACUC-2026-001",
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
  adjustments: [
    {
      id: "adj-demo",
      targetType: "iacuc",
      targetId: "IACUC-2026-003",
      type: "discount",
      value: 10,
      reason: "示例：预实验减免 10%",
      effectiveStart: "2026-01-01",
      effectiveEnd: "",
    },
  ],
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
  const entityData = Object.fromEntries(entries);
  if (!entityData.rooms?.length) return bootstrapEntityState();

  const billingRules = entityData.billingRules || [];
  const firstIacuc = entityData.occupancies?.find((item) => item.iacuc)?.iacuc || "";
  const knownIacucs = new Set((entityData.occupancies || []).map((item) => normalizeIacucNumber(item.iacuc)).filter(Boolean));
  const localBillingIacuc = knownIacucs.has(normalizeIacucNumber(localState.billingIacuc)) ? localState.billingIacuc : "";

  return {
    ...structuredClone(seedData),
    activeView: localState.activeView || seedData.activeView,
    selectedRoomId: localState.selectedRoomId || "",
    selectedRackId: localState.selectedRackId || "",
    selectedSlotId: localState.selectedSlotId || "",
    billingMonth: localState.billingMonth || today.slice(0, 7),
    billingIacuc: localBillingIacuc || firstIacuc,
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

async function bootstrapEntityState() {
  const initialState = normalize(structuredClone(seedData));
  for (const room of initialState.rooms) {
    await createEntity("rooms", room);
  }
  for (const rack of initialState.racks) {
    await createEntity("racks", rack);
  }
  for (const slot of initialState.slots) {
    await createEntity("slots", slot);
  }
  for (const rule of initialState.billingRules) {
    await createEntity("billingRules", rule);
  }
  for (const adjustment of initialState.adjustments) {
    await createEntity("adjustments", adjustment);
  }
  for (const occupancy of initialState.occupancies) {
    await createEntity("occupancies", occupancy);
  }
  return initialState;
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

function normalize(data) {
  const next = { ...structuredClone(seedData), ...data };
  if (next.activeView === "settings") next.activeView = "rooms";
  next.selectedSlotIds = Array.isArray(next.selectedSlotIds) ? next.selectedSlotIds : [];
  next.batchMode = Boolean(next.batchMode);
  next.sidebarCollapsed = Boolean(next.sidebarCollapsed);
  next.samplingMode = next.samplingMode || "";

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
  const adminViews = new Set(["rooms", "data", "users"]);
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
    ["billing", "饲养费核算", "receipt"],
    ...(currentUser?.role === "admin"
      ? [
          ["rooms", "房间管理", "grid"],
          ["data", "数据管理", "database"],
          ["users", "账号管理", "users"],
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
            <input name="username" autocomplete="username" required />
          </label>
          <label>
            密码
            <input name="password" type="password" autocomplete="current-password" required />
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
      description: "按 IACUC 和月份生成笼位占用费用。",
    },
    rooms: {
      title: "房间管理",
      description: "维护饲养间、笼架和笼位基础结构。",
    },
    data: {
      title: "数据管理",
      description: "维护 IACUC 索引和外部数据源。",
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
      <button id="logoutButton" class="secondary" type="button">退出</button>
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
  return state.rooms.map((room) => {
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
  const racks = state.racks.filter((rack) => rack.roomId === selectedRoom.id);
  const selectedRack = getSelectedRack(racks);
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
              ${state.rooms.map((room) => `<option value="${room.id}" ${room.id === selectedRoom.id ? "selected" : ""}>${room.name}</option>`).join("")}
            </select>
            <select id="rackSelect">
              ${racks.map((rack) => `<option value="${rack.id}" ${rack.id === selectedRack.id ? "selected" : ""}>${escapeText(rackDisplayName(rack, selectedRoom))}</option>`).join("")}
            </select>
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
      <div class="panel detail-panel cage-editor">
        ${state.batchMode ? renderBatchSlotDetail(selectedBatchSlots) : renderSlotDetail(selectedSlot)}
      </div>
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
        <label>
          状态
          <select name="status">
            ${statusOption("empty", occupancy.status)}
            ${statusOption("reserved", occupancy.status)}
            ${statusOption("active", occupancy.status)}
          </select>
        </label>
        <label>
          笼盒编号
          <input name="cageCode" value="${escapeAttr(occupancy.cageCode)}" placeholder="如 M-A001" />
        </label>
      </div>
      <div class="compact-form-row half">
        <label>
          IACUC 编号
          <input name="iacuc" value="${escapeAttr(occupancy.iacuc)}" placeholder="IACUC-2026-001" list="iacucOptions" />
        </label>
        <label>
          项目名称
          <textarea name="project" rows="2" placeholder="项目或课题名称">${escapeText(occupancy.project)}</textarea>
        </label>
      </div>
      <div class="compact-form-row half">
        <label>
          项目负责人
          <input name="pi" value="${escapeAttr(occupancy.pi)}" placeholder="PI" />
        </label>
        <label>
          实验负责人
          <input name="owner" value="${escapeAttr(occupancy.owner)}" placeholder="实验负责人" />
        </label>
      </div>
      <div class="compact-form-row half">
        <label>
          开始日期
          <input type="date" name="startDate" value="${occupancy.startDate || today}" />
        </label>
        <label>
          结束/最后计费日期
          <input type="date" name="endDate" value="${occupancy.endDate}" />
        </label>
      </div>
      <label class="full-field">
        备注
        <textarea name="notes" rows="3" placeholder="品系、周龄、特殊饲养要求">${escapeText(occupancy.notes)}</textarea>
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
        <label>
          状态
          <select name="status">
            ${statusOption("active", draft.status)}
            ${statusOption("reserved", draft.status)}
          </select>
        </label>
      </div>
      <div class="compact-form-row half">
        <label>
          IACUC 编号
          <input name="iacuc" value="${escapeAttr(draft.iacuc)}" placeholder="输入后自动匹配项目和负责人" list="iacucOptions" />
        </label>
        <label>
          项目名称
          <textarea name="project" rows="2" placeholder="项目或课题名称">${escapeText(draft.project)}</textarea>
        </label>
      </div>
      <div class="compact-form-row half">
        <label>
          项目负责人
          <input name="pi" value="${escapeAttr(draft.pi)}" placeholder="PI" />
        </label>
        <label>
          实验负责人
          <input name="owner" value="${escapeAttr(draft.owner)}" placeholder="实验负责人" />
        </label>
      </div>
      <div class="compact-form-row half">
        <label>
          开始日期
          <input type="date" name="startDate" value="${draft.startDate}" />
        </label>
        <label>
          结束/最后计费日期
          <input type="date" name="endDate" value="${draft.endDate}" />
        </label>
      </div>
      <label class="full-field">
        备注
        <textarea name="notes" rows="3" placeholder="批量备注，笼盒编号请单笼维护">${escapeText(draft.notes)}</textarea>
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
        <input type="date" id="${mode === "batch" ? "batchSampleDate" : "sampleDate"}" value="${defaultDate || today}" />
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
  const statement = buildStatement(state.billingIacuc, state.billingMonth);
  const billingInfo = findIacucInfo(state.billingIacuc);

  return `
    <section class="billing-layout">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>月度结算单</h2>
            <p>按每天实际在养笼数计算，已预约默认不计费。</p>
          </div>
          <div class="toolbar">
            <input id="billingMonth" type="month" value="${state.billingMonth}" />
            <input id="billingIacuc" type="text" value="${escapeAttr(state.billingIacuc)}" list="billingIacucOptions" placeholder="输入 IACUC 编号" />
            <button id="exportBilling" class="secondary">${iconSvg("download")}导出饲养明细 CSV</button>
            <button id="exportSettlementPdf" class="primary">${iconSvg("download")}导出结算单 PDF</button>
          </div>
        </div>

        <datalist id="billingIacucOptions">
          ${iacucOptions(state.billingIacuc)
            .map((item) => `<option value="${escapeAttr(item.iacuc)}" label="${escapeAttr(item.project || item.pi || "")}"></option>`)
            .join("")}
        </datalist>

        <div class="statement-summary">
          ${summaryTile("IACUC", state.billingIacuc)}
          ${summaryTile("项目负责人", billingInfo?.pi || "-")}
          ${summaryTile("实验负责人", billingInfo?.owner || "-")}
          ${summaryTile("支撑经费", billingInfo?.funding || "-")}
          ${summaryTile("累计笼日", statement.totalCageDays)}
          ${summaryTile("应收金额", `¥${MONEY_FORMAT.format(statement.totalAmount)}`)}
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>在养笼数</th>
                <th>单价</th>
                <th>减免</th>
                <th>当日费用</th>
                <th>累计费用</th>
              </tr>
            </thead>
            <tbody>
              ${statement.rows.map(renderBillingRow).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head compact">
          <div>
            <h2>计费规则</h2>
            <p>当前实现基础费率，代码已按规则函数拆分。</p>
          </div>
        </div>
        ${
          currentUser?.role === "admin"
            ? `
              <form id="rateForm" class="form">
                <label>
                  基础单价 元/笼/天
                  <input type="number" min="0" step="0.01" name="baseRate" value="${state.baseRate}" />
                </label>
                <button class="primary" type="submit">${iconSvg("save")}保存规则</button>
              </form>
            `
            : `<p class="muted">当前账号只能查看计费规则，不能修改基础费率。</p>`
        }
        <div class="rule-list">
          ${state.adjustments.map(renderAdjustment).join("")}
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
      <td>¥${MONEY_FORMAT.format(row.unitPrice)}</td>
      <td>${row.discountPercent ? `${row.discountPercent}%` : "-"}</td>
      <td>¥${MONEY_FORMAT.format(row.amount)}</td>
      <td>¥${MONEY_FORMAT.format(row.cumulative)}</td>
    </tr>
  `;
}

function renderAdjustment(item) {
  return `
    <div class="rule-card">
      <strong>${item.targetId}</strong>
      <span>${item.type === "discount" ? `${item.value}% 减免` : item.value}</span>
      <p>${item.reason}</p>
    </div>
  `;
}

function renderRoomManagementView() {
  return `
    <section class="content-grid">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>饲养间与笼架</h2>
            <p>饲养间下可维护多个笼架，每个笼架可设置独立行列数。</p>
          </div>
          <button id="resetDemo" class="secondary">${iconSvg("refresh")}重置示例数据</button>
        </div>
        <div class="room-list">
          ${state.rooms.map(renderRoomCard).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head compact">
          <div>
            <h2>新增饲养间</h2>
            <p>保存后按下方规格生成初始笼架；不同规格笼架可继续单独新增。</p>
          </div>
        </div>
        <form id="roomForm" class="form">
          <label>
            饲养间名称
            <input name="name" required placeholder="如 SPF 小鼠饲养间 C" />
          </label>
          <label>
            区域
            <input name="area" placeholder="如 屏障区" />
          </label>
          <div class="form-row">
            <label>
              笼架数 Z
              <input type="number" name="rackCount" min="1" value="1" required />
            </label>
            <label>
              行数 X
              <input type="number" name="rows" min="1" value="5" required />
            </label>
          </div>
          <label>
            列数 Y
            <input type="number" name="cols" min="1" value="6" required />
          </label>
          <button class="primary" type="submit">${iconSvg("plus")}新增饲养间</button>
        </form>
        <div class="section-divider"></div>
        <div class="panel-head compact">
          <div>
            <h2>新增笼架</h2>
            <p>给已创建饲养间添加一个独立规格的笼架。</p>
          </div>
        </div>
        <form id="rackForm" class="form">
          <label>
            所属饲养间
            <select name="roomId" required>
              ${state.rooms.map((room) => `<option value="${escapeAttr(room.id)}">${escapeText(room.name)}</option>`).join("")}
            </select>
          </label>
          <div class="form-row">
            <label>
              行数 X
              <input type="number" name="rows" min="1" value="5" required />
            </label>
            <label>
              列数 Y
              <input type="number" name="cols" min="1" value="6" required />
            </label>
          </div>
          <button class="primary" type="submit">${iconSvg("plus")}新增笼架</button>
        </form>
      </div>
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
          <label>
            用户名
            <input name="username" required placeholder="如 room_a_admin" />
          </label>
          <label>
            显示姓名
            <input name="displayName" required placeholder="如 SPF A 管理员" />
          </label>
          <label>
            初始密码
            <input name="password" type="password" required />
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
        <div class="rule-card">
          <strong>IACUC 索引</strong>
          <span>${IACUC_INDEX.length} 条记录</span>
          <p>${iacucIndexMeta?.updatedAt ? `最后更新：${escapeText(formatLogTime(iacucIndexMeta.updatedAt))}` : "尚未上传索引文件。"}</p>
        </div>
        ${renderSystemUpdateCard()}
      </div>
      <div class="panel">
        ${renderIacucAdminPanel()}
      </div>
    </section>
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
      <label>
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
          <input name="username" value="${escapeAttr(user.username)}" ${isCurrent ? "disabled" : "required"} />
        </label>
        <label>
          显示姓名
          <input name="displayName" value="${escapeAttr(user.displayName)}" ${isCurrent ? "disabled" : "required"} />
        </label>
        <label>
          新密码
          <input name="password" type="password" placeholder="留空不修改" ${isCurrent ? "disabled" : ""} />
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
          <button type="button" class="icon-danger" data-delete-room="${room.id}" title="删除饲养间" aria-label="删除饲养间 ${room.name}">
            ${iconSvg("trash")}
          </button>
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
        <button type="button" class="icon-danger" data-delete-rack="${rack.id}" title="删除笼架" aria-label="删除 ${room.name} 笼架 ${rackCode(rack)}">
          ${iconSvg("trash")}
        </button>
      </div>
    </div>
  `;
}

function bindEvents() {
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
  document.querySelector("#billingMonth")?.addEventListener("change", (event) => {
    state.billingMonth = event.target.value;
    render();
  });
  document.querySelector("#billingIacuc")?.addEventListener("change", (event) => {
    updateBillingIacuc(event.target.value);
  });
  document.querySelector("#billingIacuc")?.addEventListener("input", updateIacucOptions);
  document.querySelector("#billingIacuc")?.addEventListener("blur", (event) => {
    updateBillingIacuc(event.target.value);
  });
  document.querySelector("#billingIacuc")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      updateBillingIacuc(event.target.value);
    }
  });
  document.querySelector("#exportBilling")?.addEventListener("click", exportBillingCsv);
  document.querySelector("#exportSettlementPdf")?.addEventListener("click", exportSettlementPdf);
  document.querySelector("#rateForm")?.addEventListener("submit", handleRateSubmit);
  document.querySelector("#roomForm")?.addEventListener("submit", handleRoomSubmit);
  document.querySelector("#rackForm")?.addEventListener("submit", handleRackSubmit);
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
  const racks = state.racks.filter((rack) => rack.roomId === selectedRoom.id);
  const selectedRack = getSelectedRack(racks);
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
  const baseRate = Number(form.get("baseRate")) || 0;
  const currentRule = state.billingRules[0] || {
    id: crypto.randomUUID(),
    name: "小鼠 IVC 基础饲养费",
    unit: "cage_day",
    effectiveStart: today,
    effectiveEnd: "",
  };
  const nextRule = { ...currentRule, price: baseRate };

  try {
    const response = state.billingRules.some((item) => item.id === nextRule.id)
      ? await updateEntity("billingRules", nextRule.id, nextRule)
      : await createEntity("billingRules", nextRule);
    state.baseRate = baseRate;
    upsertById(state.billingRules, response.item || nextRule);
    pushLog(`更新基础费率为 ${state.baseRate}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function updateBillingIacuc(value) {
  const trimmed = value.trim();
  const match = findIacucInfo(trimmed);
  state.billingIacuc = match?.iacuc || trimmed;
  render();
}

async function handleRoomSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const name = form.get("name").trim();
  const room = {
    id: `room-${slugify(name)}-${Date.now()}`,
    name,
    area: form.get("area").trim(),
    rackCount: Number(form.get("rackCount")),
    rows: Number(form.get("rows")),
    cols: Number(form.get("cols")),
  };

  const generated = generateInfrastructure([room]);

  try {
    const roomResponse = await createEntity("rooms", room);
    const rackResponses = [];
    for (const rack of generated.racks) {
      rackResponses.push(await createEntity("racks", rack));
    }
    const slotResponses = [];
    for (const slot of generated.slots) {
      slotResponses.push(await createEntity("slots", slot));
    }

    state.rooms.push(roomResponse.item || room);
    state.racks.push(...rackResponses.map((response, index) => response.item || generated.racks[index]));
    state.slots.push(...slotResponses.map((response, index) => response.item || generated.slots[index]));
    state.selectedRoomId = room.id;
    state.selectedRackId = generated.racks[0].id;
    state.selectedSlotId = generated.slots[0].id;
    state.activeView = "cages";
    pushLog(`新增饲养间 ${room.name}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function handleRackSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const room = state.rooms.find((item) => item.id === form.get("roomId"));
  if (!room) {
    alert("请选择有效的饲养间。");
    return;
  }

  const roomRacks = state.racks.filter((item) => item.roomId === room.id);
  const rackIndex = roomRacks.length + 1;
  const rows = Number(form.get("rows"));
  const cols = Number(form.get("cols"));
  const rackId = `rack-${room.id.replace(/^room-/, "")}-${Date.now()}`;
  const generated = generateRackInfrastructure(room, rackIndex, rows, cols, rackId);

  try {
    const rackResponse = await createEntity("racks", generated.rack);
    const slotResponses = [];
    for (const slot of generated.slots) {
      slotResponses.push(await createEntity("slots", slot));
    }

    state.racks.push(rackResponse.item || generated.rack);
    state.slots.push(...slotResponses.map((response, index) => response.item || generated.slots[index]));
    room.rackCount = roomRacks.length + 1;
    await updateEntity("rooms", room.id, room);
    state.selectedRoomId = room.id;
    state.selectedRackId = generated.rack.id;
    state.selectedSlotId = generated.slots[0]?.id;
    state.activeView = "cages";
    pushLog(`新增${room.name} 笼架 ${rackCode(rackIndex)}`);
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
  if (roomRacks.length <= 1) {
    alert("每个饲养间至少需要保留一个笼架。");
    return;
  }

  const slots = state.slots.filter((slot) => slot.rackId === rackId);
  const slotIds = new Set(slots.map((slot) => slot.id));
  const occupancyCount = state.occupancies.filter((item) => slotIds.has(item.slotId)).length;
  const rackLabel = `${room?.name ?? "饲养间"} 笼架 ${rackCode(rack)}`;
  const message = occupancyCount
    ? `确定删除 ${rackLabel}？这会删除 ${slots.length} 个笼位，${occupancyCount} 条占用记录会作为历史保留。`
    : `确定删除 ${rackLabel}？这会同时删除 ${slots.length} 个笼位。`;

  if (!confirm(message)) return;

  try {
    await deleteEntityRequest("racks", rackId);
    state.racks = state.racks.filter((item) => item.id !== rackId);
    state.slots = state.slots.filter((slot) => slot.rackId !== rackId);
    if (room) {
      renumberRoomRacks(room);
      await updateEntity("rooms", room.id, room);
      for (const item of state.racks.filter((rackItem) => rackItem.roomId === room.id)) {
        await updateEntity("racks", item.id, item);
      }
    }
    pushLog(`删除${rackLabel}`);
    selectFirstAvailableCage();
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function renumberRoomRacks(room) {
  const roomRacks = state.racks.filter((item) => item.roomId === room.id);
  roomRacks.forEach((item, index) => {
    item.index = index + 1;
    item.name = `${room.name} ${rackCode(item)} 号笼架`;
  });
  room.rackCount = roomRacks.length;
}

function selectFirstAvailableCage() {
  const room = state.rooms.find((item) => item.id === state.selectedRoomId) ?? state.rooms[0];
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

function buildStatement(iacuc, month) {
  const dates = datesInMonth(month);
  let cumulative = 0;
  const normalizedIacuc = normalizeIacucNumber(iacuc);

  const rows = dates.map((date) => {
    const activeItems = activeOccupanciesOnDate(date).filter((item) => normalizeIacucNumber(item.iacuc) === normalizedIacuc);
    const unitPrice = unitPriceFor(date);
    const discountPercent = discountFor(iacuc, date);
    const gross = activeItems.length * unitPrice;
    const amount = gross * (1 - discountPercent / 100);
    cumulative += amount;

    return {
      date,
      cageCount: activeItems.length,
      unitPrice,
      discountPercent,
      amount,
      cumulative,
    };
  });

  return {
    iacuc,
    month,
    unitPrice: unitPriceFor(`${month}-01`),
    rows,
    totalCageDays: rows.reduce((sum, row) => sum + row.cageCount, 0),
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

function exportBillingCsv() {
  const statement = buildStatement(state.billingIacuc, state.billingMonth);
  const header = ["日期", "在养笼数", "单价", "减免百分比", "当日费用", "累计费用"];
  const rows = statement.rows.map((row) => [
    row.date,
    row.cageCount,
    row.unitPrice,
    row.discountPercent,
    row.amount.toFixed(2),
    row.cumulative.toFixed(2),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.billingIacuc}-${state.billingMonth}-饲养明细.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportSettlementPdf() {
  const statement = buildStatement(state.billingIacuc, state.billingMonth);
  const info = findIacucInfo(state.billingIacuc) || {};
  const rowsWithCages = statement.rows.filter((row) => row.cageCount > 0);
  const nonZeroRows = rowsWithCages.length ? rowsWithCages : statement.rows;
  const opened = window.open("", "_blank");
  if (!opened) {
    alert("浏览器阻止了弹出窗口，请允许弹出窗口后重试。");
    return;
  }

  opened.document.write(settlementHtml(statement, info, nonZeroRows));
  opened.document.close();
  opened.focus();
  opened.print();
}

function settlementHtml(statement, info, rows) {
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const project = info.project || "-";
  const funding = info.funding || "-";
  const pi = info.pi || "-";
  const owner = info.owner || "-";
  const rowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeText(row.date)}</td>
          <td>${row.cageCount}</td>
          <td>${MONEY_FORMAT.format(row.unitPrice)}</td>
          <td>${row.discountPercent ? `${row.discountPercent}%` : "-"}</td>
          <td>${MONEY_FORMAT.format(row.amount)}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${escapeText(state.billingIacuc)}-${escapeText(state.billingMonth)}-饲养费结算单</title>
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
          <div class="cell"><span class="label">IACUC编号</span>${escapeText(statement.iacuc || "-")}</div>
          <div class="cell full"><span class="label">项目名称</span>${escapeText(project)}</div>
          <div class="cell"><span class="label">项目负责人</span>${escapeText(pi)}</div>
          <div class="cell"><span class="label">实验负责人</span>${escapeText(owner)}</div>
          <div class="cell full"><span class="label">支撑经费</span>${escapeText(funding)}</div>
        </div>
        <div class="section total">
          <div><span class="label">累计笼日</span><strong>${statement.totalCageDays}</strong></div>
          <div><span class="label">基础单价</span><strong>${MONEY_FORMAT.format(statement.unitPrice)} 元/笼/天</strong></div>
          <div><span class="label">应收金额</span><strong>${MONEY_FORMAT.format(statement.totalAmount)} 元</strong></div>
        </div>
        <div class="section">
          <strong>饲养费明细</strong>
          <table>
            <thead>
              <tr><th>日期</th><th>在养笼数</th><th>单价</th><th>减免</th><th>当日费用</th></tr>
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
  return state.rooms.find((room) => room.id === state.selectedRoomId) ?? state.rooms[0];
}

function roomNameById(roomId) {
  return state.rooms.find((room) => room.id === roomId)?.name || roomId;
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

function normalizeIacucNumber(value) {
  return String(value ?? "")
    .trim()
    .replace(/（.*?）/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
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
    database: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zm0 2C8.2 5 6 6 6 6s2.2 1 6 1 6-1 6-1-2.2-1-6-1zM6 9v3c.8.5 2.9 1 6 1s5.2-.5 6-1V9c-1.4.6-3.5 1-6 1s-4.6-.4-6-1zm0 6v3c.8.5 2.9 1 6 1s5.2-.5 6-1v-3c-1.4.6-3.5 1-6 1s-4.6-.4-6-1z"/></svg>`,
    users: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4zm7.5-9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 8c-.7 0-1.4.1-2 .3 1.6 1 2.5 2.6 2.5 4.7v2h4v-2c0-2.8-2-5-4.5-5z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13.5a7.9 7.9 0 0 0 .1-1.5 7.9 7.9 0 0 0-.1-1.5l2-1.5-2-3.4-2.4 1a7.7 7.7 0 0 0-2.5-1.4L14.2 3h-4.4l-.4 2.2A7.7 7.7 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5A7.9 7.9 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.4 2.4-1a7.7 7.7 0 0 0 2.5 1.4l.4 2.2h4.4l.4-2.2a7.7 7.7 0 0 0 2.5-1.4l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>`,
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5zM8 5v5h8V5zm1 11h6v3H9z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8l1 2h4v2H3V6h4zm1 6h2v8H9zm4 0h2v8h-2z"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 16h2V7l3 3 1.4-1.4L12 3.2 6.6 8.6 8 10l3-3zM5 18h14v2H5z"/></svg>`,
    download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v9l3-3 1.4 1.4L12 16.8l-5.4-5.4L8 10l3 3zM5 18h14v2H5z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3z"/></svg>`,
    chevronLeft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 6.3-1.4-1.4L6.2 12l7.1 7.1 1.4-1.4L10 13h8v-2h-8z"/></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.3 17.7 1.4 1.4 7.1-7.1-7.1-7.1-1.4 1.4L14 11H6v2h8z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`,
  };
  return icons[name] ?? "";
}

initialize();

async function initialize() {
  await loadSystemInfo();
  await loadCurrentUser();
  if (!remotePersistence || currentUser) {
    await Promise.all([loadIacucIndex(), loadPersistedState(), loadUsers()]);
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
