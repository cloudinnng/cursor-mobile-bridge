/**
 * @file acp/toolEnricher.js
 * @description 从 Cursor 本地 store.db 补全 ACP 流里缺失的 tool rawInput（Cursor 已知 bug）
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const LOG_PREFIX = "[toolEnricher]";

/** @type {Map<string, string | null>} sessionId -> store.db 路径缓存 */
const storePathCache = new Map();

/** @type {Map<string, { args?: Record<string, unknown>, toolName?: string, result?: string } | null>} */
const toolCallCache = new Map();

/**
 * 解码 store.db blobs.data（Cursor 存为逗号分隔字节或 UTF-8 文本）
 * @param {unknown} raw
 * @returns {string}
 */
export function decodeBlobData(raw) {
  if (raw == null) return "";
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  const text = String(raw);
  if (/^\d+(,\d+)*$/.test(text)) {
    return Buffer.from(text.split(",").map((n) => Number(n))).toString("utf8");
  }
  return text;
}

/**
 * 定位 session 对应的 store.db
 * @param {string} sessionId
 * @param {string} [cursorDir]
 * @returns {string | null}
 */
export function findSessionStorePath(sessionId, cursorDir = join(homedir(), ".cursor")) {
  const cached = storePathCache.get(sessionId);
  if (cached !== undefined) return cached;

  const flat = join(cursorDir, "acp-sessions", sessionId, "store.db");
  if (existsSync(flat)) {
    storePathCache.set(sessionId, flat);
    return flat;
  }

  const chatsDir = join(cursorDir, "chats");
  if (existsSync(chatsDir)) {
    for (const hash of readdirSync(chatsDir)) {
      const legacy = join(chatsDir, hash, sessionId, "store.db");
      if (existsSync(legacy)) {
        storePathCache.set(sessionId, legacy);
        return legacy;
      }
    }
  }

  storePathCache.set(sessionId, null);
  return null;
}

/**
 * 从 blob 文本中提取 tool-call JSON
 * @param {string} text
 * @param {string} toolCallId
 * @returns {{ toolCallId?: string, toolName?: string, args?: Record<string, unknown> } | null}
 */
export function extractToolCallFromBlob(text, toolCallId) {
  const needle = `"toolCallId":"${toolCallId}"`;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const idx = text.indexOf(needle, searchFrom);
    if (idx < 0) return null;

    const start = text.lastIndexOf('{"type":"tool-call"', idx);
    if (start < 0) {
      searchFrom = idx + needle.length;
      continue;
    }

    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const obj = /** @type {{ type?: string, toolCallId?: string, toolName?: string, args?: Record<string, unknown> }} */ (
              JSON.parse(text.slice(start, i + 1))
            );
            if (obj.type === "tool-call" && obj.toolCallId === toolCallId && obj.args) {
              return obj;
            }
          } catch {
            // ponytail: blob 里可能夹二进制，解析失败就继续搜下一个
          }
          break;
        }
      }
    }

    searchFrom = idx + needle.length;
  }

  return null;
}

/**
 * rawInput 是否有实质参数
 * @param {unknown} rawInput
 * @returns {boolean}
 */
export function hasToolRawInput(rawInput) {
  return !!rawInput && typeof rawInput === "object" && Object.keys(rawInput).length > 0;
}

/** 可驱动工具执行的动作字段（description  alone 不算） */
const ACTIONABLE_RAW_INPUT_KEYS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "command",
  "pattern",
  "glob_pattern",
  "query",
  "old_string",
  "new_string",
  "contents",
];

/**
 * rawInput 是否含路径/命令等动作参数（非仅 description）
 * @param {unknown} rawInput
 * @returns {boolean}
 */
export function hasActionableToolRawInput(rawInput) {
  if (!rawInput || typeof rawInput !== "object") return false;
  const obj = /** @type {Record<string, unknown>} */ (rawInput);
  return ACTIONABLE_RAW_INPUT_KEYS.some((key) => {
    const val = obj[key];
    if (typeof val === "string") return val.trim() !== "";
    return val != null;
  });
}

/**
 * 从 store.db 查找 tool 参数（带简单重试，等 Cursor 落盘）
 * @param {string} sessionId
 * @param {string} toolCallId
 * @param {{ timeoutMs?: number, cursorDir?: string }} [options]
 * @returns {Promise<{ toolName?: string, args?: Record<string, unknown> } | null>}
 */
export async function lookupToolCall(sessionId, toolCallId, options = {}) {
  const cacheKey = `${sessionId}:${toolCallId}`;
  if (toolCallCache.has(cacheKey)) {
    return toolCallCache.get(cacheKey) ?? null;
  }

  const timeoutMs = options.timeoutMs ?? 2500;
  const deadline = Date.now() + timeoutMs;
  let delayMs = 80;

  while (Date.now() < deadline) {
    const dbPath = findSessionStorePath(sessionId, options.cursorDir);
    if (dbPath) {
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        const rows = db.prepare("SELECT data FROM blobs").all();
        for (const row of rows) {
          const text = decodeBlobData(row.data);
          const found = extractToolCallFromBlob(text, toolCallId);
          if (found?.args) {
            const result = { toolName: found.toolName, args: found.args };
            toolCallCache.set(cacheKey, result);
            console.log(
              `${LOG_PREFIX} 补全 toolCallId=${toolCallId} toolName=${found.toolName} argsKeys=${Object.keys(found.args).join(",")}`
            );
            return result;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG_PREFIX} 读取 store.db 失败: ${message}`);
      }
    }

    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(delayMs * 1.6, 400);
  }

  console.log(`${LOG_PREFIX} 未找到 toolCallId=${toolCallId} 参数（timeout=${timeoutMs}ms）`);
  return null;
}

/**
 * 补全 tool update 里空的 rawInput / 泛化 title
 * @param {string | null | undefined} sessionId
 * @param {Record<string, unknown>} update
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function enrichToolUpdate(sessionId, update, options = {}) {
  if (!sessionId || !update?.toolCallId) return update;

  const toolCallId = String(update.toolCallId);
  const found = await lookupToolCall(sessionId, toolCallId, options);
  if (!found?.args) return update;

  const prev =
    update.rawInput && typeof update.rawInput === "object"
      ? /** @type {Record<string, unknown>} */ (update.rawInput)
      : {};
  const lineRangeKeys = ["offset", "limit", "start_line", "end_line", "line", "startLine", "endLine"];
  const needsRange = lineRangeKeys.some((key) => found.args[key] != null && prev[key] == null);
  // ponytail: 仅有 description 时仍从 store.db 补 path/command
  if (hasActionableToolRawInput(update.rawInput) && !needsRange) return update;

  /** @type {Record<string, unknown>} */
  const rawInput = { ...found.args, ...prev };
  for (const key of Object.keys(found.args)) {
    if (prev[key] == null && found.args[key] != null) rawInput[key] = found.args[key];
  }

  const genericTitles = new Set([
    "Read File",
    "Write File",
    "Edit File",
    "Read",
    "Write",
    "Grep",
    "Glob",
    "MCP: tool",
    "工具调用",
  ]);
  const title = typeof update.title === "string" ? update.title : "";
  let nextTitle = title;
  if (!title || genericTitles.has(title)) {
    if (typeof found.args.path === "string") {
      nextTitle = `${found.toolName ?? "Read"}: ${found.args.path}`;
    } else if (typeof found.args.file_path === "string") {
      nextTitle = `${found.toolName ?? "Read"}: ${found.args.file_path}`;
    } else if (typeof found.args.target_file === "string") {
      nextTitle = `${found.toolName ?? "Edit"}: ${found.args.target_file}`;
    } else if (typeof found.args.command === "string") {
      nextTitle = `${found.toolName ?? "Shell"}: ${found.args.command}`;
    } else if (typeof found.args.glob_pattern === "string") {
      nextTitle = `${found.toolName ?? "Glob"}: ${found.args.glob_pattern}`;
    } else if (typeof found.args.pattern === "string") {
      nextTitle = `${found.toolName ?? "Grep"}: ${found.args.pattern}`;
    } else {
      nextTitle = found.toolName ?? title;
    }
  }

  return {
    ...update,
    title: nextTitle,
    rawInput,
    toolName: found.toolName ?? update.toolName,
  };
}

// ponytail: 最小自检 — blob 内嵌 tool-call JSON 提取
console.assert(
  extractToolCallFromBlob(
    'x{"type":"tool-call","toolCallId":"t1","toolName":"Read","args":{"path":"/a.txt"}}y',
    "t1"
  )?.args?.path === "/a.txt",
  "[toolEnricher] extractToolCallFromBlob 自检失败"
);
console.assert(
  hasToolRawInput({ description: "read file" }) && !hasActionableToolRawInput({ description: "read file" }),
  "[toolEnricher] hasActionableToolRawInput 自检失败"
);
