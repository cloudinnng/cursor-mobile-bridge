/**
 * @file server.js
 * @description HTTP 静态服务 + WebSocket 桥接 — 连接移动端前端与 ACP 客户端
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { AcpClient, WORKSPACE_DIR } from "./acp/acpClient.js";
import { enrichToolUpdate, hasToolRawInput } from "./acp/toolEnricher.js";
import { browseDirectory, resolveDirPath, formatPathForDisplay, listWorkspaceContents, readWorkspaceFile } from "./fs/dirBrowser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const WORKSPACE_CONFIG_PATH = path.join(__dirname, ".workspace.json");
const PORT = Number(process.env.PORT) || 3456;
const LOG_PREFIX = "[server]";

/** @type {Set<WebSocket>} 已连接的 WebSocket 客户端 */
const clients = new Set();

/** @type {AcpClient | null} */
let acpClient = null;

/** @type {boolean} 是否正在处理 prompt（防止并发） */
let promptInFlight = false;

/** @type {boolean} 是否正在切换工作空间 */
let workspaceSwitchInFlight = false;

/** @type {Array<Record<string, unknown>>} 当前轮次事件缓冲（重连时回放） */
let turnEventBuffer = [];

/** @type {number | null} 当前轮次开始时间戳（ms） */
let turnStartedAt = null;

/** @type {Record<string, unknown> | null} 挂起的 ask_question */
let pendingAskQuestion = null;

/** 需写入轮次缓冲的消息类型 */
const TURN_EVENT_TYPES = new Set([
  "user_message",
  "thought",
  "message",
  "tool",
  "plan",
  "todos",
  "task",
  "generate_image",
  "done",
  "error",
  "cancelled",
  "ask_question",
]);

/** 单张图片 base64 最大字节数（约 4MB） */
const MAX_IMAGE_BASE64_LEN = 4 * 1024 * 1024;

/** 单次 prompt 最多图片数 */
const MAX_IMAGES_PER_PROMPT = 4;

/** 允许的图片 MIME 类型 */
const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// #region 工作空间配置

/**
 * 从配置文件或环境变量读取工作空间路径
 * @returns {string}
 */
function loadWorkspaceDir() {
  if (process.env.WORKSPACE_DIR) {
    const envDir = path.resolve(process.env.WORKSPACE_DIR);
    console.log(`${LOG_PREFIX} 使用环境变量 WORKSPACE_DIR=${envDir}`);
    return envDir;
  }

  try {
    const raw = fs.readFileSync(WORKSPACE_CONFIG_PATH, "utf8");
    const config = /** @type {{ workspaceDir?: string }} */ (JSON.parse(raw));
    if (config.workspaceDir) {
      const saved = path.resolve(config.workspaceDir);
      if (fs.existsSync(saved) && fs.statSync(saved).isDirectory()) {
        console.log(`${LOG_PREFIX} 读取已保存工作空间 ${saved}`);
        return saved;
      }
      console.warn(`${LOG_PREFIX} 已保存工作空间无效，回退默认: ${saved}`);
    }
  } catch {
    // ponytail: 配置文件不存在或损坏时使用默认目录
  }

  return WORKSPACE_DIR;
}

/**
 * 持久化工作空间路径
 * @param {string} workspaceDir
 */
function saveWorkspaceDir(workspaceDir) {
  fs.writeFileSync(
    WORKSPACE_CONFIG_PATH,
    JSON.stringify({ workspaceDir: path.resolve(workspaceDir) }, null, 2),
    "utf8"
  );
  console.log(`${LOG_PREFIX} 工作空间已保存 ${workspaceDir}`);
}

/**
 * 构建 init 消息 payload
 * @returns {Record<string, unknown>}
 */
function buildInitPayload() {
  if (!acpClient) return { type: "init" };
  return {
    type: "init",
    sessionId: acpClient.sessionId,
    models: acpClient.models,
    modes: acpClient.modes,
    currentModel: acpClient.currentModel,
    currentMode: acpClient.currentMode,
    workspace: acpClient.workspaceDir,
    workspaceDisplay: formatPathForDisplay(acpClient.workspaceDir),
  };
}

/**
 * 构建重连 sync 消息 — init 字段 + 当前轮次完整快照
 * @returns {Record<string, unknown>}
 */
function buildSyncPayload() {
  const base = buildInitPayload();
  return {
    ...base,
    type: "sync",
    promptInFlight,
    turnStartedAt: promptInFlight ? turnStartedAt : null,
    turnEvents: [...turnEventBuffer],
    pendingAsk: pendingAskQuestion,
    workspaceSwitchInFlight,
  };
}

/**
 * 记录轮次事件（供 WS 断线重连后回放）
 * @param {Record<string, unknown>} msg
 */
function recordTurnEvent(msg) {
  const type = String(msg.type ?? "");
  if (!TURN_EVENT_TYPES.has(type)) return;

  /** @type {Record<string, unknown>} */
  const copy = JSON.parse(JSON.stringify(msg));

  if (type === "user_message") {
    turnEventBuffer = [copy];
    turnStartedAt = Date.now();
    pendingAskQuestion = null;
    console.log(`${LOG_PREFIX} 轮次缓冲: 新 user_message`);
    return;
  }

  if (turnEventBuffer.length === 0) return;

  // ponytail: 连续 thought chunk 合并为一条，减小 sync 快照体积
  if (type === "thought") {
    const text = String(copy.text ?? "");
    if (!text) return;
    const last = turnEventBuffer[turnEventBuffer.length - 1];
    if (last?.type === "thought") {
      last.text = String(last.text ?? "") + text;
      console.log(`${LOG_PREFIX} 轮次缓冲: 合并 thought chunk +${text.length}`);
      return;
    }
    turnEventBuffer.push({ type: "thought", text });
    return;
  }

  // ponytail: 同一 toolCallId 的补全更新覆盖缓冲中的旧条目，避免重连后重复渲染
  if (type === "tool") {
    const update = /** @type {{ toolCallId?: string }} */ (copy.update ?? {});
    const toolCallId = update.toolCallId;
    if (toolCallId) {
      for (let i = turnEventBuffer.length - 1; i >= 0; i--) {
        const entry = turnEventBuffer[i];
        if (entry.type !== "tool") continue;
        const prevUpdate = /** @type {{ toolCallId?: string }} */ (entry.update ?? {});
        if (prevUpdate.toolCallId === toolCallId) {
          turnEventBuffer[i] = copy;
          console.log(`${LOG_PREFIX} 轮次缓冲: 更新 tool toolCallId=${toolCallId}`);
          return;
        }
      }
    }
  }

  turnEventBuffer.push(copy);

  if (type === "ask_question") {
    pendingAskQuestion = {
      id: copy.id,
      questions: copy.questions,
      title: copy.title,
    };
    console.log(`${LOG_PREFIX} 轮次缓冲: ask_question id=${String(copy.id)}`);
  }

  if (type === "done" || type === "error" || type === "cancelled") {
    turnStartedAt = null;
    console.log(`${LOG_PREFIX} 轮次缓冲: 终端事件 ${type}，条数=${turnEventBuffer.length}`);
  }
}

// #endregion

// #region 静态文件服务

/** MIME 类型映射 */
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * 提供 public/ 目录静态文件
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function serveStatic(req, res) {
  let urlPath = req.url?.split("?")[0] ?? "/";
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(PUBLIC_DIR, urlPath);

  // 防止路径穿越
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
    res.end(data);
  });
}

// #endregion

// #region WebSocket 广播

/**
 * 向所有已连接客户端广播 JSON 消息
 * @param {Record<string, unknown>} msg
 */
function broadcast(msg) {
  recordTurnEvent(msg);
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * 向单个客户端发送 JSON 消息
 * @param {WebSocket} ws
 * @param {Record<string, unknown>} msg
 */
function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// #endregion

// #region ACP 事件订阅

/**
 * 订阅 acpClient 事件并广播到所有 WS 客户端
 * @param {AcpClient} client
 */
function wireAcpEvents(client) {
  client.on("thought", (data) => broadcast({ type: "thought", ...data }));
  client.on("message", (data) => broadcast({ type: "message", ...data }));
  client.on("tool", (data) => {
    const update = /** @type {Record<string, unknown>} */ (data.update ?? {});
    broadcast({ type: "tool", update });

    // ponytail: Cursor ACP 常发空 rawInput 或丢失 offset/limit，从 store.db 补全后再推
    void enrichToolUpdate(client.sessionId, update, { timeoutMs: 3000 }).then((enriched) => {
      const enrichedInput = enriched.rawInput;
      const hadInput = hasToolRawInput(update.rawInput);
      const gotInput = hasToolRawInput(enrichedInput);
      if (!gotInput && hadInput) return;
      if (gotInput && hadInput && JSON.stringify(enrichedInput) === JSON.stringify(update.rawInput)) return;
      console.log(`${LOG_PREFIX} tool 参数已补全 toolCallId=${enriched.toolCallId}`);
      broadcast({ type: "tool", update: enriched });
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} tool 参数补全失败: ${message}`);
    });
  });
  client.on("plan", (data) => broadcast({ type: "plan", ...data }));
  client.on("todos", (data) => broadcast({ type: "todos", ...data }));
  client.on("task", (data) => broadcast({ type: "task", ...data }));
  client.on("generate_image", (data) => broadcast({ type: "generate_image", ...data }));
  client.on("done", (data) => {
    promptInFlight = false;
    broadcast({ type: "done", ...data });
  });
  client.on("error", (data) => {
    promptInFlight = false;
    broadcast({ type: "error", ...data });
  });

  client.on("ask_question", (data) => {
    broadcast({ type: "ask_question", ...data });
  });

  client.on("ready", () => {
    broadcast(buildSyncPayload());
  });
}

/**
 * 校验并规范化前端传来的图片数组
 * @param {unknown} raw
 * @returns {Array<{ mimeType: string, data: string }>}
 */
function normalizePromptImages(raw) {
  if (!Array.isArray(raw)) return [];

  /** @type {Array<{ mimeType: string, data: string }>} */
  const images = [];
  for (const item of raw) {
    if (images.length >= MAX_IMAGES_PER_PROMPT) break;
    if (!item || typeof item !== "object") continue;

    const mimeType = String(/** @type {{ mimeType?: unknown }} */ (item).mimeType ?? "").trim();
    let data = String(/** @type {{ data?: unknown }} */ (item).data ?? "").trim();
    // ponytail: 兼容前端误传 data URL 前缀
    const dataUrlMatch = /^data:[^;]+;base64,(.+)$/i.exec(data);
    if (dataUrlMatch) data = dataUrlMatch[1];

    if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
      throw new Error(`不支持的图片类型: ${mimeType || "(空)"}`);
    }
    if (!data || data.length > MAX_IMAGE_BASE64_LEN) {
      throw new Error("图片数据无效或过大");
    }

    images.push({ mimeType, data });
  }
  return images;
}

// #endregion

// #region WebSocket 消息处理

/**
 * 处理前端发来的 WebSocket 消息
 * @param {WebSocket} ws
 * @param {Buffer} raw
 */
async function handleWsMessage(ws, raw) {
  /** @type {{ type: string, text?: string, modeId?: string, modelId?: string, id?: number, answer?: unknown, path?: string }} */
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    sendTo(ws, { type: "error", message: "无效 JSON" });
    return;
  }

  try {
    switch (msg.type) {
      // 目录浏览不依赖 ACP 就绪
      case "browse_dir": {
        const listing = browseDirectory(msg.path);
        sendTo(ws, {
          type: "dir_listing",
          ...listing,
          currentWorkspace: acpClient?.workspaceDir ?? null,
        });
        console.log(`${LOG_PREFIX} browse_dir path=${listing.path || "(roots)"} entries=${listing.entries.length}`);
        break;
      }

      case "browse_workspace": {
        if (!acpClient) {
          sendTo(ws, { type: "error", message: "ACP 尚未初始化" });
          return;
        }
        try {
          const listing = listWorkspaceContents(acpClient.workspaceDir, msg.path);
          sendTo(ws, {
            type: "workspace_listing",
            ...listing,
          });
          console.log(
            `${LOG_PREFIX} browse_workspace rel=${listing.relativePath || "/"} entries=${listing.entries.length}`
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendTo(ws, { type: "error", message });
        }
        break;
      }

      case "read_workspace_file": {
        if (!acpClient) {
          sendTo(ws, { type: "error", message: "ACP 尚未初始化" });
          return;
        }
        try {
          const fileContent = readWorkspaceFile(acpClient.workspaceDir, msg.path ?? "");
          sendTo(ws, {
            type: "workspace_file_content",
            ...fileContent,
          });
          console.log(`${LOG_PREFIX} read_workspace_file rel=${fileContent.relativePath}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendTo(ws, { type: "error", message });
        }
        break;
      }

      case "set_workspace": {
        if (!msg.path?.trim()) {
          sendTo(ws, { type: "error", message: "未指定工作空间路径" });
          return;
        }
        if (promptInFlight) {
          sendTo(ws, { type: "error", message: "请先取消当前任务再切换工作空间" });
          return;
        }
        if (workspaceSwitchInFlight) {
          sendTo(ws, { type: "error", message: "工作空间切换进行中，请稍候" });
          return;
        }
        if (!acpClient) {
          sendTo(ws, { type: "error", message: "ACP 尚未初始化" });
          return;
        }

        let resolved;
        try {
          resolved = resolveDirPath(msg.path);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendTo(ws, { type: "error", message });
          return;
        }

        if (path.resolve(resolved) === path.resolve(acpClient.workspaceDir)) {
          sendTo(ws, { type: "workspace_changed", ...buildSyncPayload() });
          console.log(`${LOG_PREFIX} set_workspace 已是当前目录，跳过重启`);
          return;
        }

        workspaceSwitchInFlight = true;
        broadcast({ type: "workspace_switching", workspace: resolved });
        console.log(`${LOG_PREFIX} 切换工作空间 -> ${resolved}`);

        try {
          await acpClient.setWorkspace(resolved);
          saveWorkspaceDir(resolved);
          fs.mkdirSync(resolved, { recursive: true });
          turnEventBuffer = [];
          turnStartedAt = null;
          pendingAskQuestion = null;
          promptInFlight = false;
          broadcast(buildSyncPayload());
          broadcast({ type: "system", message: `工作空间已切换: ${resolved}` });
        } finally {
          workspaceSwitchInFlight = false;
        }
        break;
      }

      default:
        break;
    }

    // 以下消息需要 ACP 就绪
    if (msg.type === "browse_dir" || msg.type === "set_workspace" || msg.type === "browse_workspace" || msg.type === "read_workspace_file") {
      return;
    }

    if (!acpClient?.isStarted) {
      sendTo(ws, { type: "error", message: "ACP 尚未就绪" });
      return;
    }

    switch (msg.type) {
      case "prompt": {
        if (promptInFlight) {
          sendTo(ws, { type: "error", message: "上一条消息仍在处理中" });
          return;
        }

        const text = msg.text?.trim() ?? "";
        let images;
        try {
          images = normalizePromptImages(msg.images);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendTo(ws, { type: "error", message });
          return;
        }

        if (!text && images.length === 0) return;

        promptInFlight = true;
        console.log(`${LOG_PREFIX} prompt textLen=${text.length} images=${images.length}`);
        broadcast({ type: "user_message", text, images });
        // prompt 异步执行，done/error 事件会重置 promptInFlight
        acpClient.prompt(text, images).catch((err) => {
          promptInFlight = false;
          broadcast({ type: "error", message: err.message });
        });
        break;
      }

      case "set_mode":
        if (msg.modeId) await acpClient.setMode(msg.modeId);
        broadcast({
          type: "mode_changed",
          currentMode: acpClient.currentMode,
        });
        break;

      case "set_model":
        if (msg.modelId) await acpClient.setModel(msg.modelId);
        broadcast({
          type: "model_changed",
          currentModel: acpClient.currentModel,
        });
        break;

      case "cancel":
        acpClient.cancel();
        promptInFlight = false;
        pendingAskQuestion = null;
        broadcast({ type: "cancelled" });
        break;

      case "new_session":
        turnEventBuffer = [];
        turnStartedAt = null;
        pendingAskQuestion = null;
        promptInFlight = false;
        await acpClient.newSession();
        break;

      case "answer_question":
        if (msg.id !== undefined && msg.answer !== undefined) {
          pendingAskQuestion = null;
          acpClient.answerQuestion(msg.id, msg.answer);
        }
        break;

      default:
        console.warn(`${LOG_PREFIX} 未知 WS 消息类型: ${msg.type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} 处理 WS 消息失败:`, message);
    sendTo(ws, { type: "error", message });
  }
}

// #endregion

// #region 启动

/**
 * 获取局域网 IPv4 地址列表
 * @returns {string[]}
 */
function getLanAddresses() {
  const addrs = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addrs.push(iface.address);
      }
    }
  }
  return addrs;
}

async function main() {
  const initialWorkspace = loadWorkspaceDir();
  fs.mkdirSync(initialWorkspace, { recursive: true });
  console.log(`${LOG_PREFIX} workspace 目录: ${initialWorkspace}`);

  // 启动 ACP 客户端
  acpClient = new AcpClient({ workspaceDir: initialWorkspace });
  wireAcpEvents(acpClient);

  console.log(`${LOG_PREFIX} 正在启动 ACP 客户端...`);
  await acpClient.start();
  console.log(`${LOG_PREFIX} ACP 客户端就绪 sessionId=${acpClient.sessionId}`);

  // HTTP + WebSocket 服务器
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`${LOG_PREFIX} WS 客户端连接，当前 ${clients.size} 个`);

    // 下发完整 sync 快照（init + 当前轮次缓冲）
    sendTo(ws, buildSyncPayload());
    console.log(
      `${LOG_PREFIX} sync 已下发 promptInFlight=${promptInFlight} turnEvents=${turnEventBuffer.length}`
    );

    ws.on("message", (raw) => handleWsMessage(ws, raw));
    ws.on("close", () => {
      clients.delete(ws);
      console.log(`${LOG_PREFIX} WS 客户端断开，剩余 ${clients.size} 个`);
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    const lanAddrs = getLanAddresses();
    console.log(`\n${LOG_PREFIX} ===== Cursor 移动桥接已启动 =====`);
    console.log(`${LOG_PREFIX} 本地访问: http://localhost:${PORT}`);
    for (const addr of lanAddrs) {
      console.log(`${LOG_PREFIX} 局域网访问: http://${addr}:${PORT}`);
    }
    console.log(`${LOG_PREFIX} 工作空间: ${acpClient.workspaceDir}`);
    console.log(`${LOG_PREFIX} ================================\n`);
  });

  // 优雅退出
  process.on("SIGINT", () => {
    console.log(`\n${LOG_PREFIX} 收到 SIGINT，正在关闭...`);
    acpClient?.stop();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`${LOG_PREFIX} 启动失败:`, err);
  process.exit(1);
});

// #endregion
