/**
 * @file acp/acpClient.js
 * @description Cursor Agent ACP 客户端 — 通过 stdio JSON-RPC 与 agent acp 子进程通信
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ modelId: string, name: string }} AcpModel */
/** @typedef {{ id: string, name: string, description?: string }} AcpMode */
/** @typedef {{ id: number, resolve: (msg: JsonRpcResponse) => void, reject: (err: Error) => void }} PendingRequest */
/** @typedef {{ jsonrpc: "2.0", id: number, result?: unknown, error?: { code: number, message: string } }} JsonRpcResponse */
/** @typedef {{ jsonrpc: "2.0", method: string, params?: Record<string, unknown> }} JsonRpcNotification */
/** @typedef {{ jsonrpc: "2.0", id: number, method: string, params?: Record<string, unknown> }} JsonRpcRequest */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_DIR = path.join(PROJECT_ROOT, "workspace");

/** ACP 协议版本 */
const PROTOCOL_VERSION = 1;

/** 日志前缀，便于 grep */
const LOG_PREFIX = "[acpClient]";

/**
 * Cursor Agent ACP 客户端
 * @extends EventEmitter
 * @fires AcpClient#thought - 思考内容块 { text: string }
 * @fires AcpClient#message - 回复内容块 { text: string }
 * @fires AcpClient#tool - 工具调用 { update: object }
 * @fires AcpClient#plan - 计划内容 { plan: string, name?: string }
 * @fires AcpClient#todos - Todo 更新 { todos: Array, merge: boolean }
 * @fires AcpClient#task - 子任务通知 { description: string, prompt: string }
 * @fires AcpClient#ask_question - 需要用户回答 { id: number, questions: Array }
 * @fires AcpClient#done - 本轮 prompt 完成 { stopReason: string }
 * @fires AcpClient#error - 错误 { message: string }
 * @fires AcpClient#ready - 初始化完成 { sessionId, models, modes, currentModel, currentMode }
 */
export class AcpClient extends EventEmitter {
  /** @type {ChildProcessWithoutNullStreams | null} */
  #agentProcess = null;

  /** @type {readline.Interface | null} */
  #readline = null;

  /** @type {number} */
  #nextId = 1;

  /** @type {Map<number, PendingRequest>} */
  #pending = new Map();

  /** @type {string | null} */
  #sessionId = null;

  /** @type {AcpModel[]} */
  #models = [];

  /** @type {AcpMode[]} */
  #modes = [];

  /** @type {string} */
  #currentModel = "";

  /** @type {string} */
  #currentMode = "agent";

  /** @type {Map<number, (answer: unknown) => void>} 挂起的 ask_question 回调 */
  #askQuestionWaiters = new Map();

  /** @type {boolean} */
  #started = false;

  /**
   * @param {object} [options]
   * @param {string} [options.workspaceDir] agent cwd，默认 ./workspace
   * @param {string} [options.agentCommand] agent 可执行文件，默认 agent.cmd (Windows)
   */
  constructor(options = {}) {
    super();
    this.workspaceDir = options.workspaceDir ?? WORKSPACE_DIR;
    this.agentCommand = options.agentCommand ?? "agent.cmd";
    console.log(`${LOG_PREFIX} 构造完成，workspace=${this.workspaceDir}`);
  }

  /** @returns {boolean} 是否已启动 */
  get isStarted() {
    return this.#started;
  }

  /** @returns {string | null} 当前 sessionId */
  get sessionId() {
    return this.#sessionId;
  }

  /** @returns {AcpModel[]} 可用模型列表 */
  get models() {
    return this.#models;
  }

  /** @returns {AcpMode[]} 可用模式列表 */
  get modes() {
    return this.#modes;
  }

  /** @returns {string} 当前模型 id */
  get currentModel() {
    return this.#currentModel;
  }

  /** @returns {string} 当前模式 id */
  get currentMode() {
    return this.#currentMode;
  }

  /**
   * 启动 agent acp 子进程并完成 initialize → authenticate → session/new
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#started) {
      console.log(`${LOG_PREFIX} 已启动，跳过重复 start`);
      return;
    }

    console.log(`${LOG_PREFIX} 启动 agent acp，cwd=${this.workspaceDir}`);

    this.#agentProcess = spawn(this.agentCommand, ["acp"], {
      stdio: ["pipe", "pipe", "inherit"],
      shell: true,
      cwd: this.workspaceDir,
    });

    this.#readline = readline.createInterface({ input: this.#agentProcess.stdout });
    this.#readline.on("line", (line) => this.#handleLine(line));

    this.#agentProcess.on("error", (err) => {
      console.error(`${LOG_PREFIX} 子进程错误:`, err.message);
      this.emit("error", { message: err.message });
    });

    this.#agentProcess.on("exit", (code, signal) => {
      console.log(`${LOG_PREFIX} 子进程退出 code=${code} signal=${signal}`);
      this.#started = false;
    });

    // #region ACP 启动序列
    await this.#send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "cursor-mobile-bridge", version: "1.0.0" },
    });
    console.log(`${LOG_PREFIX} initialize 完成`);

    await this.#send("authenticate", { methodId: "cursor_login" });
    console.log(`${LOG_PREFIX} authenticate 完成`);

    await this.#createSession();
    this.#started = true;

    this.emit("ready", {
      sessionId: this.#sessionId,
      models: this.#models,
      modes: this.#modes,
      currentModel: this.#currentModel,
      currentMode: this.#currentMode,
      workspace: this.workspaceDir,
    });
    // #endregion
  }

  /**
   * 创建新 ACP session
   * @private
   */
  async #createSession() {
    const cwd = this.workspaceDir.replace(/\\/g, "/");
    /** @type {{ result?: { sessionId: string, models?: { currentModelId: string, availableModels: AcpModel[] }, modes?: { currentModeId: string, availableModes: AcpMode[] } } }} */
    const resp = await this.#send("session/new", { cwd, mcpServers: [] });

    if (!resp.result || typeof resp.result !== "object") {
      throw new Error("session/new 未返回有效 result");
    }

    const result = /** @type {{ sessionId: string, models?: { currentModelId: string, availableModels: AcpModel[] }, modes?: { currentModeId: string, availableModes: AcpMode[] } }} */ (resp.result);
    this.#sessionId = result.sessionId;
    console.log(`${LOG_PREFIX} session/new sessionId=${this.#sessionId}`);

    if (result.models) {
      this.#models = result.models.availableModels ?? [];
      this.#currentModel = result.models.currentModelId ?? "";
    }
    if (result.modes) {
      this.#modes = result.modes.availableModes ?? [];
      this.#currentMode = result.modes.currentModeId ?? "agent";
    }
  }

  /**
   * 发送用户 prompt（文本 + 可选图片）
   * @param {string} text 用户输入文本
   * @param {Array<{ mimeType: string, data: string }>} [images] base64 图片块（不含 data: 前缀）
   * @returns {Promise<{ stopReason: string }>}
   */
  async prompt(text, images = []) {
    this.#assertStarted();

    /** @type {Array<Record<string, unknown>>} */
    const promptBlocks = [];
    const trimmed = text.trim();
    if (trimmed) {
      promptBlocks.push({ type: "text", text: trimmed });
    }
    for (const img of images) {
      promptBlocks.push({
        type: "image",
        mimeType: img.mimeType,
        data: img.data,
      });
    }
    if (promptBlocks.length === 0) {
      throw new Error("prompt 内容为空");
    }

    console.log(
      `${LOG_PREFIX} prompt 发送 textLen=${trimmed.length} images=${images.length} blocks=${promptBlocks.length}`
    );

    const resp = await this.#send("session/prompt", {
      sessionId: this.#sessionId,
      prompt: promptBlocks,
    });

    const stopReason = /** @type {{ stopReason?: string }} */ (resp.result ?? {}).stopReason ?? "unknown";
    console.log(`${LOG_PREFIX} prompt 完成 stopReason=${stopReason}`);
    this.emit("done", { stopReason });
    return { stopReason };
  }

  /**
   * 切换 agent 模式 (agent / plan / ask)
   * @param {string} modeId
   */
  async setMode(modeId) {
    this.#assertStarted();
    console.log(`${LOG_PREFIX} setMode modeId=${modeId}`);
    await this.#send("session/set_mode", { sessionId: this.#sessionId, modeId });
    this.#currentMode = modeId;
  }

  /**
   * 切换模型
   * @param {string} modelId 完整 modelId（含方括号参数）
   */
  async setModel(modelId) {
    this.#assertStarted();
    console.log(`${LOG_PREFIX} setModel modelId=${modelId}`);
    await this.#send("session/set_model", { sessionId: this.#sessionId, modelId });
    this.#currentModel = modelId;
  }

  /** 取消当前正在执行的 prompt */
  cancel() {
    this.#assertStarted();
    console.log(`${LOG_PREFIX} cancel sessionId=${this.#sessionId}`);
    // ponytail: ACP 规定 session/cancel 是 notification（无 id），不能用 #send 请求
    this.#notify("session/cancel", { sessionId: this.#sessionId });
  }

  /** 新建 session（保留 agent 子进程） */
  async newSession() {
    this.#assertStarted();
    console.log(`${LOG_PREFIX} newSession`);
    await this.#createSession();
    this.emit("ready", {
      sessionId: this.#sessionId,
      models: this.#models,
      modes: this.#modes,
      currentModel: this.#currentModel,
      currentMode: this.#currentMode,
      workspace: this.workspaceDir,
    });
  }

  /**
   * 切换工作空间 — 重启 agent 子进程并在新 cwd 下创建 session
   * @param {string} newDir 新的工作空间绝对路径
   */
  async setWorkspace(newDir) {
    const resolved = path.resolve(newDir);
    console.log(`${LOG_PREFIX} setWorkspace ${this.workspaceDir} -> ${resolved}`);

    if (this.#started) {
      this.stop();
    }

    this.workspaceDir = resolved;
    await this.start();
  }

  /**
   * 回复 cursor/ask_question
   * @param {number} rpcId JSON-RPC 请求 id
   * @param {unknown} answer 用户选择的答案
   */
  answerQuestion(rpcId, answer) {
    const waiter = this.#askQuestionWaiters.get(rpcId);
    if (waiter) {
      this.#askQuestionWaiters.delete(rpcId);
      waiter(answer);
      console.log(`${LOG_PREFIX} answerQuestion id=${rpcId}`);
    } else {
      console.warn(`${LOG_PREFIX} answerQuestion 找不到挂起请求 id=${rpcId}`);
    }
  }

  /** 停止 agent 子进程 */
  stop() {
    console.log(`${LOG_PREFIX} stop`);
    if (this.#readline) {
      this.#readline.close();
      this.#readline = null;
    }
    if (this.#agentProcess) {
      try {
        this.#agentProcess.stdin.end();
        this.#agentProcess.kill();
      } catch {
        // ponytail: 进程可能已退出，忽略 kill 异常
      }
      this.#agentProcess = null;
    }
    this.#started = false;
  }

  // #region JSON-RPC 底层

  /**
   * 发送 JSON-RPC 通知（无 id，不等待响应）
   * @param {string} method
   * @param {Record<string, unknown>} params
   */
  #notify(method, params) {
    if (!this.#agentProcess?.stdin.writable) {
      throw new Error("agent 子进程 stdin 不可写");
    }
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.#agentProcess.stdin.write(payload);
    console.log(`${LOG_PREFIX} notify method=${method}`);
  }

  /**
   * 发送 JSON-RPC 请求并等待响应
   * @param {string} method
   * @param {Record<string, unknown>} params
   * @returns {Promise<JsonRpcResponse>}
   */
  #send(method, params) {
    const id = this.#nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    return new Promise((resolve, reject) => {
      if (!this.#agentProcess?.stdin.writable) {
        reject(new Error("agent 子进程 stdin 不可写"));
        return;
      }
      this.#pending.set(id, { id, resolve, reject });
      this.#agentProcess.stdin.write(payload);
    });
  }

  /**
   * 回复 JSON-RPC 请求（agent 发来的 method 带 id）
   * @param {number} id
   * @param {unknown} result
   */
  #respond(id, result) {
    if (!this.#agentProcess?.stdin.writable) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
    this.#agentProcess.stdin.write(payload);
  }

  /**
   * 处理 stdout 每一行 JSON
   * @param {string} line
   */
  #handleLine(line) {
    /** @type {JsonRpcResponse | JsonRpcNotification | JsonRpcRequest} */
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.warn(`${LOG_PREFIX} 非 JSON 行: ${line.slice(0, 120)}`);
      return;
    }

    // 响应我们的 outbound 请求
    if ("id" in msg && msg.id !== undefined && ("result" in msg || "error" in msg)) {
      const waiter = this.#pending.get(msg.id);
      if (waiter) {
        this.#pending.delete(msg.id);
        if (msg.error) {
          waiter.reject(new Error(msg.error.message ?? "JSON-RPC error"));
        } else {
          waiter.resolve(/** @type {JsonRpcResponse} */ (msg));
        }
      }
      return;
    }

    // agent 发来的请求（带 id，需回应）
    if ("method" in msg && "id" in msg && msg.id !== undefined) {
      this.#handleAgentRequest(/** @type {JsonRpcRequest} */ (msg));
      return;
    }

    // 通知（无 id）
    if ("method" in msg) {
      this.#handleNotification(/** @type {JsonRpcNotification} */ (msg));
    }
  }

  /**
   * 处理 agent 发来的 JSON-RPC 请求（需回应）
   * @param {JsonRpcRequest} msg
   */
  #handleAgentRequest(msg) {
    const { method, params, id } = msg;

    switch (method) {
      case "session/request_permission":
        this.#handlePermission(id, params);
        break;

      case "cursor/ask_question":
        this.#handleAskQuestion(id, params);
        break;

      case "cursor/create_plan":
        this.#handleCreatePlan(id, params);
        break;

      default:
        console.log(`${LOG_PREFIX} 未处理的 agent 请求: ${method}`);
        this.#respond(id, {});
    }
  }

  /**
   * 处理 agent 通知（无需回应）
   * @param {JsonRpcNotification} msg
   */
  #handleNotification(msg) {
    const { method, params } = msg;

    switch (method) {
      case "session/update":
        this.#handleSessionUpdate(params);
        break;

      case "cursor/update_todos":
        this.emit("todos", {
          todos: params?.todos ?? [],
          merge: params?.merge ?? true,
        });
        break;

      case "cursor/task":
        this.emit("task", {
          description: params?.description ?? "",
          prompt: params?.prompt ?? "",
          subagentType: params?.subagentType,
        });
        break;

      case "cursor/generate_image":
        this.emit("generate_image", {
          description: params?.description ?? "",
          filePath: params?.filePath,
        });
        break;

      default:
        console.log(`${LOG_PREFIX} 未处理的通知: ${method}`);
    }
  }

  /**
   * 从 ACP ContentBlock / 兼容格式中提取文本
   * ponytail: agent 可能发送 string、{text}、{content}、{delta} 等多种格式
   * @param {unknown} content
   * @returns {string}
   */
  #extractChunkText(content) {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (typeof content !== "object") return "";

    const block = /** @type {Record<string, unknown>} */ (content);

    if (typeof block.text === "string") return block.text;
    if (typeof block.content === "string") return block.content;
    if (typeof block.delta === "string") return block.delta;

    // 嵌套 content 对象
    if (block.content && typeof block.content === "object") {
      return this.#extractChunkText(block.content);
    }

    if (Array.isArray(content)) {
      return content.map((item) => this.#extractChunkText(item)).join("");
    }

    return "";
  }

  /**
   * 发送 thought 事件 — 原样转发，归一化/过滤由前端 thoughtRawBuffer 统一处理
   * ponytail: 不在此按 chunk 过滤，避免分隔符与正文跨 chunk 时丢字
   * @param {string} text
   */
  #emitThoughtChunk(text) {
    if (!text) return;
    console.log(`${LOG_PREFIX} thought chunk len=${text.length}`);
    this.emit("thought", { text });
  }

  /**
   * 处理 session/update 流式更新
   * @param {Record<string, unknown> | undefined} params
   */
  #handleSessionUpdate(params) {
    const update = /** @type {{ sessionUpdate?: string, content?: unknown, plan?: string, name?: string, [key: string]: unknown }} */ (params?.update ?? params ?? {});

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = this.#extractChunkText(update.content);
        if (text) {
          this.emit("message", { text });
        }
        break;
      }

      case "agent_thought_chunk":
      case "agent_thought": {
        const text = this.#extractChunkText(update.content);
        if (!text && update.content) {
          console.warn(
            `${LOG_PREFIX} thought content 无法提取文本:`,
            JSON.stringify(update.content).slice(0, 240)
          );
        }
        this.#emitThoughtChunk(text);
        break;
      }

      case "tool_call":
      case "tool_call_update":
      case "tool_call_content_chunk":
        console.log(`${LOG_PREFIX} tool ${update.sessionUpdate} id=${update.toolCallId} status=${update.status ?? "new"}`);
        this.emit("tool", { update });
        break;

      case "plan":
        this.emit("plan", { plan: update.plan ?? "", name: update.name });
        break;

      default: {
        const text = this.#extractChunkText(update.content);
        if (text) {
          // ponytail: 未知 sessionUpdate 但有 text，当作 message 兜底
          this.emit("message", { text });
        }
      }
    }
  }

  /**
   * 自动放行工具权限（优先 allow-always）
   * @param {number} id
   * @param {Record<string, unknown> | undefined} params
   */
  #handlePermission(id, params) {
    const options = /** @type {Array<{ optionId: string }>} */ (params?.options ?? []);
    const allowAlways = options.find((o) => o.optionId === "allow-always");
    const allowOnce = options.find((o) => o.optionId === "allow-once");
    const chosen = allowAlways ?? allowOnce ?? options[0];

    console.log(`${LOG_PREFIX} 自动放行权限 optionId=${chosen?.optionId ?? "none"}`);
    this.#respond(id, {
      outcome: { outcome: "selected", optionId: chosen?.optionId ?? "allow-once" },
    });
  }

  /**
   * 转发 ask_question 到前端，挂起等待用户回答
   * @param {number} id
   * @param {Record<string, unknown> | undefined} params
   */
  #handleAskQuestion(id, params) {
    console.log(`${LOG_PREFIX} ask_question 转发到前端 id=${id}`);
    this.emit("ask_question", { id, questions: params?.questions ?? [], title: params?.title });

    // 挂起，等 answerQuestion 被调用
    this.#askQuestionWaiters.set(id, (answer) => {
      this.#respond(id, answer);
    });
  }

  /**
   * 自动接受 plan
   * @param {number} id
   * @param {Record<string, unknown> | undefined} params
   */
  #handleCreatePlan(id, params) {
    console.log(`${LOG_PREFIX} create_plan 自动接受`);
    this.emit("plan", {
      plan: params?.plan ?? "",
      name: params?.name,
      overview: params?.overview,
      todos: params?.todos,
    });
    this.#respond(id, { outcome: { outcome: "accepted" } });
  }

  /** @throws {Error} 未启动时调用业务方法 */
  #assertStarted() {
    if (!this.#started || !this.#sessionId) {
      throw new Error("AcpClient 尚未 start()");
    }
  }

  // #endregion
}

export { WORKSPACE_DIR, PROJECT_ROOT };
