/**
 * @file public/app.js
 * @description Cursor 移动桥接前端 — WebSocket 通信 + 消息渲染
 */

// #region DOM 引用

/** @type {HTMLElement} */
const messagesEl = document.getElementById("messages");
/** @type {HTMLTextAreaElement} */
const inputText = document.getElementById("inputText");
/** @type {HTMLButtonElement} */
const btnSend = document.getElementById("btnSend");
/** @type {HTMLButtonElement} */
const btnCancel = document.getElementById("btnCancel");
/** @type {HTMLButtonElement} */
const btnNewSession = document.getElementById("btnNewSession");
/** @type {HTMLSelectElement} */
const selectMode = document.getElementById("selectMode");
/** @type {HTMLSelectElement} */
const selectModel = document.getElementById("selectModel");
/** @type {HTMLElement} */
const statusBar = document.getElementById("statusBar");
/** @type {HTMLElement} */
const workspaceLabel = document.getElementById("workspaceLabel");
/** @type {HTMLButtonElement} */
const btnPickWorkspace = document.getElementById("btnPickWorkspace");
/** @type {HTMLElement} */
const workspaceModal = document.getElementById("workspaceModal");
/** @type {HTMLElement} */
const workspaceCurrentPath = document.getElementById("workspaceCurrentPath");
/** @type {HTMLElement} */
const workspaceDirList = document.getElementById("workspaceDirList");
/** @type {HTMLButtonElement} */
const btnDirUp = document.getElementById("btnDirUp");
/** @type {HTMLButtonElement} */
const btnWorkspaceSelect = document.getElementById("btnWorkspaceSelect");
/** @type {HTMLButtonElement} */
const btnWorkspaceCancel = document.getElementById("btnWorkspaceCancel");
/** @type {HTMLElement} */
const askModal = document.getElementById("askModal");
/** @type {HTMLElement} */
const askTitle = document.getElementById("askTitle");
/** @type {HTMLElement} */
const askQuestions = document.getElementById("askQuestions");
/** @type {HTMLButtonElement} */
const btnAskSubmit = document.getElementById("btnAskSubmit");
/** @type {HTMLButtonElement} */
const btnAskSkip = document.getElementById("btnAskSkip");
/** @type {HTMLInputElement} */
const inputImage = document.getElementById("inputImage");
/** @type {HTMLButtonElement} */
const btnPickImage = document.getElementById("btnPickImage");
/** @type {HTMLElement} */
const imagePreviewBar = document.getElementById("imagePreviewBar");
/** @type {HTMLElement} */
const inputArea = document.getElementById("inputArea");
/** @type {HTMLButtonElement | null} */
const btnScrollBottom = document.getElementById("btnScrollBottom");
/** @type {HTMLElement | null} 标题栏内用户对话导航 */
const turnNavEl = document.getElementById("turnNav");
/** @type {HTMLButtonElement | null} */
const btnNavTurnUp = document.getElementById("btnNavTurnUp");
/** @type {HTMLButtonElement | null} */
const btnNavTurnDown = document.getElementById("btnNavTurnDown");
/** @type {HTMLElement} */
const fileExplorer = document.getElementById("fileExplorer");
/** @type {HTMLElement} */
const fileExplorerBackdrop = document.getElementById("fileExplorerBackdrop");
/** @type {HTMLElement} */
const fileExplorerList = document.getElementById("fileExplorerList");
/** @type {HTMLElement} */
const fileExplorerPath = document.getElementById("fileExplorerPath");
/** @type {HTMLElement} */
const fileExplorerTitle = document.getElementById("fileExplorerTitle");
/** @type {HTMLButtonElement} */
const btnFileExplorerUp = document.getElementById("btnFileExplorerUp");
/** @type {HTMLButtonElement} */
const btnToggleFileExplorer = document.getElementById("btnToggleFileExplorer");
/** @type {HTMLButtonElement} */
const btnCloseFileExplorer = document.getElementById("btnCloseFileExplorer");
/** @type {HTMLElement} */
const fileExplorerPathBar = document.getElementById("fileExplorerPathBar");
/** @type {HTMLElement} */
const filePreviewPane = document.getElementById("filePreviewPane");
/** @type {HTMLElement} */
const filePreviewTitle = document.getElementById("filePreviewTitle");
/** @type {HTMLElement} */
const filePreviewBody = document.getElementById("filePreviewBody");
/** @type {HTMLButtonElement} */
const btnFilePreviewBack = document.getElementById("btnFilePreviewBack");
/** @type {HTMLElement} */
const agentWorkStatusEl = document.getElementById("agentWorkStatus");
/** @type {HTMLElement} */
const agentElapsedText = document.getElementById("agentElapsedText");

// #endregion

// #region 状态

/** @type {WebSocket | null} */
let ws = null;

/** @type {boolean} 是否正在等待 agent 回复 */
let isBusy = false;

/** @type {boolean} Agent 执行中是否已出错（取消按钮切为确认态） */
let agentFailed = false;

/** @type {number | null} Agent 用时计时器 */
let agentTimerId = null;

/** @type {number} Agent 本轮开始时间戳（ms） */
let agentStartMs = 0;

/** @type {HTMLElement | null} 当前轮次容器（思考 / 工具 / 正文按到达顺序排列） */
let currentTurnEl = null;

/** @type {'thought' | 'message' | null} 当前正在流式写入的段类型 */
let currentStreamSegment = null;

/** @type {HTMLElement | null} 当前流式 agent 消息气泡（正文段） */
let currentAgentBubble = null;

/** @type {HTMLElement | null} 当前流式思考块 body */
let currentThoughtBody = null;

/** @type {HTMLElement | null} 当前思考块容器 */
let currentThoughtBlock = null;

/** @type {HTMLElement | null} 当前思考块 header */
let currentThoughtHeader = null;

/** @type {string} 当前轮次 thought 原始累积（用于归一化后再展示） */
let thoughtRawBuffer = "";

/** @type {string | number | null} 当前 thought 流的 ACP messageId（变化时视为新段落） */
let currentThoughtMessageId = null;

/** @typedef {{ data: ToolUpdateData, toolCallIds: Set<string>, mergedParts: ToolUpdateData[], userToggled?: boolean, parentGroup?: ToolGroupEntry | null }} ToolBlockEntry */

/** @typedef {{ block: HTMLElement, header: HTMLElement, statusEl: HTMLElement, body: HTMLElement, children: ToolBlockEntry[], userToggled?: boolean }} ToolGroupEntry */

/** @type {Map<string, ToolBlockEntry>} toolCallId -> 工具块（含合并组） */
const toolBlocksMap = new Map();

/** @type {ToolGroupEntry | null} 当前轮次内连续工具组（被正文/思考打断后重置） */
let currentToolGroup = null;

/** @type {Map<string, ToolBlockEntry>} 相同签名 -> 合并后的工具块 */
const toolSignatureMap = new Map();

/** @type {Set<string>} 已写入历史的 toolCallId，避免重复 */
const savedToolIds = new Set();

/** @typedef {{ toolCallId?: string, title?: string, kind?: string, status?: string, toolName?: string, sessionUpdate?: string, rawInput?: Record<string, unknown>, rawOutput?: { exitCode?: number, stdout?: string, stderr?: string, content?: string }, content?: unknown[], locations?: Array<{ path?: string, line?: number }> }} ToolUpdateData */

/** @type {number | null} 当前 ask_question 的 RPC id */
let pendingAskId = null;

/** localStorage 键 */
const STORAGE_KEY = "cursor-mobile-bridge-history";

/** @typedef {{ mimeType: string, data: string }} PromptImage */

/** @typedef {{ role: string, text: string, images?: PromptImage[], imageCount?: number, meta?: Record<string, unknown> }} HistoryEntry */

/** @type {string} 当前工作空间绝对路径 */
let currentWorkspacePath = "";

/** @type {string} 目录浏览器当前浏览路径（空字符串表示盘符根） */
let browseCurrentPath = "";

/** @type {string | null} 目录浏览器上一级路径 */
let browseParentPath = null;

/** 文件浏览器当前绝对路径 */
let fileExplorerCurrentPath = "";

/** 文件浏览器上一级绝对路径 */
let fileExplorerParentPath = null;

/** 宽屏下用户是否手动收起了左侧文件树 */
let fileExplorerWideCollapsed = false;

/** 宽屏断点：与 style.css @media (min-width: 768px) 一致 */
const WIDE_LAYOUT_MQ = window.matchMedia("(min-width: 768px)");

/** 文件树刷新防抖 timer */
let fileExplorerRefreshTimer = null;

/** 正在预览的文件绝对路径（用于忽略过期响应） */
let filePreviewRequestPath = null;

/** 单次最多附加图片数 */
const MAX_PENDING_IMAGES = 4;

/** 原图文件大小上限（5MB） */
const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;

/** 压缩后最长边像素 */
const MAX_IMAGE_DIMENSION = 1920;

/** @typedef {{ id: string, mimeType: string, data: string, previewUrl: string }} PendingImage */

/** @type {PendingImage[]} 待发送图片队列 */
let pendingImages = [];

/** @type {number} 客户端已确认收到的最新 seq */
let lastSeq = 0;

/** @type {number | null} 服务端 epoch（hello 重连时携带） */
let serverEpoch = null;

/** @type {number | null} 客户端心跳 timer */
let clientHeartbeatTimerId = null;

/** @type {number | null} pong 超时 timer */
let pongTimeoutId = null;

/** 客户端 JSON ping 间隔（ms） */
const CLIENT_HEARTBEAT_MS = 20_000;

/** 等待 pong 超时（ms） */
const CLIENT_PONG_TIMEOUT_MS = 10_000;

// #endregion

// #region WebSocket

/**
 * 停止客户端心跳
 */
function stopClientHeartbeat() {
  if (clientHeartbeatTimerId !== null) {
    clearInterval(clientHeartbeatTimerId);
    clientHeartbeatTimerId = null;
  }
  if (pongTimeoutId !== null) {
    clearTimeout(pongTimeoutId);
    pongTimeoutId = null;
  }
}

/**
 * 启动客户端心跳 — 定期 ping，超时无 pong 则关闭连接触发重连
 */
function startClientHeartbeat() {
  stopClientHeartbeat();
  clientHeartbeatTimerId = window.setInterval(() => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    console.log("[app] 发送 ping");
    sendWs({ type: "ping" });
    pongTimeoutId = window.setTimeout(() => {
      console.warn("[app] pong 超时，关闭重连");
      ws?.close();
    }, CLIENT_PONG_TIMEOUT_MS);
  }, CLIENT_HEARTBEAT_MS);
}

/**
 * 向服务器发送 hello — 携带 epoch/lastSeq 以获取 replay 或 sync
 */
function sendHello() {
  sendWs({ type: "hello", epoch: serverEpoch, lastSeq });
  console.log("[app] 发送 hello epoch=", serverEpoch, "lastSeq=", lastSeq);
}

/**
 * 建立 WebSocket 连接（自动重连）
 */
function connectWs() {
  stopClientHeartbeat();

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${location.host}`;

  console.log("[app] 连接 WebSocket:", url);
  setStatus("连接中...", "");

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[app] WebSocket 已连接");
    setStatus("已连接", "connected");
    sendHello();
    startClientHeartbeat();
  };

  ws.onclose = () => {
    stopClientHeartbeat();
    console.log("[app] WebSocket 断开，3s 后重连");
    setStatus("连接已断开，重连中...", "error");
    // ponytail: 暂停本地计时，重连后 sync/replay 会按服务器 turnStartedAt 恢复
    if (agentTimerId !== null) {
      clearInterval(agentTimerId);
      agentTimerId = null;
    }
    setTimeout(connectWs, 3000);
  };

  ws.onerror = (err) => {
    console.error("[app] WebSocket 错误:", err);
    setStatus("连接错误", "error");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (err) {
      console.error("[app] 解析消息失败:", err);
    }
  };
}

/**
 * 向服务器发送 JSON 消息
 * @param {Record<string, unknown>} msg
 */
function sendWs(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    console.log("[app] 发送:", msg.type);
  } else {
    console.warn("[app] WebSocket 未连接，无法发送");
  }
}

// #endregion

// #region 服务器消息处理

/**
 * 跟踪服务端 seq / epoch
 * @param {Record<string, unknown>} msg
 */
function trackSeq(msg) {
  if (typeof msg.seq === "number") {
    lastSeq = Math.max(lastSeq, msg.seq);
  }
  if (typeof msg.epoch === "number") {
    serverEpoch = msg.epoch;
  }
}

/**
 * 处理增量 replay — 只回放 seq > lastSeq 的遗漏事件
 * @param {Record<string, unknown>} msg
 */
function handleReplay(msg) {
  console.log(
    "[app] replay 收到 events=",
    Array.isArray(msg.events) ? msg.events.length : 0,
    "lastSeq=",
    lastSeq
  );

  trackSeq(msg);
  handleInit(msg);

  if (msg.workspaceSwitchInFlight) {
    setStatus("切换工作空间中...", "busy");
  }

  /** @type {Record<string, unknown>[]} */
  const events = Array.isArray(msg.events)
    ? /** @type {Record<string, unknown>[]} */ (msg.events)
    : [];

  if (events.length === 0) {
    if (msg.promptInFlight) {
      setBusy(true, typeof msg.turnStartedAt === "number" ? msg.turnStartedAt : null);
    } else if (isBusy || agentFailed) {
      setBusy(false);
    }
    if (msg.pendingAsk) {
      showAskModal(/** @type {Record<string, unknown>} */ (msg.pendingAsk));
    }
    return;
  }

  for (const event of events) {
    trackSeq(event);
    applySyncEvent(event);
  }

  const last = events[events.length - 1];
  if (msg.promptInFlight) {
    setBusy(true, typeof msg.turnStartedAt === "number" ? msg.turnStartedAt : null);
  } else if (last?.type === "error") {
    const errMsg = String(last.message ?? "未知错误");
    appendSystemMsg(`错误: ${errMsg}`);
    finalizePendingToolBlocks("failed");
    finalizeCurrentStreamSegment();
    resetTurnStreamingState();
    setAgentFailed(errMsg);
  } else if (last?.type === "cancelled") {
    setBusy(false);
  }

  if (msg.pendingAsk) {
    showAskModal(/** @type {Record<string, unknown>} */ (msg.pendingAsk));
  }

  scrollToBottom({ force: true });
  console.log("[app] replay 增量回放完成 lastSeq=", lastSeq);
}

/**
 * 处理服务器推送的消息
 * @param {Record<string, unknown>} msg
 */
function handleServerMessage(msg) {
  switch (msg.type) {
    case "replay":
      handleReplay(msg);
      return;

    case "pong":
      if (pongTimeoutId !== null) {
        clearTimeout(pongTimeoutId);
        pongTimeoutId = null;
      }
      return;

    case "init":
      handleInit(msg);
      break;

    case "sync":
      trackSeq(msg);
      handleSync(msg);
      break;

    case "user_message":
      trackSeq(msg);
      appendUserBubble(
        /** @type {string} */ (msg.text),
        Array.isArray(msg.images) ? /** @type {PromptImage[]} */ (msg.images) : []
      );
      resetTurnStreamingState();
      setBusy(true);
      break;

    case "thought":
      trackSeq(msg);
      appendThoughtChunk(
        /** @type {string} */ (msg.text),
        msg.messageId ?? null
      );
      break;

    case "message":
      trackSeq(msg);
      appendAgentChunk(/** @type {string} */ (msg.text));
      break;

    case "tool":
      trackSeq(msg);
      appendToolBlock(msg.update);
      break;

    case "plan":
      trackSeq(msg);
      appendPlanCard(msg);
      break;

    case "todos":
      trackSeq(msg);
      appendTodosCard(msg);
      break;

    case "task":
      trackSeq(msg);
      appendSystemMsg(`子任务: ${msg.description}`);
      break;

    case "done":
      trackSeq(msg);
      finishAgentReply(/** @type {string} */ (msg.stopReason));
      break;

    case "error": {
      trackSeq(msg);
      const errMsg = String(msg.message ?? "未知错误");
      if (filePreviewRequestPath && filePreviewBody) {
        filePreviewBody.innerHTML = "";
        const previewErr = document.createElement("div");
        previewErr.className = "file-preview-error";
        previewErr.textContent = errMsg;
        filePreviewBody.appendChild(previewErr);
        filePreviewRequestPath = null;
        console.warn("[app] 文件预览失败:", errMsg);
      }
      appendSystemMsg(`错误: ${errMsg}`);
      if (isBusy) {
        finalizePendingToolBlocks("failed");
        finalizeCurrentStreamSegment();
        resetTurnStreamingState();
        setAgentFailed(errMsg);
      } else {
        setStatus(errMsg, "error");
      }
      break;
    }

    case "cancelled":
      trackSeq(msg);
      appendSystemMsg("已取消");
      finalizePendingToolBlocks("cancelled");
      finalizeCurrentStreamSegment();
      resetTurnStreamingState();
      setBusy(false);
      break;

    case "mode_changed":
      if (msg.currentMode) selectMode.value = /** @type {string} */ (msg.currentMode);
      break;

    case "model_changed":
      if (msg.currentModel) selectModel.value = /** @type {string} */ (msg.currentModel);
      break;

    case "ask_question":
      trackSeq(msg);
      showAskModal(msg);
      break;

    case "dir_listing":
      renderDirListing(msg);
      break;

    case "workspace_listing":
      renderFileExplorerListing(msg);
      break;

    case "workspace_file_content":
      renderFilePreview(msg);
      break;

    case "workspace_changed":
      handleInit(msg);
      appendSystemMsg(`工作空间: ${msg.workspace ?? ""}`);
      break;

    case "workspace_switching":
      setStatus("切换工作空间中...", "busy");
      appendSystemMsg(`正在切换工作空间: ${msg.workspace ?? ""}`);
      break;

    case "system":
      appendSystemMsg(String(msg.message ?? ""));
      break;

    default:
      console.log("[app] 未处理消息类型:", msg.type);
  }
}

// #region 常用模型筛选

/** @typedef {{ modelId: string, name: string }} AcpModelOption */

/** 前端下拉仅展示这些常用模型（精确 id 或 base 前缀，顺序即下拉顺序） */
const COMMON_MODEL_KEYS = [
  "default[]",
  "composer-2.5",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "gpt-5.4",
  "gemini-3.1-pro",
];

/**
 * 判断 modelId 是否命中常用 key（避免 gpt-5.4 误匹配 gpt-5.4-mini）
 * @param {string} modelId
 * @param {string} key
 * @returns {boolean}
 */
function matchesCommonModelKey(modelId, key) {
  if (modelId === key) return true;
  if (key.includes("[") && modelId !== key) return false;
  return modelId.startsWith(`${key}[`);
}

/**
 * 从 ACP 全量模型列表筛出常用项；当前模型不在列表时仍保留一项
 * @param {AcpModelOption[]} allModels
 * @param {string} [currentModelId]
 * @returns {AcpModelOption[]}
 */
function pickCommonModels(allModels, currentModelId) {
  /** @type {AcpModelOption[]} */
  const picked = [];

  for (const key of COMMON_MODEL_KEYS) {
    const match = allModels.find((m) => matchesCommonModelKey(m.modelId, key));
    if (match && !picked.some((p) => p.modelId === match.modelId)) {
      picked.push(match);
    }
  }

  if (currentModelId && !picked.some((m) => m.modelId === currentModelId)) {
    const current = allModels.find((m) => m.modelId === currentModelId);
    if (current) {
      console.log("[app] 当前模型不在常用列表，仍保留下拉项:", currentModelId);
      picked.push(current);
    }
  }

  console.log(
    `[app] 模型筛选: 全量=${allModels.length} → 常用=${picked.length}`,
    picked.map((m) => m.modelId)
  );

  return picked;
}

// #endregion

/**
 * 处理 init 消息 — 填充模型/模式下拉
 * @param {Record<string, unknown>} msg
 */
function handleInit(msg) {
  console.log("[app] init 收到，models=", msg.models);

  if (msg.workspace) {
    currentWorkspacePath = /** @type {string} */ (msg.workspace);
    const display = msg.workspaceDisplay
      ? String(msg.workspaceDisplay)
      : formatWorkspaceDisplay(currentWorkspacePath);
    workspaceLabel.textContent = display;
    btnPickWorkspace.title = currentWorkspacePath;
    console.log("[app] 工作空间:", currentWorkspacePath);
    refreshFileExplorerListing();
  }

  if (!isBusy) {
    setStatus("已连接", "connected");
  }

  // 填充模式
  if (Array.isArray(msg.modes)) {
    fillSelect(
      selectMode,
      /** @type {Array<{id:string,name:string}>} */ (msg.modes),
      (mode) => mode.id,
      (mode) => mode.name,
      msg.currentMode ? /** @type {string} */ (msg.currentMode) : undefined
    );
  }

  // 填充模型（仅常用几项，避免下拉过长）
  if (Array.isArray(msg.models)) {
    const allModels = /** @type {AcpModelOption[]} */ (msg.models);
    const currentModelId = msg.currentModel ? String(msg.currentModel) : undefined;
    const models = pickCommonModels(allModels, currentModelId);

    fillSelect(
      selectModel,
      models,
      (model) => model.modelId,
      (model) => model.name,
      currentModelId
    );
  }
}

/**
 * 判断 user_message 是否已在 DOM / localStorage 中（重连 sync 时去重）
 * @param {Record<string, unknown>} userEvent
 * @returns {boolean}
 */
function isUserMessageAlreadyShown(userEvent) {
  const text = String(userEvent.text ?? "");

  const history = loadHistory();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      return history[i].text === text;
    }
  }

  const userBubbles = messagesEl.querySelectorAll(".msg-user");
  if (userBubbles.length === 0) return false;
  const lastBubble = userBubbles[userBubbles.length - 1];
  const textEl = lastBubble.querySelector(".msg-text");
  return (textEl?.textContent ?? "") === text;
}

/**
 * 移除未写入历史的进行中 agent-turn（sync 回放前清理残缺 DOM）
 */
function removeIncompleteTurnFromDom() {
  resetTurnStreamingState();
  removeTypingIndicator();

  const history = loadHistory();
  const lastIsUser = history.length === 0 || history[history.length - 1].role === "user";
  const turns = messagesEl.querySelectorAll(".agent-turn");
  if (turns.length > 0 && lastIsUser) {
    turns[turns.length - 1].remove();
    console.log("[app] sync 移除未完成的 agent-turn");
  }
}

/**
 * 回放单条轮次事件（sync 专用，不再递归 sync）
 * @param {Record<string, unknown>} event
 */
function applySyncEvent(event) {
  switch (event.type) {
    case "user_message":
      appendUserBubble(
        /** @type {string} */ (event.text),
        Array.isArray(event.images) ? /** @type {PromptImage[]} */ (event.images) : []
      );
      resetTurnStreamingState();
      break;

    case "thought":
      appendThoughtChunk(
        /** @type {string} */ (event.text),
        event.messageId ?? null
      );
      break;

    case "message":
      appendAgentChunk(/** @type {string} */ (event.text));
      break;

    case "tool":
      appendToolBlock(event.update);
      break;

    case "plan":
      appendPlanCard(event);
      break;

    case "todos":
      appendTodosCard(event);
      break;

    case "task":
      appendSystemMsg(`子任务: ${event.description}`);
      break;

    case "done":
      finishAgentReply(/** @type {string} */ (event.stopReason));
      break;

    case "error":
      // 终端 error 在 handleSync 末尾统一展示，此处只更新 UI 状态
      break;

    case "cancelled":
      appendSystemMsg("已取消");
      finalizePendingToolBlocks("cancelled");
      finalizeCurrentStreamSegment();
      resetTurnStreamingState();
      setBusy(false);
      break;

    case "ask_question":
      showAskModal(event);
      break;

    default:
      console.log("[app] sync 跳过未知事件:", event.type);
  }
}

/**
 * 判断 sync 中的已结束轮次是否已在 localStorage 中完整保存
 * @param {Record<string, unknown>[]} events
 * @returns {boolean}
 */
function isTurnAlreadyCompleteInClient(events) {
  if (events.length === 0) return false;
  const last = events[events.length - 1];
  if (last?.type !== "done" && last?.type !== "error" && last?.type !== "cancelled") return false;

  const first = events[0];
  if (first?.type !== "user_message") return false;

  const userText = String(first.text ?? "");
  const history = loadHistory();

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "user" || history[i].text !== userText) continue;

    for (let j = i + 1; j < history.length && history[j].role !== "user"; j++) {
      const role = history[j].role;
      if (role === "agent" || role === "thought" || role === "tool") {
        console.log("[app] sync 轮次已在历史中，跳过回放");
        return true;
      }
    }
    return false;
  }
  return false;
}

/**
 * 处理 sync 消息 — 重连后对齐 init + 当前轮次完整快照
 * @param {Record<string, unknown>} msg
 */
function handleSync(msg) {
  console.log(
    "[app] sync 收到 promptInFlight=",
    msg.promptInFlight,
    "turnEvents=",
    Array.isArray(msg.turnEvents) ? msg.turnEvents.length : 0
  );

  handleInit(msg);

  if (msg.workspaceSwitchInFlight) {
    setStatus("切换工作空间中...", "busy");
  }

  /** @type {Record<string, unknown>[]} */
  const events = Array.isArray(msg.turnEvents)
    ? /** @type {Record<string, unknown>[]} */ (msg.turnEvents)
    : [];

  if (events.length === 0) {
    if (msg.promptInFlight) {
      setBusy(true, typeof msg.turnStartedAt === "number" ? msg.turnStartedAt : null);
    } else if (isBusy || agentFailed) {
      setBusy(false);
    }
    if (msg.pendingAsk) {
      showAskModal(/** @type {Record<string, unknown>} */ (msg.pendingAsk));
    }
    return;
  }

  if (!msg.promptInFlight && isTurnAlreadyCompleteInClient(events)) {
    const last = events[events.length - 1];
    if (last?.type === "error") {
      const errMsg = String(last.message ?? "未知错误");
      if (!agentFailed) {
        appendSystemMsg(`错误: ${errMsg}`);
        finalizePendingToolBlocks("failed");
        finalizeCurrentStreamSegment();
        resetTurnStreamingState();
        setAgentFailed(errMsg);
      }
    } else {
      setBusy(false);
    }
    if (msg.pendingAsk) {
      showAskModal(/** @type {Record<string, unknown>} */ (msg.pendingAsk));
    }
    return;
  }

  removeIncompleteTurnFromDom();

  resetTurnStreamingState();

  const first = events[0];
  const skipUserBubble = first?.type === "user_message" && isUserMessageAlreadyShown(first);

  for (const event of events) {
    if (skipUserBubble && event.type === "user_message") {
      resetTurnStreamingState();
      continue;
    }
    trackSeq(event);
    applySyncEvent(event);
  }

  const last = events[events.length - 1];
  if (msg.promptInFlight) {
    setBusy(true, typeof msg.turnStartedAt === "number" ? msg.turnStartedAt : null);
  } else if (last?.type === "error") {
    const errMsg = String(last.message ?? "未知错误");
    appendSystemMsg(`错误: ${errMsg}`);
    finalizePendingToolBlocks("failed");
    finalizeCurrentStreamSegment();
    resetTurnStreamingState();
    setAgentFailed(errMsg);
  } else if (last?.type !== "cancelled" && last?.type !== "done") {
    setBusy(false);
  }

  if (msg.pendingAsk) {
    showAskModal(/** @type {Record<string, unknown>} */ (msg.pendingAsk));
  }

  scrollToBottom({ force: true });
  console.log("[app] sync 回放完成");
}

// #endregion

// #region 消息渲染

/**
 * 构建用户消息气泡 DOM
 * @param {{ text?: string, images?: PromptImage[], imageCount?: number }} opts
 * @returns {HTMLElement}
 */
function createUserBubbleEl({ text = "", images = [], imageCount }) {
  const el = document.createElement("div");
  el.className = "msg msg-user";

  if (text) {
    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    textEl.textContent = text;
    el.appendChild(textEl);
  }

  if (images.length > 0) {
    const imgsWrap = document.createElement("div");
    imgsWrap.className = "msg-images";
    for (const img of images) {
      const imgEl = document.createElement("img");
      imgEl.src = `data:${img.mimeType};base64,${img.data}`;
      imgEl.alt = "用户图片";
      imgEl.loading = "lazy";
      imgsWrap.appendChild(imgEl);
    }
    el.appendChild(imgsWrap);
  } else if (imageCount && imageCount > 0) {
    const note = document.createElement("div");
    note.className = "msg-image-note";
    note.textContent = `📷 ${imageCount} 张图片（刷新前已发送）`;
    el.appendChild(note);
  }

  return el;
}

/**
 * 构建思考块 DOM
 * @param {{ streaming?: boolean, text?: string }} [opts]
 * @returns {{ block: HTMLElement, header: HTMLElement, body: HTMLElement }}
 */
function createThoughtBlockEl({ streaming = false, text = "" } = {}) {
  const block = document.createElement("div");
  // 流式思考默认展开 — CSS 无 expanded 时 .thought-body 为 display:none
  block.className = streaming ? "thought-block expanded" : "thought-block";

  const header = document.createElement("div");
  header.className = "thought-header";
  const badgeClass = streaming ? "block-badge thinking" : "block-badge thought-done";
  const badgeText = streaming ? "进行中" : "完成";
  header.innerHTML =
    `<span class="block-icon">💭</span><span class="block-title">思考过程</span><span class="${badgeClass}">${badgeText}</span>`;
  header.addEventListener("click", () => {
    // 用户手动切换后，finalize 不再自动改折叠态
    block.dataset.userToggled = "1";
    block.classList.toggle("expanded");
    console.log("[app] 思考块手动切换 expanded=", block.classList.contains("expanded"));
  });

  const body = document.createElement("div");
  body.className = "thought-body";
  if (text) body.textContent = text;

  block.appendChild(header);
  block.appendChild(body);

  return { block, header, body };
}

/**
 * 追加用户消息气泡（可选图片）
 * @param {string} text
 * @param {PromptImage[]} [images]
 */
function appendUserBubble(text, images = []) {
  messagesEl.appendChild(createUserBubbleEl({ text, images }));
  // 用户主动发消息，强制滚底以便看到刚发送的内容
  scrollToBottom({ force: true });
  // ponytail: localStorage 不存完整 base64，避免移动端配额爆掉；刷新后仅显示图片数量提示
  saveHistory({
    role: "user",
    text,
    imageCount: images.length > 0 ? images.length : undefined,
  });
}

/**
 * 结束当前思考段：写入历史、标记完成或移除空块
 */
function finalizeThoughtSegment() {
  if (!currentThoughtBlock) {
    thoughtRawBuffer = "";
    currentThoughtMessageId = null;
    return;
  }

  const thoughtText = normalizeThoughtText(
    thoughtRawBuffer || (currentThoughtBody?.textContent ?? "")
  );
  if (hasVisibleThoughtContent(thoughtText)) {
    if (currentThoughtBody) currentThoughtBody.textContent = thoughtText;
    // 完成默认折叠；用户已手动切换则尊重其选择
    if (!currentThoughtBlock.dataset.userToggled) {
      currentThoughtBlock.classList.remove("expanded");
    }
    saveHistory({ role: "thought", text: thoughtText });
    const badge = currentThoughtHeader?.querySelector(".block-badge");
    if (badge) {
      badge.textContent = "完成";
      badge.className = "block-badge thought-done";
    }
    console.log("[app] 思考段完成 len=", thoughtText.length);
  } else {
    console.log("[app] 移除空思考段");
    currentThoughtBlock.remove();
  }

  currentThoughtBlock = null;
  currentThoughtBody = null;
  currentThoughtHeader = null;
  thoughtRawBuffer = "";
  currentThoughtMessageId = null;
}

/**
 * 结束当前正文段：写入历史或移除空气泡
 */
function finalizeMessageSegment() {
  if (!currentAgentBubble) return;

  const text = currentAgentBubble.textContent ?? "";
  if (text.trim()) {
    saveHistory({ role: "agent", text });
    console.log("[app] 正文段完成 len=", text.length);
  } else {
    console.log("[app] 移除空正文段");
    currentAgentBubble.remove();
  }
  currentAgentBubble = null;
}

/**
 * 工具或其它块插入前，结束当前流式段（思考 / 正文）
 */
function finalizeCurrentStreamSegment() {
  if (currentStreamSegment === "thought") finalizeThoughtSegment();
  else if (currentStreamSegment === "message") finalizeMessageSegment();
  else if (thoughtRawBuffer) {
    // 仅有不可见字符、尚未建块时被其它类型打断 — 丢弃累积
    console.log("[app] 丢弃未呈现的思考累积 rawLen=", thoughtRawBuffer.length);
    thoughtRawBuffer = "";
    currentThoughtMessageId = null;
  }
  currentStreamSegment = null;
}

/**
 * 结束当前连续工具组（正文/思考/新轮次插入时调用）
 */
function endCurrentToolGroup() {
  currentToolGroup = null;
}

/**
 * 创建新的思考块 DOM 并挂到当前轮次
 */
function createThoughtBlockElement() {
  const created = createThoughtBlockEl({ streaming: true });
  currentThoughtBlock = created.block;
  currentThoughtHeader = created.header;
  currentThoughtBody = created.body;
  currentTurnEl?.appendChild(currentThoughtBlock);
}

/**
 * 追加 agent 回复块（流式增量；工具/思考打断后开新正文气泡）
 * @param {string} chunk
 */
function appendAgentChunk(chunk) {
  removeTypingIndicator();
  ensureTurnContainer();

  if (currentStreamSegment !== "message") {
    finalizeCurrentStreamSegment();
    endCurrentToolGroup();
    currentStreamSegment = "message";
    currentAgentBubble = document.createElement("div");
    currentAgentBubble.className = "msg msg-agent";
    currentTurnEl?.appendChild(currentAgentBubble);
    console.log("[app] 创建正文段");
  }

  currentAgentBubble.textContent += chunk;
  scrollToBottom();
}

/**
 * 创建当前轮次容器（一次 agent 回复内的思考/工具/正文）
 * @returns {HTMLElement}
 */
function ensureTurnContainer() {
  if (isRestoringHistory) return null;
  if (!currentTurnEl) {
    currentTurnEl = document.createElement("div");
    currentTurnEl.className = "agent-turn";
    messagesEl.appendChild(currentTurnEl);
    console.log("[app] 创建轮次容器");
  }
  return currentTurnEl;
}

/**
 * 新轮次开始前清空流式状态（保留已完成的 DOM）
 */
function resetTurnStreamingState() {
  currentTurnEl = null;
  currentStreamSegment = null;
  currentAgentBubble = null;
  currentThoughtBlock = null;
  currentThoughtBody = null;
  currentThoughtHeader = null;
  thoughtRawBuffer = "";
  currentThoughtMessageId = null;
  toolBlocksMap.clear();
  toolSignatureMap.clear();
  savedToolIds.clear();
  endCurrentToolGroup();
  console.log("[app] 重置轮次流式状态");
}

/** 零宽/不可见字符（Composer 流里偶发） */
const THOUGHT_INVISIBLE_RE = /[\u200b-\u200d\ufeff\u2060\u00ad]/g;

/** 纯分隔符行：ASCII --- 与 Unicode 横线（Composer 2.5 常见） */
const THOUGHT_SEPARATOR_LINE_RE =
  /^[-_=~*#·….\s\u2500-\u2503\u2508-\u2509\u2550-\u256c\u2014\u2015─━═│┃┄┅┆┇┈┉┊┋]+$/;

/**
 * 归一化思考文本 — 去掉不可见字符与纯横线行，保留实质内容
 * @param {string} raw
 * @returns {string}
 */
function normalizeThoughtText(raw) {
  if (!raw) return "";
  // ponytail: Composer 流里偶发 \r 换行，统一成 \n 以免多行被压成一行
  const stripped = raw.replace(THOUGHT_INVISIBLE_RE, "").replace(/\r/g, "\n");
  return stripped
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !THOUGHT_SEPARATOR_LINE_RE.test(line))
    .join("\n")
    .trim();
}

/**
 * 判断思考文本是否有实质内容
 * @param {string} text
 * @returns {boolean}
 */
function hasVisibleThoughtContent(text) {
  return normalizeThoughtText(text).length > 0;
}

/**
 * 合并 thought 流式 chunk — 兼容增量 delta、前缀全量快照、按行/按 messageId 分段
 * ponytail: 复用 appendStreamTextField；互不包含的全量行用换行衔接，避免只剩最后一行
 * @param {string} prev
 * @param {string} chunk
 * @param {string | number | null} [messageId]
 * @returns {string}
 */
function mergeThoughtStreamChunk(prev, chunk, messageId = null) {
  if (!chunk) return prev;
  if (!prev) return chunk;

  // ACP：messageId 变化表示新的 thought 消息，段落间换行衔接
  if (
    messageId != null &&
    currentThoughtMessageId != null &&
    messageId !== currentThoughtMessageId
  ) {
    const sep = prev.endsWith("\n") ? "" : "\n";
    console.log("[app] thought messageId 变化", currentThoughtMessageId, "→", messageId);
    return prev + sep + chunk;
  }

  const merged = appendStreamTextField(prev, chunk);
  if (merged === undefined) return prev;
  // 前缀全量快照或 token 增量
  if (merged !== prev + chunk) return merged;

  // ponytail: 短片段 / 行内续写视为 token 增量；互不包含的长 chunk 视为新行
  if (chunk.startsWith(" ") || chunk.startsWith("\t") || chunk.length <= 4) {
    return merged;
  }
  if (!prev.endsWith("\n") && !chunk.startsWith("\n")) {
    return prev + "\n" + chunk;
  }
  return merged;
}

/**
 * 追加思考内容块（流式增量，默认展开）
 * @param {string} chunk
 * @param {string | number | null} [messageId]
 */
function appendThoughtChunk(chunk, messageId = null) {
  if (!chunk) return;

  thoughtRawBuffer = mergeThoughtStreamChunk(thoughtRawBuffer, chunk, messageId);
  if (messageId != null) currentThoughtMessageId = messageId;
  const display = normalizeThoughtText(thoughtRawBuffer);
  if (!display) {
    console.log("[app] thought 累积中（暂无可显示内容） rawLen=", thoughtRawBuffer.length);
    return;
  }

  removeTypingIndicator();

  ensureTurnContainer();

  if (currentStreamSegment !== "thought") {
    finalizeCurrentStreamSegment();
    endCurrentToolGroup();
    currentStreamSegment = "thought";
    createThoughtBlockElement();
    console.log("[app] 创建思考段 displayLen=", display.length);
  }

  if (currentThoughtBody) {
    // 展示归一化后的全文，避免 Unicode 横线占位
    currentThoughtBody.textContent = display;
  }
  scrollToBottom();
}

/**
 * 工具 kind 中文标签（无具体 toolName 时的兜底）
 * @param {string | undefined} kind
 * @returns {string}
 */
function toolKindLabel(kind) {
  const map = {
    execute: "终端",
    read: "读文件",
    write: "写文件",
    edit: "编辑",
    search: "搜索",
    list: "列表",
    delete: "删除",
    fetch: "网络",
    mcp: "MCP",
  };
  return kind ? (map[kind] ?? kind) : "工具";
}

/** 已知工具英文名（用于从 title 解析） */
const KNOWN_TOOL_NAMES = [
  "Glob",
  "Grep",
  "SemanticSearch",
  "Read",
  "Write",
  "StrReplace",
  "Edit",
  "Shell",
  "Delete",
  "ApplyPatch",
  "Task",
  "CallMcpTool",
];

/** toolName → 中文展示名（优先于 kind 泛化标签） */
const TOOL_DISPLAY_NAME_MAP = {
  Read: "读文件",
  Write: "写文件",
  "Write File": "写文件",
  StrReplace: "编辑",
  Edit: "编辑",
  "Edit File": "编辑",
  ApplyPatch: "编辑",
  Shell: "终端",
  Grep: "搜文件内容",
  Glob: "筛选文件",
  SemanticSearch: "语义搜索",
  Delete: "删除",
  Task: "子任务",
  CallMcpTool: "MCP",
};

/**
 * 解析具体工具名 — toolName / title / rawInput 启发式
 * @param {ToolUpdateData} data
 * @returns {string}
 */
function resolveToolName(data) {
  const explicit = typeof data.toolName === "string" ? data.toolName.trim() : "";
  if (explicit) return explicit;

  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (title) {
    for (const name of KNOWN_TOOL_NAMES) {
      if (title === name || title.startsWith(`${name}:`) || title.startsWith(`${name} `)) {
        return name;
      }
    }
  }

  const raw = data.rawInput;
  if (raw && typeof raw === "object") {
    if (typeof raw.glob_pattern === "string") return "Glob";
    if (typeof raw.pattern === "string") return "Grep";
    if (typeof raw.query === "string" && typeof raw.path !== "string") return "SemanticSearch";
    // ponytail: Glob 结果偶发落在 rawInput/rawOutput 的 totalFiles 字段
    if ("totalFiles" in raw && !("pattern" in raw)) return "Glob";
  }

  const out = data.rawOutput;
  if (out && typeof out === "object" && "totalFiles" in out) return "Glob";

  return "";
}

/**
 * 工具块展示名 — 具体工具中文名，避免 kind=search 一律显示「搜索」
 * @param {ToolUpdateData} data
 * @returns {string}
 */
function toolDisplayLabel(data) {
  const name = resolveToolName(data);
  if (name && TOOL_DISPLAY_NAME_MAP[name]) return TOOL_DISPLAY_NAME_MAP[name];
  if (name) return name;
  if (data.kind) return toolKindLabel(data.kind);
  return "工具";
}

/**
 * 工具块 header 显示名
 * @param {ToolUpdateData} data
 * @returns {string}
 */
function toolHeaderName(data) {
  return toolDisplayLabel(data);
}

/**
 * 工具 status 中文标签
 * @param {string | undefined} status
 * @returns {string}
 */
function toolStatusLabel(status) {
  const map = {
    pending: "等待",
    in_progress: "执行中",
    completed: "完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return status ? (map[status] ?? status) : "未知";
}

/** 工具终态 — 不应被后续非终态 update 覆盖 */
const TOOL_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * 合并工具 status — 保留终态，避免乱序 update 回退到 pending
 * @param {string | undefined} prevStatus
 * @param {string | undefined} incomingStatus
 * @returns {string | undefined}
 */
function mergeToolStatus(prevStatus, incomingStatus) {
  const prev = prevStatus ?? "pending";
  if (!incomingStatus) return prevStatus ?? "pending";
  if (TOOL_TERMINAL_STATUSES.has(prev)) return prev;
  if (TOOL_TERMINAL_STATUSES.has(incomingStatus)) return incomingStatus;
  if (prev === "in_progress" && incomingStatus === "pending") return "in_progress";
  return incomingStatus;
}

/**
 * 归一化单条工具 part 的 status — ACP 有时有 rawOutput 但缺少 completed 终态
 * @param {ToolUpdateData} part
 * @returns {string}
 */
function normalizeToolPartStatus(part) {
  const status = part.status ?? "pending";
  if (TOOL_TERMINAL_STATUSES.has(status)) return status;
  if (status !== "pending" && status !== "in_progress") return status;

  const out = part.rawOutput;
  if (out && typeof out === "object" && Object.keys(out).length > 0) {
    const exitCode = out.exitCode;
    if (typeof exitCode === "number" && exitCode !== 0) return "failed";
    return "completed";
  }
  return status;
}

console.assert(
  mergeToolStatus("completed", "in_progress") === "completed",
  "[app] mergeToolStatus 自检失败"
);
console.assert(
  normalizeToolPartStatus({ status: "in_progress", rawOutput: { exitCode: 0 } }) === "completed",
  "[app] normalizeToolPartStatus 自检失败"
);

/**
 * 合并 rawInput — 忽略空对象，避免后续 update 覆盖已有参数
 * @param {Record<string, unknown> | undefined} prev
 * @param {Record<string, unknown> | undefined} next
 * @returns {Record<string, unknown> | undefined}
 */
function mergeToolRawInput(prev, next) {
  if (!next || typeof next !== "object") return prev;
  if (Object.keys(next).length === 0) return prev;
  return { ...(prev ?? {}), ...next };
}

/**
 * 从 ACP ContentBlock / 流式 chunk 提取文本（对齐 acpClient.#extractChunkText）
 * @param {unknown} block
 * @returns {string}
 */
function extractContentBlockText(block) {
  if (block == null) return "";
  if (typeof block === "string") return block;
  if (typeof block !== "object") return "";
  const obj = /** @type {Record<string, unknown>} */ (block);

  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.delta === "string") return obj.delta;

  if (obj.type === "text" && typeof obj.text === "string") return obj.text;

  if (obj.type === "image" && typeof obj.uri === "string") {
    const mime = typeof obj.mimeType === "string" ? obj.mimeType : "image";
    return `[图片 ${mime}] ${obj.uri}`;
  }

  if (obj.type === "resource_link") {
    const name = typeof obj.name === "string" ? obj.name : obj.uri ?? "资源";
    const uri = typeof obj.uri === "string" ? obj.uri : "";
    return `[资源链接] ${name}${uri ? ` (${uri})` : ""}`;
  }

  if (obj.type === "resource" && obj.resource && typeof obj.resource === "object") {
    const res = /** @type {Record<string, unknown>} */ (obj.resource);
    const uri = typeof res.uri === "string" ? res.uri : "";
    if (typeof res.text === "string") {
      const header = uri ? `资源 ${uri}:\n` : "资源内容:\n";
      return header + res.text;
    }
    if (typeof res.blob === "string") {
      const mime = typeof res.mimeType === "string" ? res.mimeType : "binary";
      return `[二进制资源 ${mime}] ${uri} (${res.blob.length} base64 chars)`;
    }
    return `[资源] ${uri}`;
  }

  if (obj.content && typeof obj.content === "object") {
    return extractContentBlockText(obj.content);
  }

  if (Array.isArray(block)) {
    return block.map((item) => extractContentBlockText(item)).join("");
  }

  return "";
}

/**
 * 解析 rawInput 中的数字字段（支持字符串）
 * @param {Record<string, unknown>} raw
 * @param {string[]} keys
 * @returns {number | null}
 */
function parseToolNumericField(raw, keys) {
  for (const key of keys) {
    const val = raw[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (typeof val === "string" && /^\d+$/.test(val.trim())) return Number(val.trim());
  }
  return null;
}

/**
 * 从工具数据推断内容起始行号（Read offset / locations / 嵌入行号）
 * @param {ToolUpdateData} data
 * @returns {number}
 */
function getToolStartLine(data) {
  const raw = data.rawInput;
  if (raw && typeof raw === "object") {
    // ponytail: Cursor Read 的 offset 为 1-based 真实行号
    const offset = parseToolNumericField(raw, [
      "offset",
      "start_line",
      "startLine",
      "line",
      "start",
      "start_line_one_indexed",
    ]);
    if (offset != null && offset > 0) return offset;

    const endLine = parseToolNumericField(raw, ["end_line", "endLine", "end"]);
    const limit = parseToolNumericField(raw, ["limit"]);
    if (endLine != null && limit != null && limit > 0) {
      return Math.max(1, endLine - limit + 1);
    }
  }

  if (Array.isArray(data.locations)) {
    for (const loc of data.locations) {
      if (loc.line != null && loc.line > 0) return loc.line;
    }
  }

  /** @type {string[]} */
  const textSources = [];
  if (Array.isArray(data.content)) {
    for (const item of data.content) {
      const t = extractContentBlockText(item);
      if (t) textSources.push(t);
    }
  }
  const out = /** @type {Record<string, unknown> | undefined} */ (data.rawOutput);
  if (out) {
    for (const key of ["stdout", "stderr", "content"]) {
      if (typeof out[key] === "string" && out[key]) textSources.push(out[key]);
    }
  }
  for (const text of textSources) {
    const inferred = inferStartLineFromEmbeddedText(text);
    if (inferred != null) return inferred;
  }

  return 1;
}

/**
 * 从 Cursor Read 输出（880|line）推断首行真实行号
 * @param {string} text
 * @returns {number | null}
 */
function inferStartLineFromEmbeddedText(text) {
  if (!text) return null;
  for (const line of normalizeLines(text)) {
    const m = line.match(/^(\d+)\|(.*)$/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * 格式化行号范围
 * @param {number} startLine
 * @param {number} lineCount
 * @returns {string}
 */
function formatLineRange(startLine, lineCount) {
  if (lineCount <= 0) return "";
  if (lineCount === 1) return `L${startLine}`;
  return `L${startLine}-${startLine + lineCount - 1}`;
}

/**
 * 为多行文本添加行号前缀（无嵌入行号时使用 startLine）
 * @param {string} text
 * @param {number} [startLine]
 * @returns {string}
 */
function prefixLineNumbers(text, startLine = 1) {
  if (!text) return "";
  const lines = normalizeLines(text);
  const endLine = startLine + lines.length - 1;
  const width = Math.max(String(endLine).length, 3);
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width, " ")} │ ${line}`)
    .join("\n");
}

/**
 * 展示带行号文本 — 优先保留 Cursor Read 的 N|content 真实行号
 * @param {string} text
 * @param {number} [startLine]
 * @returns {string}
 */
function formatTextWithLineNumbers(text, startLine = 1) {
  if (!text) return "";
  const lines = normalizeLines(text);
  /** @type {Array<{ lineNum: number, content: string }>} */
  const rows = [];
  let nextLine = startLine;
  let embeddedHits = 0;

  for (const line of lines) {
    const m = line.match(/^(\d+)\|(.*)$/);
    if (m) {
      embeddedHits++;
      const lineNum = Number(m[1]);
      rows.push({ lineNum, content: m[2] });
      nextLine = lineNum + 1;
    } else {
      rows.push({ lineNum: nextLine, content: line });
      nextLine++;
    }
  }

  if (embeddedHits === 0) return prefixLineNumbers(text, startLine);

  const endLine = rows[rows.length - 1]?.lineNum ?? startLine;
  const width = Math.max(String(endLine).length, 3);
  return rows
    .map(({ lineNum, content }) => `${String(lineNum).padStart(width, " ")} │ ${content}`)
    .join("\n");
}

/**
 * 格式化 ToolCallContent 单项
 * @param {unknown} item
 * @param {number} [startLine]
 * @returns {string}
 */
function formatToolCallContentItem(item, startLine = 1) {
  if (!item || typeof item !== "object") return "";
  const obj = /** @type {Record<string, unknown>} */ (item);
  if (obj.type === "content") {
    const text = extractContentBlockText(obj.content);
    return text ? formatTextWithLineNumbers(text, startLine) : "";
  }
  if (obj.type === "diff") {
    const parts = [];
    if (typeof obj.path === "string") parts.push(`文件: ${obj.path}`);
    if (typeof obj.oldText === "string" && obj.oldText) {
      parts.push(`--- 原内容 ---\n${formatTextWithLineNumbers(obj.oldText, startLine)}`);
    }
    if (typeof obj.newText === "string" && obj.newText) {
      parts.push(`+++ 新内容 ---\n${formatTextWithLineNumbers(obj.newText, startLine)}`);
    }
    return parts.join("\n\n");
  }
  if (obj.type === "terminal" && typeof obj.terminalId === "string") {
    return `终端: ${obj.terminalId}`;
  }
  // ponytail: 未知类型保留原始 JSON，避免细节丢失
  const extracted = extractContentBlockText(item);
  if (extracted) return formatTextWithLineNumbers(extracted, startLine);
  return formatTextWithLineNumbers(JSON.stringify(item, null, 2), 1);
}

/**
 * 合并连续文本 content 块（流式 chunk 不应被 \n\n 拆开）
 * @param {unknown[]} items
 * @returns {unknown[]}
 */
function consolidateToolContentItems(items) {
  /** @type {unknown[]} */
  const result = [];
  let textBuffer = "";

  const flushText = () => {
    if (!textBuffer) return;
    result.push({ type: "content", content: { type: "text", text: textBuffer } });
    textBuffer = "";
  };

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = /** @type {Record<string, unknown>} */ (item);
    if (obj.type === "content") {
      const inner = obj.content;
      const isPlainText =
        inner &&
        typeof inner === "object" &&
        /** @type {Record<string, unknown>} */ (inner).type === "text";
      if (isPlainText) {
        textBuffer += extractContentBlockText(inner);
        continue;
      }
    }
    flushText();
    result.push(item);
  }
  flushText();
  return result;
}

/**
 * 格式化 rawInput — 摘要 + 完整 JSON，避免只显示 path 丢其它字段
 * @param {Record<string, unknown> | undefined} rawInput
 * @param {{ skipCodeFields?: boolean }} [opts]
 * @returns {string | null}
 */
function formatToolRawInput(rawInput, opts = {}) {
  if (!rawInput || typeof rawInput !== "object") return null;
  if (Object.keys(rawInput).length === 0) return null;

  /** @type {Record<string, unknown>} */
  let displayInput = { ...rawInput };
  if (opts.skipCodeFields) {
    delete displayInput.new_string;
    delete displayInput.old_string;
    delete displayInput.contents;
    delete displayInput.description;
    if (typeof displayInput.command === "string" && displayInput.command.includes("\n")) {
      delete displayInput.command;
    }
  } else {
    delete displayInput.description;
  }

  const summary = [];
  if (typeof rawInput.command === "string" && !opts.skipCodeFields) summary.push(`命令: ${rawInput.command}`);
  if (typeof rawInput.command === "string" && opts.skipCodeFields && !rawInput.command.includes("\n")) {
    summary.push(`命令: ${rawInput.command}`);
  }
  const pathKey = TOOL_FILE_PATH_KEYS.find((key) => typeof rawInput[key] === "string");
  if (pathKey) summary.push(`路径: ${String(rawInput[pathKey])}`);
  if (typeof rawInput.glob_pattern === "string") summary.push(`筛选: ${rawInput.glob_pattern}`);
  if (typeof rawInput.pattern === "string") summary.push(`搜索: ${rawInput.pattern}`);

  if (Object.keys(displayInput).length === 0) {
    return summary.length > 0 ? summary.join("\n") : null;
  }

  const fullJson = JSON.stringify(displayInput, null, 2);
  if (summary.length === 0) return `参数:\n${fullJson}`;
  return `${summary.join("\n")}\n\n参数:\n${fullJson}`;
}

/**
 * 流式字符串字段合并（stdout/stderr 等）
 * @param {unknown} prevVal
 * @param {unknown} nextVal
 * @returns {string | undefined}
 */
function appendStreamTextField(prevVal, nextVal) {
  if (typeof nextVal !== "string" || !nextVal) {
    return typeof prevVal === "string" ? prevVal : undefined;
  }
  if (typeof prevVal !== "string" || !prevVal) return nextVal;
  if (nextVal.startsWith(prevVal)) return nextVal;
  if (prevVal.startsWith(nextVal)) return prevVal;
  return prevVal + nextVal;
}

/**
 * 合并 rawOutput — 流式 stdout/stderr 追加，字段级合并不整包覆盖
 * @param {Record<string, unknown> | undefined} prev
 * @param {Record<string, unknown> | undefined} next
 * @returns {Record<string, unknown> | undefined}
 */
function mergeToolRawOutput(prev, next) {
  if (!next || typeof next !== "object") return prev;
  if (!prev || typeof prev !== "object") return { ...next };

  /** @type {Record<string, unknown>} */
  const merged = { ...prev, ...next };

  const stdout = appendStreamTextField(prev.stdout, next.stdout);
  if (stdout) merged.stdout = stdout;
  const stderr = appendStreamTextField(prev.stderr, next.stderr);
  if (stderr) merged.stderr = stderr;
  const content = appendStreamTextField(prev.content, next.content);
  if (content) merged.content = content;

  return merged;
}

/**
 * 格式化 rawOutput 全部字段
 * @param {Record<string, unknown> | undefined} rawOutput
 * @returns {string | null}
 */
function formatToolRawOutput(rawOutput) {
  if (!rawOutput || typeof rawOutput !== "object") return null;
  const lines = [];

  if (rawOutput.exitCode !== undefined) lines.push(`退出码: ${rawOutput.exitCode}`);

  const knownKeys = new Set(["exitCode", "_meta"]);
  for (const [key, val] of Object.entries(rawOutput)) {
    if (knownKeys.has(key) || val == null) continue;
    if (typeof val === "string" && val) {
      lines.push(`${key}:\n${formatTextWithLineNumbers(val, 1)}`);
    } else if (typeof val === "number" || typeof val === "boolean") {
      lines.push(`${key}: ${val}`);
    } else {
      lines.push(`${key}:\n${JSON.stringify(val, null, 2)}`);
    }
  }

  return lines.length > 0 ? lines.join("\n\n") : null;
}

/**
 * 合并工具 update（按 ACP 语义保留/追加 content）
 * @param {ToolUpdateData} prev
 * @param {ToolUpdateData} incoming
 * @returns {ToolUpdateData}
 */
function mergeToolUpdate(prev, incoming) {
  /** @type {ToolUpdateData} */
  const merged = {
    ...prev,
    ...incoming,
    toolCallId: prev.toolCallId ?? incoming.toolCallId,
    status: mergeToolStatus(prev.status, incoming.status),
    rawInput: mergeToolRawInput(prev.rawInput, incoming.rawInput),
    rawOutput: mergeToolRawOutput(
      /** @type {Record<string, unknown> | undefined} */ (prev.rawOutput),
      /** @type {Record<string, unknown> | undefined} */ (incoming.rawOutput)
    ),
  };

  if (incoming.sessionUpdate === "tool_call_content_chunk" && incoming.content) {
    const chunk = Array.isArray(incoming.content) ? incoming.content : [incoming.content];
    merged.content = [...(prev.content ?? []), ...chunk];
  } else if ("content" in incoming) {
    if (Array.isArray(incoming.content)) {
      merged.content = incoming.content;
    } else if (incoming.content != null) {
      merged.content = [...(prev.content ?? []), incoming.content];
    } else {
      merged.content = undefined;
    }
  } else {
    merged.content = prev.content;
  }

  if (Array.isArray(incoming.locations)) {
    merged.locations = incoming.locations;
  } else {
    merged.locations = prev.locations;
  }

  return merged;
}

/**
 * 稳定序列化对象键（用于相同工具调用签名）
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value == null) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * 计算工具调用合并签名（toolName + title + rawInput）
 * @param {ToolUpdateData} data
 * @returns {string}
 */
function computeToolSignature(data) {
  const name = data.toolName ?? "";
  const title = data.title ?? "";
  const input =
    data.rawInput && typeof data.rawInput === "object" && Object.keys(data.rawInput).length > 0
      ? stableStringify(data.rawInput)
      : "";
  return `${name}|${title}|${input}`;
}

/**
 * 合并组内聚合 status（任一执行中则执行中，否则取最差终态）
 * @param {ToolUpdateData[]} parts
 * @returns {string}
 */
function aggregateToolStatus(parts) {
  const statuses = parts.map((p) => normalizeToolPartStatus(p));
  if (statuses.some((s) => s === "in_progress")) return "in_progress";
  if (statuses.some((s) => s === "pending")) return "pending";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "cancelled")) return "cancelled";
  return "completed";
}

/**
 * 统计文本行数
 * @param {string} text
 * @returns {number}
 */
function countTextLines(text) {
  return normalizeLines(text).length;
}

/**
 * 估算 diff 影响行数（新增/删除/变更）
 * @param {string} oldText
 * @param {string} newText
 * @returns {number}
 */
function countDiffAffectedLines(oldText, newText) {
  const oldLines = oldText ? normalizeLines(oldText) : [];
  const newLines = newText ? normalizeLines(newText) : [];
  if (oldLines.length === 0 && newLines.length === 0) return 0;
  if (oldLines.length === 0) return newLines.length;
  if (newLines.length === 0) return oldLines.length;

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  let affected = 0;
  for (const line of newLines) {
    if (!oldSet.has(line)) affected++;
  }
  for (const line of oldLines) {
    if (!newSet.has(line)) affected++;
  }
  return affected > 0 ? affected : Math.max(oldLines.length, newLines.length);
}

/**
 * 缩短路径用于摘要展示
 * @param {string} path
 * @returns {string}
 */
function shortenToolPath(path) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

/** rawInput / title / locations 中可能出现的文件路径字段 */
const TOOL_FILE_PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "file",
  "filename",
  "file_name",
  "uri",
];

/** 无具体文件信息的泛化标题 */
const GENERIC_TOOL_TITLES = new Set([
  "Read File",
  "Write File",
  "Edit File",
  "Read",
  "Write",
  "Grep",
  "Glob",
  "工具调用",
  "MCP: tool",
]);

/**
 * 工具调用简短意图 — 优先 Agent 填写的 description，否则 title / 路径 / 命令摘要
 * @param {ToolUpdateData} data
 * @returns {string}
 */
function toolCallIntent(data) {
  const raw = data.rawInput;
  if (raw && typeof raw === "object") {
    const desc = raw.description;
    if (typeof desc === "string" && desc.trim()) return desc.trim();
  }

  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (title && !GENERIC_TOOL_TITLES.has(title)) return title;

  if (raw && typeof raw === "object") {
    const pathKey = TOOL_FILE_PATH_KEYS.find((key) => typeof raw[key] === "string");
    if (pathKey) return shortenToolPath(String(raw[pathKey]));
    if (typeof raw.command === "string" && raw.command.trim()) {
      const cmd = raw.command.trim().replace(/\s+/g, " ");
      return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
    }
    if (typeof raw.pattern === "string" && raw.pattern.trim()) return raw.pattern.trim();
  }

  return "";
}

/**
 * 从 file:// URI 提取路径
 * @param {string} uri
 * @returns {string}
 */
function extractPathFromFileUri(uri) {
  if (!uri) return "";
  if (!uri.startsWith("file:")) return uri;
  try {
    return decodeURIComponent(uri.replace(/^file:\/\/\/?/i, ""));
  } catch {
    return uri.replace(/^file:\/\/\/?/i, "");
  }
}

/**
 * 从 title 解析文件路径（如 Read: app.js、Read app.js）
 * @param {string | undefined} title
 * @param {string | undefined} toolName
 * @returns {string}
 */
function parseToolPathFromTitle(title, toolName) {
  if (!title || GENERIC_TOOL_TITLES.has(title)) return "";

  const colonIdx = title.indexOf(":");
  if (colonIdx > 0) {
    const rest = title.slice(colonIdx + 1).trim();
    if (rest) return rest;
  }

  const name = toolName ?? "";
  if (name && title.startsWith(name)) {
    const rest = title.slice(name.length).trim();
    if (rest) return rest;
  }

  if (title.includes("/") || title.includes("\\") || title.includes(".")) return title;
  return "";
}

/**
 * 从工具 update 各字段提取文件路径
 * @param {ToolUpdateData} data
 * @returns {string}
 */
function extractToolFilePath(data) {
  const raw = data.rawInput;
  if (raw && typeof raw === "object") {
    for (const key of TOOL_FILE_PATH_KEYS) {
      const val = raw[key];
      if (typeof val === "string" && val.trim()) {
        return key === "uri" || val.startsWith("file:") ? extractPathFromFileUri(val) : val;
      }
    }
  }

  if (Array.isArray(data.locations)) {
    for (const loc of data.locations) {
      if (typeof loc.path === "string" && loc.path) return loc.path;
    }
  }

  if (Array.isArray(data.content)) {
    for (const item of data.content) {
      if (!item || typeof item !== "object") continue;
      const obj = /** @type {Record<string, unknown>} */ (item);
      if (obj.type === "diff" && typeof obj.path === "string" && obj.path) return obj.path;
      if (obj.type === "content" && obj.content && typeof obj.content === "object") {
        const c = /** @type {Record<string, unknown>} */ (obj.content);
        if (c.type === "resource" && c.resource && typeof c.resource === "object") {
          const res = /** @type {Record<string, unknown>} */ (c.resource);
          if (typeof res.uri === "string" && res.uri) return extractPathFromFileUri(res.uri);
        }
      }
    }
  }

  return parseToolPathFromTitle(data.title, resolveToolName(data) || data.toolName);
}

/**
 * 从工具条目中选取路径信息最完整的一条（优先最新 data）
 * @param {ToolBlockEntry} entry
 * @returns {ToolUpdateData}
 */
function pickBestToolPartForSummary(entry) {
  const candidates = [entry.data, ...entry.mergedParts];
  for (const part of candidates) {
    if (extractToolFilePath(part)) return part;
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const part = candidates[i];
    if (toolCallIntent(part)) return part;
  }
  return entry.data;
}

/**
 * 工具路径展示 — 优先相对工作空间前缀
 * @param {string} path
 * @returns {string}
 */
function formatToolPathForDisplay(path) {
  if (!path) return "";
  const norm = path.replace(/\\/g, "/");
  const ws = currentWorkspacePath.replace(/\\/g, "/").replace(/\/$/, "");
  if (ws && (norm === ws || norm.startsWith(`${ws}/`))) {
    const rel = norm === ws ? "" : norm.slice(ws.length + 1);
    return rel || "/";
  }
  return norm;
}

/**
 * 从单条工具 update 提取行数/范围摘要
 * @param {ToolUpdateData} part
 * @returns {string}
 */
function summarizeToolLineInfo(part) {
  const diffBlocks = collectToolDiffBlocks(part);
  if (diffBlocks.length > 0) {
    let totalAffected = 0;
    let startLine = diffBlocks[0].startLine;
    for (const block of diffBlocks) {
      totalAffected += countDiffAffectedLines(block.oldText, block.newText);
      if (block.startLine < startLine) startLine = block.startLine;
    }
    if (totalAffected > 0) return formatLineRange(startLine, totalAffected);
  }

  const raw = part.rawInput;
  if (raw && typeof raw === "object") {
    const limit = parseToolNumericField(raw, ["limit"]);
    const startLine = getToolStartLine(part);
    if (limit != null && limit > 0) return formatLineRange(startLine, limit);
  }

  if (Array.isArray(part.locations)) {
    for (const loc of part.locations) {
      if (loc.line != null && loc.line > 0) return `L${loc.line}`;
    }
  }

  const out = /** @type {Record<string, unknown> | undefined} */ (part.rawOutput);
  if (out && typeof out.content === "string" && out.content) {
    const lines = normalizeLines(out.content);
    if (lines.length > 0) return formatLineRange(getToolStartLine(part), lines.length);
  }

  return "";
}

/**
 * 单条工具调用紧凑摘要（组内列表行）
 * @param {ToolUpdateData} part
 * @returns {string}
 */
function summarizeToolPart(part) {
  const label = toolDisplayLabel(part);
  const filePath = extractToolFilePath(part);
  const displayPath = filePath ? formatToolPathForDisplay(filePath) : "";

  if (displayPath) {
    /** @type {string[]} */
    const segments = [label, displayPath];
    const lineInfo = summarizeToolLineInfo(part);
    if (lineInfo) segments.push(lineInfo);
    return segments.join(" · ");
  }

  const intent = toolCallIntent(part);
  if (intent && intent !== label) return `${label} · ${intent}`;
  return label;
}

/**
 * @typedef {{ path?: string, oldText: string, newText: string, startLine: number }} ToolDiffBlock
 */

/**
 * 从工具 update 提取可高亮展示的 diff 块（优先 ACP content.diff，其次 rawInput）
 * @param {ToolUpdateData} data
 * @returns {ToolDiffBlock[]}
 */
function collectToolDiffBlocks(data) {
  /** @type {ToolDiffBlock[]} */
  const blocks = [];
  const defaultStartLine = getToolStartLine(data);
  const defaultPath = extractToolFilePath(data) || undefined;

  if (Array.isArray(data.content)) {
    const consolidated = consolidateToolContentItems(data.content);
    for (const item of consolidated) {
      if (!item || typeof item !== "object") continue;
      const obj = /** @type {Record<string, unknown>} */ (item);
      if (obj.type !== "diff") continue;
      const oldText = typeof obj.oldText === "string" ? obj.oldText : "";
      const newText = typeof obj.newText === "string" ? obj.newText : "";
      if (!oldText && !newText) continue;
      blocks.push({
        path: typeof obj.path === "string" && obj.path ? obj.path : defaultPath,
        oldText,
        newText,
        startLine: defaultStartLine,
      });
    }
  }

  if (blocks.length > 0) return blocks;

  const raw = data.rawInput;
  if (!raw || typeof raw !== "object") return blocks;

  const oldText = typeof raw.old_string === "string" ? raw.old_string : "";
  const newText = typeof raw.new_string === "string" ? raw.new_string : "";
  if (oldText || newText) {
    blocks.push({ path: defaultPath, oldText, newText, startLine: defaultStartLine });
    return blocks;
  }

  if (typeof raw.contents === "string" && raw.contents) {
    blocks.push({ path: defaultPath, oldText: "", newText: raw.contents, startLine: 1 });
  }

  return blocks;
}

/**
 * 构建 diff 行（删除红 / 新增绿，类似 Cursor 工具块）
 * @param {string} oldText
 * @param {string} newText
 * @param {number} [startLine]
 * @returns {Array<{ kind: "del" | "add", lineNum: number, text: string }>}
 */
function buildDiffDisplayRows(oldText, newText, startLine = 1) {
  const oldLines = oldText ? normalizeLines(oldText) : [];
  const newLines = newText ? normalizeLines(newText) : [];
  /** @type {Array<{ kind: "del" | "add", lineNum: number, text: string }>} */
  const rows = [];
  for (let i = 0; i < oldLines.length; i++) {
    rows.push({ kind: "del", lineNum: startLine + i, text: oldLines[i] });
  }
  for (let i = 0; i < newLines.length; i++) {
    rows.push({ kind: "add", lineNum: startLine + i, text: newLines[i] });
  }
  return rows;
}

/**
 * 将 diff 行渲染为 HTML（红删绿增）
 * @param {string} oldText
 * @param {string} newText
 * @param {number} [startLine]
 * @returns {string}
 */
function renderToolDiffHtml(oldText, newText, startLine = 1) {
  const rows = buildDiffDisplayRows(oldText, newText, startLine);
  if (rows.length === 0) return "";

  const maxLine = rows.reduce((max, row) => Math.max(max, row.lineNum), startLine);
  const gutterWidth = Math.max(String(maxLine).length, 3);

  const lineHtml = rows
    .map((row) => {
      const gutter = String(row.lineNum).padStart(gutterWidth, " ");
      const sign = row.kind === "del" ? "−" : "+";
      const kindClass = row.kind === "del" ? "tool-diff-line-del" : "tool-diff-line-add";
      return (
        `<div class="tool-diff-line ${kindClass}">` +
        `<span class="tool-diff-gutter">${escapeHtml(gutter)}</span>` +
        `<span class="tool-diff-sign">${sign}</span>` +
        `<span class="tool-diff-code">${escapeHtml(row.text)}</span>` +
        `</div>`
      );
    })
    .join("");

  return `<div class="tool-diff">${lineHtml}</div>`;
}

/**
 * 追加工具位置行
 * @param {string[]} lines
 * @param {ToolUpdateData} data
 */
function appendToolLocationLines(lines, data) {
  if (Array.isArray(data.locations) && data.locations.length > 0) {
    const locText = data.locations
      .map((loc) => {
        const p = loc.path ?? "";
        return loc.line != null ? `${p}:${loc.line}` : p;
      })
      .filter(Boolean)
      .join("\n");
    if (locText) lines.push(`位置:\n${locText}`);
  }
}

/**
 * 构建工具块公共元信息行（file/tool/kind/input + 可选中间段 + locations/output/title）
 * @param {ToolUpdateData} data
 * @param {{ beforeLocations?: (lines: string[], data: ToolUpdateData) => void, afterLocations?: (lines: string[], data: ToolUpdateData) => void }} [hooks]
 * @returns {string[]}
 */
function buildToolMetaLines(data, hooks = {}) {
  const filePath = extractToolFilePath(data);
  /** @type {string[]} */
  const lines = [];

  if (filePath) lines.push(`文件: ${filePath}`);
  lines.push(`工具: ${toolDisplayLabel(data)}`);

  const inputText = formatToolRawInput(data.rawInput, { skipCodeFields: true });
  if (inputText) lines.push(inputText);

  if (hooks.beforeLocations) hooks.beforeLocations(lines, data);
  appendToolLocationLines(lines, data);
  if (hooks.afterLocations) hooks.afterLocations(lines, data);

  const outputText = formatToolRawOutput(
    /** @type {Record<string, unknown> | undefined} */ (data.rawOutput)
  );
  if (outputText) lines.push(outputText);

  if (lines.length === 0 && data.title) {
    lines.push(`说明: ${data.title}`);
  }

  return lines;
}

/**
 * 工具块元信息（不含 diff 代码正文）
 * @param {ToolUpdateData} data
 * @returns {string}
 */
function formatToolBodyMeta(data) {
  const startLine = getToolStartLine(data);
  const lines = buildToolMetaLines(data, {
    beforeLocations: (lines, toolData) => {
      const raw = toolData.rawInput;
      if (raw && typeof raw === "object") {
        if (typeof raw.command === "string" && raw.command.includes("\n")) {
          lines.push(`命令:\n${formatTextWithLineNumbers(raw.command, 1)}`);
        }
      }
    },
    afterLocations: (lines, toolData) => {
      if (!Array.isArray(toolData.content) || toolData.content.length === 0) return;
      const consolidated = consolidateToolContentItems(toolData.content);
      const nonDiffText = consolidated
        .filter((item) => {
          if (!item || typeof item !== "object") return false;
          return /** @type {Record<string, unknown>} */ (item).type !== "diff";
        })
        .map((item) => formatToolCallContentItem(item, startLine))
        .filter(Boolean)
        .join("\n\n");
      if (nonDiffText) lines.push(`内容:\n${nonDiffText}`);
    },
  });
  return lines.join("\n\n");
}

/**
 * 渲染工具详情 HTML（含 Cursor 风格 diff 高亮）
 * @param {ToolUpdateData} data
 * @param {ToolUpdateData[]} [mergedParts]
 * @returns {string | null} 无 diff 时返回 null，回退纯文本
 */
function renderToolBodyHtml(data, mergedParts = []) {
  if (mergedParts.length > 1) {
    const sections = mergedParts.map((part, idx) => {
      const partHtml = renderToolBodyHtml(part) ?? `<pre class="tool-body-plain">${escapeHtml(formatToolBody(part))}</pre>`;
      const label = part.toolCallId ? `#${idx + 1} (${part.toolCallId})` : `#${idx + 1}`;
      return `<div class="tool-body-merged-part"><div class="tool-body-merged-label">相同调用 ${escapeHtml(label)}</div>${partHtml}</div>`;
    });
    return sections.join("");
  }

  const primary = mergedParts.length === 1 ? mergedParts[0] : data;
  const diffBlocks = collectToolDiffBlocks(primary);
  if (diffBlocks.length === 0) return null;

  /** @type {string[]} */
  const htmlParts = [];
  const meta = formatToolBodyMeta(primary);
  if (meta) {
    htmlParts.push(`<pre class="tool-body-meta">${escapeHtml(meta)}</pre>`);
  }

  for (const block of diffBlocks) {
    if (block.path) {
      htmlParts.push(`<div class="tool-diff-path">${escapeHtml(block.path)}</div>`);
    }
    htmlParts.push(renderToolDiffHtml(block.oldText, block.newText, block.startLine));
  }

  return htmlParts.join("");
}

/**
 * 格式化工具详情文本
 * @param {ToolUpdateData} data
 * @param {ToolUpdateData[]} [mergedParts]
 * @returns {string}
 */
function formatToolBody(data, mergedParts = []) {
  if (mergedParts.length > 1) {
    const sections = mergedParts.map((part, idx) => {
      const partBody = formatToolBody(part);
      const label = part.toolCallId ? `#${idx + 1} (${part.toolCallId})` : `#${idx + 1}`;
      return `--- 相同调用 ${label} ---\n${partBody}`;
    });
    return sections.join("\n\n");
  }

  const primary = mergedParts.length === 1 ? mergedParts[0] : data;
  const startLine = getToolStartLine(primary);
  const hasContentDiff =
    Array.isArray(primary.content) &&
    primary.content.some(
      (item) => item && typeof item === "object" && /** @type {Record<string, unknown>} */ (item).type === "diff"
    );

  const lines = buildToolMetaLines(primary, {
    beforeLocations: (lines, toolData) => {
      const raw = toolData.rawInput;
      if (raw && typeof raw === "object" && !hasContentDiff) {
        const oldStr = typeof raw.old_string === "string" ? raw.old_string : "";
        const newStr = typeof raw.new_string === "string" ? raw.new_string : "";
        if (newStr) {
          if (oldStr) {
            lines.push(`--- 删除 ---\n${formatTextWithLineNumbers(oldStr, startLine)}`);
            lines.push(`+++ 新增 ---\n${formatTextWithLineNumbers(newStr, startLine)}`);
          } else {
            lines.push(`变更内容:\n${formatTextWithLineNumbers(newStr, startLine)}`);
          }
        } else if (oldStr) {
          lines.push(`原内容:\n${formatTextWithLineNumbers(oldStr, startLine)}`);
        }
        if (typeof raw.command === "string" && raw.command.includes("\n")) {
          lines.push(`命令:\n${formatTextWithLineNumbers(raw.command, 1)}`);
        }
      }
    },
    afterLocations: (lines, toolData) => {
      if (!Array.isArray(toolData.content) || toolData.content.length === 0) return;
      const consolidated = consolidateToolContentItems(toolData.content);
      const contentText = consolidated
        .map((item) => formatToolCallContentItem(item, startLine))
        .filter(Boolean)
        .join("\n\n");
      if (contentText) lines.push(`内容:\n${contentText}`);
    },
  });

  if (lines.length === 0) {
    return JSON.stringify(primary, null, 2);
  }

  return lines.join("\n\n");
}

/**
 * 收集工具组内全部 part（含同签名 mergedParts）
 * @param {ToolGroupEntry} group
 * @returns {ToolUpdateData[]}
 */
function collectToolGroupParts(group) {
  /** @type {ToolUpdateData[]} */
  const parts = [];
  for (const child of group.children) {
    if (child.mergedParts.length > 0) parts.push(...child.mergedParts);
    else parts.push(child.data);
  }
  return parts;
}

/**
 * 更新连续工具组 UI（紧凑列表，无 diff 正文）
 * @param {ToolGroupEntry} group
 */
function renderToolGroup(group) {
  const { block, header, statusEl, body, children } = group;
  const count = children.length;

  const titleEl = header.querySelector(".block-title");
  if (titleEl) titleEl.textContent = `工具调用 (${count})`;

  const intentEl = header.querySelector(".tool-intent");
  const inProgress = children.filter((child) => {
    const parts = child.mergedParts.length > 0 ? child.mergedParts : [child.data];
    const status = aggregateToolStatus(parts);
    return status === "pending" || status === "in_progress";
  }).length;
  if (intentEl) {
    if (inProgress > 0) {
      intentEl.textContent = `${inProgress} 个执行中`;
      intentEl.hidden = false;
    } else {
      intentEl.textContent = "";
      intentEl.hidden = true;
    }
  }

  const allParts = collectToolGroupParts(group);
  const status = aggregateToolStatus(allParts);
  statusEl.textContent = toolStatusLabel(status);
  statusEl.className = `block-badge tool-status-${status}`;

  const rows = children
    .map((child) => {
      const primary = pickBestToolPartForSummary(child);
      let summary = summarizeToolPart(primary);
      if (child.mergedParts.length > 1) summary += ` ×${child.mergedParts.length}`;
      return `<li class="tool-group-row">${escapeHtml(summary)}</li>`;
    })
    .join("");
  body.innerHTML = `<ul class="tool-group-list">${rows}</ul>`;

  if (!group.userToggled) {
    block.classList.toggle("expanded", status === "pending" || status === "in_progress");
  }
}

/**
 * 创建连续工具组 DOM 容器
 * @param {ToolBlockEntry} firstChild
 * @returns {ToolGroupEntry}
 */
function createToolGroupEntry(firstChild) {
  const block = document.createElement("div");
  block.className = "tool-group";

  const header = document.createElement("div");
  header.className = "tool-header tool-group-header";
  header.innerHTML =
    `<span class="block-icon">🔧</span>` +
    `<div class="tool-header-text">` +
    `<span class="block-title">工具调用 (1)</span>` +
    `<span class="tool-intent" hidden></span>` +
    `</div>` +
    `<span class="block-badge tool-status-pending">等待</span>`;

  const statusEl = /** @type {HTMLElement} */ (header.querySelector(".block-badge"));
  const body = document.createElement("div");
  body.className = "tool-body tool-group-body";

  block.appendChild(header);
  block.appendChild(body);

  firstChild.parentGroup = null;

  /** @type {ToolGroupEntry} */
  const group = {
    block,
    header,
    statusEl,
    body,
    children: [firstChild],
    userToggled: false,
  };

  firstChild.parentGroup = group;

  header.addEventListener("click", () => {
    group.userToggled = true;
    block.classList.toggle("expanded");
    console.log("[app] 工具组手动切换 expanded=", block.classList.contains("expanded"));
  });

  return group;
}

/**
 * 创建工具逻辑条目（无独立 DOM，由 tool-group 统一展示）
 * @param {ToolUpdateData} data
 * @returns {ToolBlockEntry}
 */
function createToolBlockEntry(data) {
  const toolCallId = data.toolCallId ?? makeEphemeralId("tool");
  const normalized = { ...data, toolCallId };

  return {
    data: normalized,
    toolCallIds: new Set([toolCallId]),
    mergedParts: [normalized],
    userToggled: false,
    parentGroup: null,
  };
}

/**
 * 将新工具条目挂入当前连续组（无组则新建）
 * @param {ToolBlockEntry} entry
 * @param {HTMLElement | null} turn
 * @returns {ToolGroupEntry}
 */
function attachToolEntryToGroup(entry, turn) {
  if (currentToolGroup) {
    entry.parentGroup = currentToolGroup;
    currentToolGroup.children.push(entry);
    return currentToolGroup;
  }

  const group = createToolGroupEntry(entry);
  if (turn) {
    turn.appendChild(group.block);
  } else {
    messagesEl.appendChild(group.block);
  }
  currentToolGroup = group;
  console.log("[app] 创建工具组");
  return group;
}

/**
 * 工具达到终态时写入 localStorage（每个 toolCallId 只存一次）
 * @param {ToolUpdateData} part
 */
function persistToolPartIfNeeded(part) {
  const toolCallId = part.toolCallId;
  if (!toolCallId || savedToolIds.has(toolCallId)) return;

  const finalStatus = normalizeToolPartStatus(part);
  if (finalStatus !== "completed" && finalStatus !== "failed") return;

  savedToolIds.add(toolCallId);
  saveHistory({
    role: "tool",
    text: summarizeToolPart(part),
    meta: { ...part, status: finalStatus },
  });
  console.log("[app] 工具块已持久化 toolCallId=", toolCallId, "status=", finalStatus);

  if (finalStatus === "completed" && isFilesystemMutatingTool(part)) {
    console.log("[app] 工具修改工作空间文件，刷新文件树 toolName=", part.toolName, "kind=", part.kind);
    scheduleFileExplorerRefresh();
  }
}

/**
 * 轮次结束时补全仍停留在 pending/in_progress 的工具块
 * ponytail: Cursor ACP 偶发不发 tool completed 终态，done 后统一收口
 * @param {"completed" | "failed" | "cancelled"} [finalStatus]
 */
function finalizePendingToolBlocks(finalStatus = "completed") {
  /** @type {Set<ToolBlockEntry>} */
  const entries = new Set(toolBlocksMap.values());
  if (entries.size === 0) return;

  /** @type {Set<ToolGroupEntry>} */
  const groupsToRender = new Set();
  let finalized = 0;

  for (const entry of entries) {
    let changed = false;

    for (const part of entry.mergedParts) {
      const normalized = normalizeToolPartStatus(part);
      if (normalized === "pending" || normalized === "in_progress") {
        part.status = finalStatus;
        changed = true;
      }
    }

    const dataNormalized = normalizeToolPartStatus(entry.data);
    if (dataNormalized === "pending" || dataNormalized === "in_progress") {
      entry.data.status = finalStatus;
      changed = true;
    }

    if (changed) {
      if (entry.parentGroup) groupsToRender.add(entry.parentGroup);
      finalized++;
    }

    for (const part of entry.mergedParts) {
      persistToolPartIfNeeded(part);
    }
  }

  for (const group of groupsToRender) {
    renderToolGroup(group);
  }

  if (finalized > 0) {
    console.log("[app] 轮次结束补全工具块 status=", finalStatus, "count=", finalized);
  }
}

/**
 * 追加或更新工具调用块（按 toolCallId 合并）
 * @param {unknown} update
 */
function appendToolBlock(update) {
  removeTypingIndicator();
  ensureTurnContainer();

  const incoming = /** @type {ToolUpdateData} */ (update ?? {});
  const toolCallId =
    incoming.toolCallId ?? makeEphemeralId("tool");
  const data = { ...incoming, toolCallId };

  let entry = toolBlocksMap.get(toolCallId);
  /** @type {ToolGroupEntry | null} */
  let groupToRender = null;

  if (!entry) {
    const signature = computeToolSignature(data);
    const existingGroup = !isRestoringHistory ? toolSignatureMap.get(signature) : undefined;

    if (existingGroup) {
      entry = existingGroup;
      entry.toolCallIds.add(toolCallId);
      const partIdx = entry.mergedParts.findIndex((p) => p.toolCallId === toolCallId);
      if (partIdx >= 0) {
        entry.mergedParts[partIdx] = mergeToolUpdate(entry.mergedParts[partIdx], data);
      } else {
        entry.mergedParts.push({ ...data });
      }
      entry.data = mergeToolUpdate(entry.data, data);
      toolBlocksMap.set(toolCallId, entry);
      groupToRender = entry.parentGroup ?? null;
      console.log("[app] 合并相同工具调用 signature=", signature, "count=", entry.toolCallIds.size);
    } else {
      // 新工具插入时打断思考/正文流；连续工具不打断、不结束 tool-group
      finalizeCurrentStreamSegment();
      entry = createToolBlockEntry(data);
      const turn = ensureTurnContainer();
      groupToRender = attachToolEntryToGroup(entry, turn);
      toolBlocksMap.set(toolCallId, entry);
      if (!isRestoringHistory) toolSignatureMap.set(signature, entry);
      console.log("[app] 创建工具条目 toolCallId=", toolCallId, "signature=", signature);
    }
  } else {
    entry.data = mergeToolUpdate(entry.data, data);
    const partIdx = entry.mergedParts.findIndex((p) => p.toolCallId === toolCallId);
    if (partIdx >= 0) {
      entry.mergedParts[partIdx] = mergeToolUpdate(entry.mergedParts[partIdx], data);
    } else {
      entry.mergedParts.push({ ...data });
    }
    groupToRender = entry.parentGroup ?? null;
    console.log(
      "[app] 更新工具条目 toolCallId=",
      toolCallId,
      "status=",
      entry.data.status,
      "rawInputKeys=",
      Object.keys(entry.data.rawInput ?? {})
    );
  }

  if (groupToRender) {
    renderToolGroup(groupToRender);
  }

  const part = entry.mergedParts.find((p) => p.toolCallId === toolCallId) ?? entry.data;
  persistToolPartIfNeeded(part);

  scrollToBottom();
}

/**
 * 追加 plan 卡片
 * @param {Record<string, unknown>} msg
 */
function appendPlanCard(msg) {
  const card = document.createElement("div");
  card.className = "plan-card";
  const title = msg.name ? `<h4>${escapeHtml(String(msg.name))}</h4>` : "<h4>计划</h4>";
  card.innerHTML = title + `<pre>${escapeHtml(String(msg.plan ?? ""))}</pre>`;
  messagesEl.appendChild(card);
  scrollToBottom();
}

/**
 * 追加 todos 卡片
 * @param {Record<string, unknown>} msg
 */
function appendTodosCard(msg) {
  const todos = /** @type {Array<{id:string,content:string,status:string}>} */ (msg.todos ?? []);
  const card = document.createElement("div");
  card.className = "todos-card";
  card.innerHTML = "<h4>Todos</h4><ul></ul>";
  const ul = card.querySelector("ul");
  for (const todo of todos) {
    const li = document.createElement("li");
    li.textContent = todo.content;
    if (todo.status === "completed") li.classList.add("done");
    if (todo.status === "in_progress") li.classList.add("active");
    ul?.appendChild(li);
  }
  messagesEl.appendChild(card);
  scrollToBottom();
}

/**
 * 追加系统消息
 * @param {string} text
 */
function appendSystemMsg(text) {
  const el = document.createElement("div");
  el.className = "msg msg-system";
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

/**
 * agent 回复完成，重置流式状态
 * @param {string} stopReason
 */
function finishAgentReply(stopReason) {
  removeTypingIndicator();
  finalizeCurrentStreamSegment();
  finalizePendingToolBlocks("completed");
  resetTurnStreamingState();

  if (stopReason && stopReason !== "end_turn") {
    appendSystemMsg(`[${stopReason}]`);
  }

  setBusy(false);
  console.log("[app] 回复完成 stopReason=", stopReason);
}

/** 显示打字指示器 */
function showTypingIndicator() {
  removeTypingIndicator();
  const el = document.createElement("div");
  el.className = "typing-indicator";
  el.id = "typingIndicator";
  el.textContent = "Agent 思考中...";
  messagesEl.appendChild(el);
  scrollToBottom();
}

/** 移除打字指示器 */
function removeTypingIndicator() {
  document.getElementById("typingIndicator")?.remove();
}

/** 距底部多少 px 内视为「用户在跟读最新消息」 */
const SCROLL_STICKY_THRESHOLD_PX = 80;

/** @type {boolean} 是否锁定在底部 — true 时新消息自动滚底，用户上滑后置 false */
let scrollLockedToBottom = true;

/** @type {boolean} 正在从 localStorage 恢复历史（此阶段禁止滚底） */
let isRestoringHistory = false;

/**
 * 判断消息列表是否已滚到（或接近）底部
 * @returns {boolean}
 */
function isNearBottom() {
  const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  return distance <= SCROLL_STICKY_THRESHOLD_PX;
}

/**
 * 根据当前 scrollTop 同步底部锁定状态（用户手动滚回底部时重新锁定）
 */
function syncScrollLockFromPosition() {
  if (isRestoringHistory) return;
  const wasLocked = scrollLockedToBottom;
  scrollLockedToBottom = isNearBottom();
  if (wasLocked !== scrollLockedToBottom) {
    console.log("[app] 底部锁定=", scrollLockedToBottom);
  }
  updateScrollBottomButton();
  updateTurnNavButtons();
}

// #region 用户对话轮次导航（标题栏）

/**
 * 获取所有用户消息锚点（每轮对话起点）
 * @returns {HTMLElement[]}
 */
function getUserTurnElements() {
  return Array.from(messagesEl.querySelectorAll(":scope > .msg-user"));
}

/**
 * 计算元素在 #messages 滚动容器内的 top 偏移
 * @param {HTMLElement} el
 * @returns {number}
 */
function getTurnTopInMessages(el) {
  return messagesEl.scrollTop + el.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
}

/**
 * 根据当前滚动位置，判定正在查看的用户对话索引
 * @param {HTMLElement[]} turns
 * @returns {number}
 */
function getActiveUserTurnIndex(turns) {
  if (turns.length === 0) return -1;
  const anchorY = messagesEl.scrollTop + 16;
  let active = 0;
  for (let i = 0; i < turns.length; i++) {
    if (getTurnTopInMessages(turns[i]) <= anchorY) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

/**
 * 计算指定用户对话对齐到顶部的 scrollTop
 * @param {HTMLElement[]} turns
 * @param {number} index
 * @returns {number}
 */
function getUserTurnScrollTop(turns, index) {
  return Math.max(0, getTurnTopInMessages(turns[index]) - 8);
}

/**
 * 当前滚动位置是否已对齐到指定用户对话顶部（仍在该轮 Agent 内容区则未对齐）
 * @param {HTMLElement[]} turns
 * @param {number} index
 * @returns {boolean}
 */
function isAlignedToUserTurn(turns, index) {
  if (index < 0 || index >= turns.length) return false;
  const targetTop = getUserTurnScrollTop(turns, index);
  return Math.abs(messagesEl.scrollTop - targetTop) <= 12;
}

/**
 * 滚动到指定索引的用户对话（对齐到消息区顶部）
 * @param {number} index
 */
function scrollToUserTurn(index) {
  const turns = getUserTurnElements();
  if (index < 0 || index >= turns.length) return;

  scrollLockedToBottom = false;
  messagesEl.scrollTop = getUserTurnScrollTop(turns, index);
  console.log("[app] 导航到用户对话", index + 1, "/", turns.length);
  updateScrollBottomButton();
  updateTurnNavButtons();
}

/**
 * 更新标题栏上/下导航按钮状态
 */
function updateTurnNavButtons() {
  if (!turnNavEl || !btnNavTurnUp || !btnNavTurnDown) return;

  const turns = getUserTurnElements();
  const count = turns.length;
  turnNavEl.classList.toggle("hidden", isRestoringHistory || count <= 1);
  if (isRestoringHistory || count <= 1) return;

  const idx = getActiveUserTurnIndex(turns);
  const atCurrentUserTop = idx >= 0 && isAlignedToUserTurn(turns, idx);
  btnNavTurnUp.disabled = idx < 0 || (atCurrentUserTop && idx <= 0);
  btnNavTurnDown.disabled = idx >= count - 1;
  btnNavTurnUp.title = !atCurrentUserTop && idx >= 0
    ? "回到本轮用户消息"
    : idx > 0
      ? `上一条对话 (${idx}/${count})`
      : "已是第一条对话";
  btnNavTurnDown.title = idx < count - 1 ? `下一条对话 (${idx + 2}/${count})` : "已是最后一条对话";
}

// #endregion

/**
 * 滚动到底部
 * @param {{ force?: boolean }} [opts] force=true 时强制滚底并重新锁定（如用户发送消息、点滚底按钮）
 */
function scrollToBottom(opts = {}) {
  const { force = false } = opts;
  if (isRestoringHistory) {
    console.log("[app] 恢复历史中，跳过自动滚底");
    updateScrollBottomButton();
    return;
  }
  if (force) {
    scrollLockedToBottom = true;
  } else if (!scrollLockedToBottom) {
    console.log("[app] 未锁定底部，跳过自动滚底");
    updateScrollBottomButton();
    return;
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
  scrollLockedToBottom = true;
  updateScrollBottomButton();
}

/**
 * 根据是否接近底部，显示/隐藏「滚到底部」按钮
 */
function updateScrollBottomButton() {
  if (!btnScrollBottom) return;
  const shouldShow =
    !isRestoringHistory &&
    messagesEl.scrollHeight > messagesEl.clientHeight + 40 &&
    !scrollLockedToBottom;
  btnScrollBottom.classList.toggle("hidden", !shouldShow);
}

/**
 * 根据底部输入区高度调整消息列表 bottom，避免被遮挡
 */
function syncMessagesBottomPadding() {
  if (isWideLayout()) {
    // 宽屏：聊天在右侧 flex 列，消息区由 flex 分配高度
    messagesEl.style.bottom = "";
    if (btnScrollBottom && inputArea) {
      btnScrollBottom.style.bottom = `${inputArea.offsetHeight + 12}px`;
    }
  } else {
    const h = inputArea?.offsetHeight ?? 64;
    messagesEl.style.bottom = `${h}px`;
    if (btnScrollBottom) {
      btnScrollBottom.style.bottom = `${h + 12}px`;
    }
  }
  console.log("[app] 同步消息区 bottom= wide=", isWideLayout());
  if (scrollLockedToBottom && !isRestoringHistory) {
    // 输入框增高/键盘弹起改变可视高度时，保持跟底
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  updateScrollBottomButton();
  updateTurnNavButtons();
}

// #region 通用工具

/**
 * 统一换行符并按行拆分
 * @param {string} text
 * @returns {string[]}
 */
function normalizeLines(text) {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/**
 * 生成短时临时 ID
 * @param {string} prefix
 * @returns {string}
 */
function makeEphemeralId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 从 data URL 提取 base64 载荷
 * @param {string} dataUrl
 * @returns {string}
 */
function dataUrlToBase64(dataUrl) {
  return dataUrl.split(",")[1] ?? "";
}

/**
 * 页面可见或网络恢复时：已连接则 hello，否则重连
 */
function reconnectOrHello() {
  if (ws?.readyState === WebSocket.OPEN) {
    sendHello();
  } else {
    connectWs();
  }
}

/**
 * 填充 select 选项
 * @template T
 * @param {HTMLSelectElement} el
 * @param {T[]} items
 * @param {(item: T) => string} getValue
 * @param {(item: T) => string} getLabel
 * @param {string | undefined} [currentValue]
 */
function fillSelect(el, items, getValue, getLabel, currentValue) {
  el.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = getValue(item);
    opt.textContent = getLabel(item);
    el.appendChild(opt);
  }
  if (currentValue) el.value = currentValue;
}

// #endregion

// #region 文本工具

/**
 * HTML 转义
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// #endregion

// #region 工作空间选择

/**
 * 格式化工作空间路径用于顶栏显示
 * @param {string} dirPath
 * @returns {string}
 */
function formatWorkspaceDisplay(dirPath) {
  if (!dirPath) return "未选择";
  const parts = dirPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const base = parts[parts.length - 1] || dirPath;
  if (dirPath.length <= 36) return dirPath;
  return `…/${base}`;
}

/**
 * 打开工作空间选择弹窗
 */
function openWorkspacePicker() {
  if (isBusy) {
    appendSystemMsg("Agent 处理中，请稍后再切换工作空间");
    return;
  }

  workspaceModal.classList.remove("hidden");
  workspaceDirList.innerHTML = '<div class="workspace-dir-loading">加载目录...</div>';
  workspaceCurrentPath.textContent = "加载中...";
  btnDirUp.disabled = true;
  btnWorkspaceSelect.disabled = true;

  // 优先从当前工作空间开始浏览
  const startPath = currentWorkspacePath || undefined;
  console.log("[app] 打开工作空间选择器 startPath=", startPath ?? "(roots)");
  sendWs({ type: "browse_dir", path: startPath });
}

/**
 * 渲染目录列表
 * @param {Record<string, unknown>} msg
 */
function renderDirListing(msg) {
  browseCurrentPath = msg.path != null ? String(msg.path) : "";
  browseParentPath = msg.parent != null ? String(msg.parent) : null;

  const isRoots = Boolean(msg.isRoots) || browseCurrentPath === "";
  workspaceCurrentPath.textContent = isRoots
    ? (navigator.platform?.includes("Win") ? "选择盘符" : "/")
    : browseCurrentPath;

  btnDirUp.disabled = browseParentPath === null && !isRoots;
  btnWorkspaceSelect.disabled = isRoots;

  /** @type {Array<{name:string,path:string,isDir:boolean}>} */
  const entries = Array.isArray(msg.entries) ? msg.entries : [];

  workspaceDirList.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "workspace-dir-empty";
    empty.textContent = isRoots ? "未发现可用盘符" : "此目录下没有子文件夹";
    workspaceDirList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const btn = document.createElement("button");
    btn.className = "workspace-dir-item";
    btn.type = "button";
    btn.innerHTML = `<span class="dir-icon">📂</span><span>${escapeHtml(entry.name)}</span>`;
    btn.addEventListener("click", () => {
      console.log("[app] 进入目录:", entry.path);
      workspaceDirList.innerHTML = '<div class="workspace-dir-loading">加载目录...</div>';
      sendWs({ type: "browse_dir", path: entry.path });
    });
    workspaceDirList.appendChild(btn);
  }

  console.log("[app] 目录列表 path=", browseCurrentPath, "entries=", entries.length);
}

/** 目录浏览器 — 上一级 */
function browseDirUp() {
  if (browseParentPath === null && browseCurrentPath !== "") return;

  workspaceDirList.innerHTML = '<div class="workspace-dir-loading">加载目录...</div>';
  const targetPath = browseParentPath ?? "";
  console.log("[app] 返回上一级 path=", targetPath || "(roots)");
  sendWs({ type: "browse_dir", path: targetPath || undefined });
}

/** 确认选择当前浏览目录为工作空间 */
function confirmWorkspaceSelection() {
  if (!browseCurrentPath) {
    appendSystemMsg("请先进入一个文件夹");
    return;
  }

  console.log("[app] 选择工作空间:", browseCurrentPath);
  sendWs({ type: "set_workspace", path: browseCurrentPath });
  workspaceModal.classList.add("hidden");
}

/** 关闭工作空间选择弹窗 */
function closeWorkspacePicker() {
  workspaceModal.classList.add("hidden");
}

// #endregion

// #region 工作空间文件浏览器

/**
 * 当前是否为宽屏并排布局
 * @returns {boolean}
 */
function isWideLayout() {
  return WIDE_LAYOUT_MQ.matches;
}

/**
 * 同步宽/窄屏文件树布局：宽屏默认展开侧栏，窄屏保持抽屉
 */
function syncFileExplorerLayout() {
  const wide = isWideLayout();
  document.body.classList.toggle("wide-layout", wide);
  console.log("[app] 同步文件树布局 wide=", wide, "collapsed=", fileExplorerWideCollapsed);

  if (wide && !fileExplorerWideCollapsed && !isFileExplorerVisible()) {
    openFileExplorer();
  }

  syncWideScreenPanels();
  updateFileExplorerToggleLabel();
}

/**
 * 同步宽屏三栏 / 窄屏单栏布局（中间预览、右侧聊天）
 */
function syncWideScreenPanels() {
  const wide = isWideLayout();
  if (wide) {
    if (filePreviewRequestPath) {
      document.body.classList.add("editor-open");
      fileExplorerPathBar?.classList.remove("hidden");
      fileExplorerList?.classList.remove("hidden");
    }
  } else if (document.body.classList.contains("editor-open")) {
    fileExplorerPathBar?.classList.add("hidden");
    fileExplorerList?.classList.add("hidden");
  }
  syncMessagesBottomPadding();
}

/**
 * 更新工具栏文件树按钮的无障碍文案
 */
function updateFileExplorerToggleLabel() {
  if (!btnToggleFileExplorer) return;
  const open = isFileExplorerVisible();
  const label = open ? "关闭文件浏览" : "打开文件浏览";
  btnToggleFileExplorer.title = open ? "关闭文件浏览" : "文件浏览";
  btnToggleFileExplorer.setAttribute("aria-label", label);
}

/**
 * 文件浏览器是否应对用户可见
 * @returns {boolean}
 */
function isFileExplorerVisible() {
  return document.body.classList.contains("file-explorer-open");
}

/**
 * 判断工具是否可能改动了工作空间文件（写 / 改 / 删）
 * @param {ToolUpdateData} data
 * @returns {boolean}
 */
function isFilesystemMutatingTool(data) {
  const kind = data.kind ?? "";
  const name = data.toolName ?? "";
  if (kind === "write" || kind === "edit" || kind === "delete") return true;
  if (["Write", "StrReplace", "Edit", "Delete", "ApplyPatch", "Write File", "Edit File"].includes(name)) {
    return true;
  }
  if (collectToolDiffBlocks(data).length > 0) return true;
  return false;
}

/**
 * 更新文件树标题中的当前目录项数
 * @param {number} entryCount 当前目录下的文件 + 文件夹总数
 */
function updateFileExplorerTitle(entryCount) {
  if (!fileExplorerTitle) return;
  fileExplorerTitle.textContent = entryCount > 0 ? `文件 (${entryCount})` : "文件";
  console.log("[app] 文件树标题项数 entryCount=", entryCount);
}

/**
 * 静默刷新当前目录列表（不闪「加载中」，用于 Agent 改文件后的及时更新）
 */
function refreshFileExplorerListing() {
  if (!currentWorkspacePath) return;
  console.log("[app] 刷新工作空间文件列表 path=", fileExplorerCurrentPath || "(root)");
  sendWs({ type: "browse_workspace", path: fileExplorerCurrentPath || undefined });
  if (filePreviewRequestPath) {
    console.log("[app] 同步刷新中间预览 path=", filePreviewRequestPath);
    sendWs({ type: "read_workspace_file", path: filePreviewRequestPath });
  }
}

/**
 * 防抖刷新文件树，避免连续多次 Write/Delete 打爆 browse_workspace
 */
function scheduleFileExplorerRefresh() {
  if (!currentWorkspacePath) return;
  if (fileExplorerRefreshTimer) clearTimeout(fileExplorerRefreshTimer);
  fileExplorerRefreshTimer = setTimeout(() => {
    fileExplorerRefreshTimer = null;
    refreshFileExplorerListing();
  }, 250);
}

/**
 * 打开文件浏览器（窄屏为全屏抽屉，宽屏为左侧固定侧栏）
 */
function openFileExplorer() {
  document.body.classList.add("file-explorer-open");
  if (isWideLayout()) {
    fileExplorerWideCollapsed = false;
  }
  console.log("[app] 打开文件浏览器 wide=", isWideLayout());
  updateFileExplorerToggleLabel();
  loadFileExplorer(fileExplorerCurrentPath || undefined);
}

/**
 * 关闭文件浏览器（窄屏收起抽屉，宽屏收起左侧侧栏）
 */
function closeFileExplorer() {
  closeFilePreview();
  document.body.classList.remove("file-explorer-open");
  if (isWideLayout()) {
    fileExplorerWideCollapsed = true;
  }
  console.log("[app] 关闭文件浏览器 wide=", isWideLayout());
  updateFileExplorerToggleLabel();
}

/**
 * 切换文件浏览器显示
 */
function toggleFileExplorer() {
  if (document.body.classList.contains("file-explorer-open")) {
    closeFileExplorer();
  } else {
    openFileExplorer();
  }
}

/**
 * 请求服务端列出工作空间目录
 * @param {string | undefined} targetPath 绝对路径，省略则列出根目录
 */
function loadFileExplorer(targetPath) {
  closeFilePreview();
  fileExplorerList.innerHTML = '<div class="file-explorer-loading">加载中...</div>';
  fileExplorerPath.textContent = "加载中...";
  btnFileExplorerUp.disabled = true;
  console.log("[app] browse_workspace path=", targetPath ?? "(root)");
  sendWs({ type: "browse_workspace", path: targetPath });
}

/**
 * 格式化文件大小
 * @param {number | undefined} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 关闭文件预览，回到目录列表
 */
function closeFilePreview() {
  filePreviewRequestPath = null;
  document.body.classList.remove("editor-open");
  filePreviewPane?.classList.add("hidden");
  filePreviewPane?.setAttribute("aria-hidden", "true");
  fileExplorerPathBar?.classList.remove("hidden");
  fileExplorerList?.classList.remove("hidden");
  if (filePreviewBody) filePreviewBody.innerHTML = "";
  updateFileExplorerActiveEntry();
  console.log("[app] 关闭文件预览 wide=", isWideLayout());
}

/**
 * 高亮文件树中当前预览的文件
 * @param {string | null} activePath
 */
function updateFileExplorerActiveEntry(activePath = filePreviewRequestPath) {
  if (!fileExplorerList) return;
  for (const el of fileExplorerList.querySelectorAll(".file-explorer-item")) {
    el.classList.toggle("is-active", activePath != null && el.dataset.path === activePath);
  }
}

/**
 * 打开文件预览
 * @param {{ name: string, path: string, relativePath?: string }} entry
 */
function openFilePreview(entry) {
  if (!filePreviewPane || !filePreviewBody || !filePreviewTitle) return;

  console.log("[app] 打开文件预览 path=", entry.path, "wide=", isWideLayout());
  filePreviewRequestPath = entry.path;
  filePreviewTitle.textContent = entry.relativePath || entry.name;
  filePreviewBody.innerHTML = '<div class="file-explorer-loading">加载中...</div>';

  document.body.classList.add("editor-open");
  filePreviewPane.classList.remove("hidden");
  filePreviewPane.setAttribute("aria-hidden", "false");

  if (isWideLayout()) {
    fileExplorerPathBar?.classList.remove("hidden");
    fileExplorerList?.classList.remove("hidden");
    if (btnFilePreviewBack) {
      btnFilePreviewBack.title = "关闭预览";
      btnFilePreviewBack.setAttribute("aria-label", "关闭预览");
    }
  } else {
    fileExplorerPathBar?.classList.add("hidden");
    fileExplorerList?.classList.add("hidden");
    if (btnFilePreviewBack) {
      btnFilePreviewBack.title = "返回文件列表";
      btnFilePreviewBack.setAttribute("aria-label", "返回文件列表");
    }
  }

  updateFileExplorerActiveEntry(entry.path);
  sendWs({ type: "read_workspace_file", path: entry.path });
}

/**
 * 渲染文件预览内容
 * @param {Record<string, unknown>} msg
 */
function renderFilePreview(msg) {
  if (!filePreviewBody || !filePreviewPane) return;

  const msgPath = msg.path != null ? String(msg.path) : "";
  if (filePreviewRequestPath && msgPath !== filePreviewRequestPath) {
    console.log("[app] 忽略过期文件预览响应 path=", msgPath);
    return;
  }

  filePreviewBody.innerHTML = "";

  if (msg.isImage && msg.data) {
    const img = document.createElement("img");
    img.className = "file-preview-image";
    img.src = `data:${String(msg.mimeType ?? "image/png")};base64,${String(msg.data)}`;
    img.alt = String(msg.name ?? "图片预览");
    filePreviewBody.appendChild(img);
    console.log("[app] 文件预览(图片) name=", msg.name);
    return;
  }

  if (msg.isBinary) {
    const note = document.createElement("div");
    note.className = "file-preview-binary";
    note.textContent = `无法预览二进制文件（${formatFileSize(Number(msg.size))}）`;
    filePreviewBody.appendChild(note);
    console.log("[app] 文件预览(二进制) name=", msg.name);
    return;
  }

  const pre = document.createElement("pre");
  pre.className = "file-preview-content";
  pre.textContent = msg.content != null ? String(msg.content) : "";
  filePreviewBody.appendChild(pre);

  if (msg.truncated) {
    const truncated = document.createElement("div");
    truncated.className = "file-preview-truncated";
    truncated.textContent = "文件过大，仅显示前 512 KB";
    filePreviewBody.appendChild(truncated);
  }

  console.log("[app] 文件预览(文本) name=", msg.name, "bytes=", msg.size);
}

/**
 * 渲染工作空间文件列表
 * @param {Record<string, unknown>} msg
 */
function renderFileExplorerListing(msg) {
  fileExplorerCurrentPath = msg.path != null ? String(msg.path) : "";
  fileExplorerParentPath = msg.parent != null ? String(msg.parent) : null;

  const relativePath = msg.relativePath != null ? String(msg.relativePath) : "";
  fileExplorerPath.textContent = relativePath ? `/${relativePath}` : "/";
  btnFileExplorerUp.disabled = fileExplorerParentPath === null;

  /** @type {Array<{name:string,path:string,relativePath?:string,isDir:boolean,size?:number}>} */
  const entries = Array.isArray(msg.entries) ? msg.entries : [];

  fileExplorerList.innerHTML = "";

  const entryCount = entries.length;
  updateFileExplorerTitle(entryCount);

  if (entryCount === 0) {
    const empty = document.createElement("div");
    empty.className = "file-explorer-empty";
    empty.textContent = "此目录为空";
    fileExplorerList.appendChild(empty);
    console.log("[app] 工作空间文件列表为空 path=", fileExplorerCurrentPath);
    return;
  }

  for (const entry of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-explorer-item";
    btn.title = entry.relativePath || entry.path;
    btn.dataset.path = entry.path;

    const icon = entry.isDir ? "📁" : "📄";
    const sizeHtml = entry.isDir ? "" : `<span class="file-size">${formatFileSize(entry.size)}</span>`;
    btn.innerHTML = `<span class="file-icon">${icon}</span><span class="file-name">${escapeHtml(entry.name)}</span>${sizeHtml}`;

    btn.addEventListener("click", () => {
      if (entry.isDir) {
        console.log("[app] 进入工作空间目录:", entry.path);
        loadFileExplorer(entry.path);
        return;
      }

      openFilePreview(entry);
    });

    fileExplorerList.appendChild(btn);
  }

  updateFileExplorerActiveEntry();

  console.log("[app] 工作空间文件列表 path=", fileExplorerCurrentPath, "entries=", entryCount);
}

/** 文件浏览器 — 上一级 */
function fileExplorerUp() {
  if (fileExplorerParentPath === null) return;
  console.log("[app] 文件浏览器返回上一级 path=", fileExplorerParentPath);
  loadFileExplorer(fileExplorerParentPath);
}

// #endregion

// #region ask_question 弹窗

/**
 * 显示 ask_question 弹窗
 * @param {Record<string, unknown>} msg
 */
function showAskModal(msg) {
  pendingAskId = /** @type {number} */ (msg.id);

  askTitle.textContent = msg.title ? String(msg.title) : "请选择";
  askQuestions.innerHTML = "";

  const questions = /** @type {Array<{id:string,prompt:string,options:Array<{id:string,label:string}>,allowMultiple?:boolean}>} */ (msg.questions ?? []);

  for (const q of questions) {
    const qDiv = document.createElement("div");
    qDiv.className = "ask-question";
    qDiv.dataset.questionId = q.id;

    const p = document.createElement("p");
    p.textContent = q.prompt;
    qDiv.appendChild(p);

    for (const opt of q.options) {
      const btn = document.createElement("button");
      btn.className = "ask-option";
      btn.textContent = opt.label;
      btn.dataset.optionId = opt.id;
      btn.addEventListener("click", () => {
        if (q.allowMultiple) {
          btn.classList.toggle("selected");
        } else {
          qDiv.querySelectorAll(".ask-option").forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
        }
      });
      qDiv.appendChild(btn);
    }
    askQuestions.appendChild(qDiv);
  }

  askModal.classList.remove("hidden");
}

/** 提交 ask_question 答案 */
function submitAskAnswer() {
  if (pendingAskId === null) return;

  const answers = [];
  askQuestions.querySelectorAll(".ask-question").forEach((qDiv) => {
    const questionId = qDiv.dataset.questionId ?? "";
    const selected = qDiv.querySelectorAll(".ask-option.selected");
    const selectedOptionIds = Array.from(selected).map((b) => b.dataset.optionId ?? "");
    if (selectedOptionIds.length > 0) {
      answers.push({ questionId, selectedOptionIds });
    }
  });

  sendWs({
    type: "answer_question",
    id: pendingAskId,
    answer: { outcome: { outcome: "answered", answers } },
  });

  askModal.classList.add("hidden");
  pendingAskId = null;
}

/** 跳过 ask_question */
function skipAskQuestion() {
  if (pendingAskId === null) return;

  sendWs({
    type: "answer_question",
    id: pendingAskId,
    answer: { outcome: { outcome: "skipped" } },
  });

  askModal.classList.add("hidden");
  pendingAskId = null;
}

// #endregion

// #region 图片插入

/**
 * 根据文件名猜测 MIME（iOS 相册偶发 type 为空）
 * @param {string} filename
 * @returns {string | null}
 */
function guessMimeFromFilename(filename) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] ?? null;
}

/**
 * 从 File 读取为 Data URL
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`读取图片失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * 加载图片元素
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

/**
 * 压缩图片：限制最长边与 JPEG 质量（GIF 保持原样）
 * @param {File} file
 * @returns {Promise<{ mimeType: string, data: string, previewUrl: string }>}
 */
async function processImageFile(file) {
  const mimeHint = file.type || guessMimeFromFilename(file.name) || "";
  if (!mimeHint.startsWith("image/")) {
    throw new Error(`不支持的文件类型: ${file.type || file.name}`);
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(`图片 ${file.name} 超过 5MB 限制`);
  }

  console.log("[app] 处理图片 file=", file.name, "size=", file.size, "type=", mimeHint);

  // HEIC/HEIF 浏览器无法 canvas 解码，原样 base64 发送
  if (mimeHint === "image/heic" || mimeHint === "image/heif") {
    const dataUrl = await readFileAsDataUrl(file);
    const base64 = dataUrlToBase64(dataUrl);
    if (!base64) throw new Error(`图片 ${file.name} 编码失败`);
    return { mimeType: mimeHint, data: base64, previewUrl: dataUrl };
  }

  // GIF 不做重编码，避免丢失动画
  if (mimeHint === "image/gif") {
    const dataUrl = await readFileAsDataUrl(file);
    const base64 = dataUrlToBase64(dataUrl);
    if (!base64) throw new Error(`图片 ${file.name} 编码失败`);
    return { mimeType: "image/gif", data: base64, previewUrl: dataUrl };
  }

  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(dataUrl);

  let { width, height } = img;
  const maxSide = Math.max(width, height);
  if (maxSide > MAX_IMAGE_DIMENSION) {
    const scale = MAX_IMAGE_DIMENSION / maxSide;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    console.log("[app] 缩放图片 ->", width, "x", height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 不可用");
  ctx.drawImage(img, 0, 0, width, height);

  // PNG 保留透明通道，其余转 JPEG 减小体积
  const outputMime = mimeHint === "image/png" ? "image/png" : "image/jpeg";
  const quality = outputMime === "image/jpeg" ? 0.85 : undefined;
  const outDataUrl = canvas.toDataURL(outputMime, quality);
  const base64 = dataUrlToBase64(outDataUrl);
  if (!base64) throw new Error(`图片 ${file.name} 压缩失败`);

  console.log("[app] 图片就绪 mime=", outputMime, "base64Len=", base64.length);
  return { mimeType: outputMime, data: base64, previewUrl: outDataUrl };
}

/**
 * 渲染待发送图片预览条
 */
function renderImagePreviewBar() {
  imagePreviewBar.innerHTML = "";

  if (pendingImages.length === 0) {
    imagePreviewBar.classList.add("hidden");
    syncMessagesBottomPadding();
    return;
  }

  imagePreviewBar.classList.remove("hidden");

  for (const item of pendingImages) {
    const wrap = document.createElement("div");
    wrap.className = "image-preview-item";

    const img = document.createElement("img");
    img.src = item.previewUrl;
    img.alt = "待发送图片";
    wrap.appendChild(img);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "image-preview-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "移除图片");
    removeBtn.addEventListener("click", () => {
      pendingImages = pendingImages.filter((p) => p.id !== item.id);
      console.log("[app] 移除待发送图片 id=", item.id, "剩余=", pendingImages.length);
      renderImagePreviewBar();
    });
    wrap.appendChild(removeBtn);

    imagePreviewBar.appendChild(wrap);
  }

  syncMessagesBottomPadding();
}

/**
 * 清空待发送图片
 */
function clearPendingImages() {
  pendingImages = [];
  renderImagePreviewBar();
  if (inputImage) inputImage.value = "";
}

/**
 * 处理用户选择的图片文件
 * @param {FileList | null} fileList
 */
async function handleImageFilesSelected(fileList) {
  if (!fileList || fileList.length === 0) return;

  for (const file of Array.from(fileList)) {
    if (pendingImages.length >= MAX_PENDING_IMAGES) {
      appendSystemMsg(`最多只能附加 ${MAX_PENDING_IMAGES} 张图片`);
      break;
    }

    try {
      const processed = await processImageFile(file);
      pendingImages.push({
        id: makeEphemeralId("img"),
        mimeType: processed.mimeType,
        data: processed.data,
        previewUrl: processed.previewUrl,
      });
      console.log("[app] 已加入待发送图片 count=", pendingImages.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendSystemMsg(message);
      console.warn("[app] 图片处理失败:", message);
    }
  }

  renderImagePreviewBar();
  if (inputImage) inputImage.value = "";
}

/**
 * 从剪贴板 / 拖拽注入图片
 * @param {File[] | FileList} files
 */
function ingestImageFiles(files) {
  if (isBusy) {
    appendSystemMsg("Agent 处理中，请稍后再插入图片");
    return;
  }
  const list = files instanceof FileList ? files : files;
  void handleImageFilesSelected(list);
}

/**
 * 处理粘贴事件中的图片
 * @param {ClipboardEvent} e
 */
function handlePasteImages(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  /** @type {File[]} */
  const imageFiles = [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }

  if (imageFiles.length === 0) return;

  e.preventDefault();
  console.log("[app] 粘贴图片 count=", imageFiles.length);
  ingestImageFiles(imageFiles);
}

// #endregion

// #region localStorage 历史

/**
 * 保存一条消息到 localStorage（追加到末尾，保持事件时间顺序）
 * @param {HistoryEntry} entry
 */
function saveHistory(entry) {
  try {
    const history = loadHistory();
    history.push(entry);
    // ponytail: 最多保留 200 条，避免 localStorage 爆
    if (history.length > 200) history.splice(0, history.length - 200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn("[app] 保存历史失败:", err);
  }
}

/** @returns {HistoryEntry[]} */
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 恢复历史中的思考块 DOM
 * @param {string | undefined} rawText
 * @param {HTMLElement} [parentEl]
 */
function appendRestoredThoughtBlock(rawText, parentEl = messagesEl) {
  const thoughtText = normalizeThoughtText(rawText ?? "");
  if (!hasVisibleThoughtContent(thoughtText)) return;
  const { block } = createThoughtBlockEl({ streaming: false, text: thoughtText });
  parentEl.appendChild(block);
}

/**
 * 将轮次条目按连续 tool 分段（供历史恢复与自检）
 * @param {HistoryEntry[]} turnEntries
 * @returns {Array<{ type: "thought" | "tool" | "agent", entry?: HistoryEntry, toolMetas?: Record<string, unknown>[] }>}
 */
function segmentTurnEntriesForRestore(turnEntries) {
  /** @type {Array<{ type: "thought" | "tool" | "agent", entry?: HistoryEntry, toolMetas?: Record<string, unknown>[] }>} */
  const segments = [];
  let i = 0;
  while (i < turnEntries.length) {
    const entry = turnEntries[i];
    if (entry.role === "tool") {
      /** @type {Record<string, unknown>[]} */
      const toolMetas = [];
      while (i < turnEntries.length && turnEntries[i].role === "tool") {
        toolMetas.push(turnEntries[i].meta ?? {});
        i++;
      }
      segments.push({ type: "tool", toolMetas });
    } else if (entry.role === "thought") {
      segments.push({ type: "thought", entry });
      i++;
    } else if (entry.role === "agent") {
      segments.push({ type: "agent", entry });
      i++;
    } else {
      i++;
    }
  }
  return segments;
}

/**
 * 恢复历史中的连续工具组 DOM
 * @param {Record<string, unknown>[]} metas
 * @param {HTMLElement} parentEl
 */
function appendRestoredToolGroup(metas, parentEl) {
  if (metas.length === 0) return;

  const first = createToolBlockEntry(/** @type {ToolUpdateData} */ (metas[0]));
  const group = createToolGroupEntry(first);
  for (let i = 1; i < metas.length; i++) {
    const child = createToolBlockEntry(/** @type {ToolUpdateData} */ (metas[i]));
    child.parentGroup = group;
    group.children.push(child);
  }
  renderToolGroup(group);
  parentEl.appendChild(group.block);
  console.log("[app] 恢复工具组 count=", metas.length);
}

/**
 * 恢复一整轮 agent 回复（按 localStorage 中的事件顺序）
 * @param {HistoryEntry[]} turnEntries
 */
function appendRestoredAgentTurn(turnEntries) {
  if (turnEntries.length === 0) return;

  const turnEl = document.createElement("div");
  turnEl.className = "agent-turn";
  messagesEl.appendChild(turnEl);

  const segments = segmentTurnEntriesForRestore(turnEntries);
  for (const seg of segments) {
    if (seg.type === "thought" && seg.entry) {
      appendRestoredThoughtBlock(seg.entry.text, turnEl);
    } else if (seg.type === "tool" && seg.toolMetas) {
      appendRestoredToolGroup(seg.toolMetas, turnEl);
    } else if (seg.type === "agent" && seg.entry) {
      const el = document.createElement("div");
      el.className = "msg msg-agent";
      el.textContent = seg.entry.text;
      turnEl.appendChild(el);
    }
  }
  console.log("[app] 恢复轮次 entries=", turnEntries.length);
}

/** 从 localStorage 恢复消息显示 */
function restoreHistory() {
  const history = loadHistory();
  if (history.length === 0) return;

  isRestoringHistory = true;
  console.log("[app] 开始恢复历史，条数=", history.length);

  let i = 0;
  while (i < history.length) {
    const entry = history[i];
    if (entry.role === "user") {
      messagesEl.appendChild(
        createUserBubbleEl({
          text: entry.text,
          images: entry.images ?? [],
          imageCount: entry.imageCount,
        })
      );
      i++;

      /** @type {HistoryEntry[]} */
      const turnEntries = [];
      while (i < history.length && history[i].role !== "user") {
        turnEntries.push(history[i]);
        i++;
      }
      appendRestoredAgentTurn(turnEntries);
    } else {
      // ponytail: 孤立条目（无前置 user），按轮次容器尽力恢复
      /** @type {HistoryEntry[]} */
      const orphanTurn = [];
      while (i < history.length && history[i].role !== "user") {
        orphanTurn.push(history[i]);
        i++;
      }
      appendRestoredAgentTurn(orphanTurn);
    }
  }
  isRestoringHistory = false;
  // 刷新后默认定位到最新对话（底部）
  scrollToBottom({ force: true });
  updateTurnNavButtons();
  console.log("[app] 历史恢复完成，滚动至最新对话");
}

// #endregion

// #region UI 状态

/**
 * 设置状态栏文字
 * @param {string} text
 * @param {string} cssClass
 */
function setStatus(text, cssClass) {
  statusBar.textContent = text;
  statusBar.className = "status-bar" + (cssClass ? ` ${cssClass}` : "");
}

/**
 * 刷新 Agent 用时显示（秒）
 */
function updateAgentElapsedText() {
  const elapsedSec = Math.floor((Date.now() - agentStartMs) / 1000);
  agentElapsedText.textContent = `用时 ${elapsedSec} 秒`;
}

/**
 * 启动 Agent 用时计时
 * @param {number | null} [resumeFromMs] sync 重连时恢复服务器侧开始时间
 */
function startAgentTimer(resumeFromMs = null) {
  stopAgentTimer();
  agentStartMs =
    typeof resumeFromMs === "number" && resumeFromMs > 0 ? resumeFromMs : Date.now();
  agentWorkStatusEl.classList.remove("hidden");
  agentWorkStatusEl.classList.add("is-busy");
  updateAgentElapsedText();
  agentTimerId = window.setInterval(updateAgentElapsedText, 1000);
  // 用时条会撑高底部输入区，需同步消息列表 bottom，否则最后几条会被挡住
  syncMessagesBottomPadding();
  console.log(
    "[app] Agent 计时开始",
    resumeFromMs ? `(恢复自 ${resumeFromMs})` : ""
  );
}

/** 停止 Agent 用时计时并隐藏 */
function stopAgentTimer() {
  if (agentTimerId !== null) {
    clearInterval(agentTimerId);
    agentTimerId = null;
  }
  agentWorkStatusEl.classList.add("hidden");
  agentWorkStatusEl.classList.remove("is-busy");
  syncMessagesBottomPadding();
}

/**
 * 重置取消按钮为执行中样式
 */
function resetCancelButton() {
  agentFailed = false;
  btnCancel.textContent = "取消";
  btnCancel.setAttribute("aria-label", "取消");
  btnCancel.classList.remove("btn-failed");
}

/**
 * Agent 执行出错 — 取消按钮变为「知道了」，避免用户空等
 * @param {string} message
 */
function setAgentFailed(message) {
  console.warn("[app] Agent 出错:", message);
  removeTypingIndicator();
  stopAgentTimer();

  isBusy = true;
  agentFailed = true;
  btnSend.classList.add("hidden");
  btnCancel.classList.remove("hidden");
  btnCancel.textContent = "知道了";
  btnCancel.setAttribute("aria-label", "确认错误并关闭");
  btnCancel.classList.add("btn-failed");

  setStatus(message, "error");
}

/**
 * 设置 busy 状态（禁用发送/显示取消）
 * @param {boolean} busy
 * @param {number | null} [startedAtMs] sync 重连时恢复服务器侧开始时间
 */
function setBusy(busy, startedAtMs = null) {
  isBusy = busy;
  resetCancelButton();
  btnSend.classList.toggle("hidden", busy);
  btnCancel.classList.toggle("hidden", !busy);
  console.log("[app] busy=", busy, "startedAtMs=", startedAtMs);

  if (busy) {
    showTypingIndicator();
    setStatus("Agent 处理中...", "busy");
    if (typeof startedAtMs === "number" && startedAtMs > 0) {
      startAgentTimer(startedAtMs);
    } else {
      startAgentTimer();
    }
  } else {
    removeTypingIndicator();
    stopAgentTimer();
    setStatus("已连接", "connected");
  }
}

// #endregion

// #region 事件绑定

/** 发送消息（文本 + 可选图片） */
function sendMessage() {
  const text = inputText.value.trim();
  if ((!text && pendingImages.length === 0) || isBusy) return;

  const images = pendingImages.map(({ mimeType, data }) => ({ mimeType, data }));
  console.log("[app] 发送 prompt textLen=", text.length, "images=", images.length);
  sendWs({ type: "prompt", text, images });

  inputText.value = "";
  inputText.style.height = "auto";
  clearPendingImages();
  syncMessagesBottomPadding();
}

btnSend.addEventListener("click", sendMessage);

btnScrollBottom?.addEventListener("click", () => {
  console.log("[app] 用户点击滚到底部");
  scrollToBottom({ force: true });
});

btnNavTurnUp?.addEventListener("click", () => {
  const turns = getUserTurnElements();
  const idx = getActiveUserTurnIndex(turns);
  if (idx < 0) return;
  // 在 Agent 内容区：先对齐本轮用户消息；已对齐时再跳到上一轮
  if (isAlignedToUserTurn(turns, idx)) {
    if (idx > 0) scrollToUserTurn(idx - 1);
  } else {
    scrollToUserTurn(idx);
  }
});

btnNavTurnDown?.addEventListener("click", () => {
  const turns = getUserTurnElements();
  const idx = getActiveUserTurnIndex(turns);
  if (idx < turns.length - 1) scrollToUserTurn(idx + 1);
});

messagesEl.addEventListener("scroll", () => {
  syncScrollLockFromPosition();
}, { passive: true });

inputText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// textarea 自动增高
inputText.addEventListener("input", () => {
  inputText.style.height = "auto";
  inputText.style.height = Math.min(inputText.scrollHeight, 120) + "px";
  syncMessagesBottomPadding();
});

btnPickImage.addEventListener("click", () => {
  if (isBusy) {
    appendSystemMsg("Agent 处理中，请稍后再插入图片");
    return;
  }
  inputImage?.click();
});

inputImage?.addEventListener("change", () => {
  void handleImageFilesSelected(inputImage.files);
});

inputText.addEventListener("paste", handlePasteImages);

inputArea?.addEventListener("dragover", (e) => {
  e.preventDefault();
});

inputArea?.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  console.log("[app] 拖放图片 count=", files.length);
  ingestImageFiles(files);
});

btnCancel.addEventListener("click", () => {
  if (agentFailed) {
    console.log("[app] 用户确认 Agent 出错，恢复输入");
    setBusy(false);
    return;
  }
  console.log("[app] 用户请求取消 Agent");
  sendWs({ type: "cancel" });
});

btnNewSession.addEventListener("click", () => {
  if (confirm("开始新会话？当前显示的历史会保留。")) {
    sendWs({ type: "new_session" });
    appendSystemMsg("--- 新会话 ---");
  }
});

selectMode.addEventListener("change", () => {
  sendWs({ type: "set_mode", modeId: selectMode.value });
  console.log("[app] 切换模式:", selectMode.value);
});

selectModel.addEventListener("change", () => {
  sendWs({ type: "set_model", modelId: selectModel.value });
  console.log("[app] 切换模型:", selectModel.value);
});

btnAskSubmit.addEventListener("click", submitAskAnswer);
btnAskSkip.addEventListener("click", skipAskQuestion);

btnPickWorkspace.addEventListener("click", openWorkspacePicker);
btnDirUp.addEventListener("click", browseDirUp);
btnWorkspaceSelect.addEventListener("click", confirmWorkspaceSelection);
btnWorkspaceCancel.addEventListener("click", closeWorkspacePicker);

btnToggleFileExplorer.addEventListener("click", toggleFileExplorer);
btnCloseFileExplorer.addEventListener("click", closeFileExplorer);
btnFileExplorerUp.addEventListener("click", fileExplorerUp);
btnFilePreviewBack?.addEventListener("click", closeFilePreview);
fileExplorerBackdrop.addEventListener("click", closeFileExplorer);

// #endregion

// #region 启动

// ponytail: 最小自检 — thought 归一化逻辑回归
console.assert(
  normalizeThoughtText("────────\n\n用户要求只回答数字\n---") === "用户要求只回答数字",
  "[app] normalizeThoughtText 自检失败"
);
console.assert(!hasVisibleThoughtContent("────────"), "[app] hasVisibleThoughtContent 自检失败");
console.assert(
  mergeThoughtStreamChunk("line1", "line2") === "line1\nline2",
  "[app] mergeThoughtStreamChunk 按行快照 自检失败"
);
console.assert(
  mergeThoughtStreamChunk("hello", "hello world") === "hello world",
  "[app] mergeThoughtStreamChunk 前缀快照 自检失败"
);
console.assert(
  mergeThoughtStreamChunk("hel", "lo") === "hello",
  "[app] mergeThoughtStreamChunk token 增量 自检失败"
);
console.assert(
  normalizeThoughtText("a\rb\rc") === "a\nb\nc",
  "[app] normalizeThoughtText \\r 自检失败"
);
console.assert(
  computeToolSignature({ toolName: "Read", title: "a", rawInput: { path: "/x" } }) ===
    computeToolSignature({ toolName: "Read", title: "a", rawInput: { path: "/x" } }),
  "[app] computeToolSignature 自检失败"
);
console.assert(
  consolidateToolContentItems([
    { type: "content", content: { type: "text", text: "a" } },
    { type: "content", content: { type: "text", text: "b" } },
  ]).length === 1,
  "[app] consolidateToolContentItems 自检失败"
);
console.assert(
  formatToolRawInput({ path: "/a", offset: 10 }).includes("offset"),
  "[app] formatToolRawInput 自检失败"
);
console.assert(countDiffAffectedLines("a\nb", "a\nc") === 2, "[app] countDiffAffectedLines 自检失败");
console.assert(
  renderToolDiffHtml("old line", "new line", 10).includes("tool-diff-line-del") &&
    renderToolDiffHtml("old line", "new line", 10).includes("tool-diff-line-add"),
  "[app] renderToolDiffHtml 自检失败"
);
console.assert(
  isFilesystemMutatingTool({ toolName: "Write", kind: "write" }) &&
    isFilesystemMutatingTool({ toolName: "Delete", kind: "delete" }) &&
    !isFilesystemMutatingTool({ toolName: "Read", kind: "read" }),
  "[app] isFilesystemMutatingTool 自检失败"
);
console.assert(
  toolHeaderName({ kind: "read" }) === "读文件" &&
    toolHeaderName({ toolName: "Shell" }) === "终端" &&
    toolHeaderName({ kind: "search", toolName: "Glob" }) === "筛选文件" &&
    toolHeaderName({ kind: "search", toolName: "Grep" }) === "搜文件内容" &&
    toolHeaderName({ kind: "search", rawInput: { glob_pattern: "**/*.js" } }) === "筛选文件" &&
    toolHeaderName({ kind: "search", rawInput: { pattern: "foo", totalFiles: 3 } }) === "搜文件内容" &&
    toolHeaderName({ kind: "search", rawInput: { totalFiles: 66, truncated: false } }) === "筛选文件",
  "[app] toolHeaderName 自检失败"
);
console.assert(
  resolveToolName({ title: "Glob: **/*.js" }) === "Glob" &&
    resolveToolName({ rawInput: { pattern: "x" } }) === "Grep",
  "[app] resolveToolName 自检失败"
);
console.assert(
  toolCallIntent({ rawInput: { description: "Find tool handlers" } }) === "Find tool handlers" &&
    toolCallIntent({ title: "Read: app.js", rawInput: {} }) === "Read: app.js" &&
    toolCallIntent({ rawInput: { path: "/proj/src/app.js" } }) === "app.js",
  "[app] toolCallIntent 自检失败"
);
console.assert(
  prefixLineNumbers("a\nb", 10).startsWith(" 10 │"),
  "[app] prefixLineNumbers 自检失败"
);
console.assert(
  formatTextWithLineNumbers("880|aaa\n881|bbb", 1).includes("880 │"),
  "[app] formatTextWithLineNumbers 嵌入行号自检失败"
);
console.assert(getToolStartLine({ rawInput: { offset: 880 } }) === 880, "[app] getToolStartLine offset 自检失败");
console.assert(formatLineRange(10, 3) === "L10-12", "[app] formatLineRange 自检失败");
console.assert(
  extractToolFilePath({ toolName: "Read", rawInput: { path: "/proj/src/app.js" } }) === "/proj/src/app.js",
  "[app] extractToolFilePath rawInput 自检失败"
);
console.assert(
  [{ role: "thought" }, { role: "agent" }, { role: "tool" }, { role: "agent" }].map((e) => e.role).join(",") ===
    "thought,agent,tool,agent",
  "[app] 轮次块顺序自检失败"
);
console.assert(
  summarizeToolPart({
    toolName: "StrReplace",
    kind: "edit",
    rawInput: { path: "/proj/utils.js", old_string: "a\nb", new_string: "a\nc", offset: 10 },
  }).includes("utils.js") && summarizeToolPart({
    toolName: "StrReplace",
    kind: "edit",
    rawInput: { path: "/proj/utils.js", old_string: "a\nb", new_string: "a\nc", offset: 10 },
  }).includes("L10"),
  "[app] summarizeToolPart edit 自检失败"
);
console.assert(
  summarizeToolPart({ toolName: "Read", kind: "read", rawInput: { path: "/proj/app.js", limit: 5, offset: 10 } }).includes(
    "L10-14"
  ),
  "[app] summarizeToolPart read 自检失败"
);
console.assert(
  summarizeToolPart({
    toolName: "Shell",
    kind: "execute",
    rawInput: { command: "git status", description: "check git" },
  }) === "终端 · check git",
  "[app] summarizeToolPart shell 自检失败"
);
console.assert(
  summarizeToolPart({ kind: "read", title: "Read: public/app.js" }).includes("app.js"),
  "[app] summarizeToolPart title path 自检失败"
);
console.assert(
  pickBestToolPartForSummary({
    data: { kind: "read", rawInput: { description: "x" } },
    mergedParts: [{ kind: "read", rawInput: { path: "/p/a.js" } }],
    toolCallIds: new Set(),
  }).rawInput?.path === "/p/a.js",
  "[app] pickBestToolPartForSummary 自检失败"
);
console.assert(
  segmentTurnEntriesForRestore([
    { role: "tool", text: "", meta: { toolCallId: "a" } },
    { role: "tool", text: "", meta: { toolCallId: "b" } },
    { role: "agent", text: "ok" },
  ]).length === 2 &&
    segmentTurnEntriesForRestore([
      { role: "tool", text: "", meta: { toolCallId: "a" } },
      { role: "tool", text: "", meta: { toolCallId: "b" } },
      { role: "agent", text: "ok" },
    ])[0].toolMetas?.length === 2,
  "[app] segmentTurnEntriesForRestore 自检失败"
);
(function toolGroupRenderSelfCheck() {
  const c1 = createToolBlockEntry({
    toolName: "Read",
    kind: "read",
    rawInput: { path: "/proj/a.js", limit: 3, offset: 1 },
  });
  const c2 = createToolBlockEntry({
    toolName: "Grep",
    kind: "search",
    rawInput: { pattern: "foo" },
  });
  const group = createToolGroupEntry(c1);
  c2.parentGroup = group;
  group.children.push(c2);
  renderToolGroup(group);
  const html = group.body.innerHTML;
  console.assert(
    (html.match(/tool-group-row/g) || []).length === 2 && !html.includes("tool-diff-line"),
    "[app] renderToolGroup 自检失败"
  );
})();

restoreHistory();
connectWs();
syncMessagesBottomPadding();
syncFileExplorerLayout();
window.addEventListener("resize", () => {
  syncMessagesBottomPadding();
  syncFileExplorerLayout();
});
WIDE_LAYOUT_MQ.addEventListener("change", syncFileExplorerLayout);

// ponytail: 移动端锁屏/切网恢复后立即 hello 或重连，减少漏事件窗口
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  console.log("[app] 页面可见，检查 WS 连接");
  reconnectOrHello();
});

window.addEventListener("online", () => {
  console.log("[app] 网络恢复");
  reconnectOrHello();
});

console.log("[app] Cursor 移动桥接前端已加载");

// #endregion
