/**
 * @file acp/eventLog.js
 * @description WS 事件序号化环形缓冲 — 纯函数，供 server 与自检复用
 */

/** 需写入事件日志的消息类型 */
export const TURN_EVENT_TYPES = new Set([
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

/** ponytail: 环形缓冲上限；超出后最旧事件被裁掉，客户端 lastSeq 过旧则回退全量 sync */
export const EVENT_LOG_MAX = 1500;

/**
 * 裁剪事件日志，保留最近 max 条
 * @param {Array<Record<string, unknown>>} eventLog
 * @param {number} [max]
 * @returns {Array<Record<string, unknown>>}
 */
export function trimEventLog(eventLog, max = EVENT_LOG_MAX) {
  if (eventLog.length <= max) return eventLog;
  return eventLog.slice(eventLog.length - max);
}

/**
 * 事件日志中最旧 seq
 * @param {Array<Record<string, unknown>>} eventLog
 * @returns {number}
 */
export function oldestSeq(eventLog) {
  if (eventLog.length === 0) return 0;
  const first = eventLog[0];
  return typeof first?.seq === "number" ? first.seq : 0;
}

/**
 * 事件日志中最新 seq
 * @param {Array<Record<string, unknown>>} eventLog
 * @returns {number}
 */
export function latestSeq(eventLog) {
  if (eventLog.length === 0) return 0;
  const last = eventLog[eventLog.length - 1];
  return typeof last?.seq === "number" ? last.seq : 0;
}

/**
 * 判断是否可增量 replay（epoch 一致且 lastSeq 仍在缓冲窗口内）
 * @param {Array<Record<string, unknown>>} eventLog
 * @param {number | null} clientEpoch
 * @param {number} serverEpoch
 * @param {number} lastSeq
 * @returns {boolean}
 */
export function canReplayIncremental(eventLog, clientEpoch, serverEpoch, lastSeq) {
  if (clientEpoch !== serverEpoch) return false;
  if (lastSeq <= 0) return false;
  if (eventLog.length === 0) return true;
  return lastSeq >= oldestSeq(eventLog);
}

/**
 * 构建增量 replay 事件列表（seq > fromSeq）
 * @param {Array<Record<string, unknown>>} eventLog
 * @param {number} fromSeq
 * @returns {Array<Record<string, unknown>>}
 */
export function buildReplay(eventLog, fromSeq) {
  return eventLog.filter((entry) => {
    const seq = entry.seq;
    return typeof seq === "number" && seq > fromSeq;
  });
}

/**
 * 从 lastUserSeq 起切片当前轮次事件（供全量 sync 快照）
 * @param {Array<Record<string, unknown>>} eventLog
 * @param {number} lastUserSeq
 * @returns {Array<Record<string, unknown>>}
 */
export function buildCurrentTurnEvents(eventLog, lastUserSeq) {
  if (lastUserSeq <= 0) return [];
  return eventLog.filter((entry) => {
    const seq = entry.seq;
    return typeof seq === "number" && seq >= lastUserSeq;
  });
}

/**
 * 分配 seq 并写入事件日志（纯函数，返回新 state + event）
 * @param {object} state
 * @param {number} state.nextSeq
 * @param {number} state.epoch
 * @param {Array<Record<string, unknown>>} state.eventLog
 * @param {number} state.lastUserSeq
 * @param {number | null} state.turnStartedAt
 * @param {Record<string, unknown> | null} state.pendingAskQuestion
 * @param {Record<string, unknown>} msg
 * @returns {{ event: Record<string, unknown> | null, state: typeof state }}
 */
export function appendEventToLog(state, msg) {
  const type = String(msg.type ?? "");
  if (!TURN_EVENT_TYPES.has(type)) {
    return { event: null, state };
  }

  const seq = state.nextSeq;
  /** @type {Record<string, unknown>} */
  const copy = JSON.parse(JSON.stringify(msg));
  copy.seq = seq;
  copy.epoch = state.epoch;

  let eventLog = [...state.eventLog, copy];
  eventLog = trimEventLog(eventLog);

  let lastUserSeq = state.lastUserSeq;
  let turnStartedAt = state.turnStartedAt;
  let pendingAskQuestion = state.pendingAskQuestion;

  if (type === "user_message") {
    lastUserSeq = seq;
    turnStartedAt = Date.now();
    pendingAskQuestion = null;
    console.log(`[eventLog] 新 user_message seq=${seq}`);
  }

  if (type === "ask_question") {
    pendingAskQuestion = {
      id: copy.id,
      questions: copy.questions,
      title: copy.title,
    };
    console.log(`[eventLog] ask_question seq=${seq} id=${String(copy.id)}`);
  }

  if (type === "done" || type === "error" || type === "cancelled") {
    turnStartedAt = null;
    console.log(`[eventLog] 终端事件 ${type} seq=${seq} logLen=${eventLog.length}`);
  }

  return {
    event: copy,
    state: {
      nextSeq: seq + 1,
      epoch: state.epoch,
      eventLog,
      lastUserSeq,
      turnStartedAt,
      pendingAskQuestion,
    },
  };
}
