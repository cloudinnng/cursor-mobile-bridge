/**
 * @file _test_eventlog.mjs
 * @description eventLog 纯函数自检 — seq 分配 / 环形缓冲 / replay / sync 切片
 * 用法: node _test_eventlog.mjs
 */

import {
  EVENT_LOG_MAX,
  trimEventLog,
  oldestSeq,
  latestSeq,
  canReplayIncremental,
  buildReplay,
  buildCurrentTurnEvents,
  appendEventToLog,
} from "./acp/eventLog.js";

// #region trimEventLog

const over = Array.from({ length: EVENT_LOG_MAX + 10 }, (_, i) => ({ seq: i + 1 }));
const trimmed = trimEventLog(over);
console.assert(trimmed.length === EVENT_LOG_MAX, "trim 保留 EVENT_LOG_MAX 条");
console.assert(trimmed[0].seq === 11, "trim 裁掉最旧 10 条");
console.assert(trimmed[trimmed.length - 1].seq === EVENT_LOG_MAX + 10, "trim 保留最新");

// #endregion

// #region appendEventToLog + buildReplay

/** @type {{ nextSeq: number, epoch: number, eventLog: Array<Record<string, unknown>>, lastUserSeq: number, turnStartedAt: number | null, pendingAskQuestion: Record<string, unknown> | null }} */
let state = {
  nextSeq: 1,
  epoch: 1000,
  eventLog: [],
  lastUserSeq: 0,
  turnStartedAt: null,
  pendingAskQuestion: null,
};

/** @param {Record<string, unknown>} msg */
function push(msg) {
  const result = appendEventToLog(state, msg);
  state = result.state;
  return result.event;
}

const u1 = push({ type: "user_message", text: "hi" });
console.assert(u1?.seq === 1, "user_message seq=1");
console.assert(state.lastUserSeq === 1, "lastUserSeq=1");

push({ type: "thought", text: "a" });
push({ type: "thought", text: "b" });
push({ type: "message", text: "hello" });
console.assert(state.eventLog.length === 4, "thought 多 chunk 各自 append 不合并");
console.assert(buildReplay(state.eventLog, 0).length === 4, "replay from 0 得 4 条");

const replayPartial = buildReplay(state.eventLog, 2);
console.assert(replayPartial.length === 2, "replay from seq=2 得 2 条");
console.assert(replayPartial[0].seq === 3 && replayPartial[1].seq === 4, "replay 只含 seq>2");

// #endregion

// #region canReplayIncremental

console.assert(canReplayIncremental(state.eventLog, 1000, 1000, 2), "epoch 一致且 lastSeq 在窗口内");
console.assert(!canReplayIncremental(state.eventLog, 999, 1000, 2), "epoch 不符回退全量");
console.assert(!canReplayIncremental(state.eventLog, 1000, 1000, 0), "lastSeq=0 走全量 sync");

const bigLogRaw = Array.from({ length: EVENT_LOG_MAX + 5 }, (_, i) => ({ seq: i + 1, type: "thought", text: "x" }));
const bigLog = trimEventLog(bigLogRaw);
console.assert(oldestSeq(bigLog) === 6, "裁剪后 oldest seq=6");
console.assert(!canReplayIncremental(bigLog, 1000, 1000, 3), "lastSeq 早于 oldest 不可增量");

// #endregion

// #region buildCurrentTurnEvents

const turnEvents = buildCurrentTurnEvents(state.eventLog, state.lastUserSeq);
console.assert(turnEvents.length === 4, "当前轮从 lastUserSeq 切片");
console.assert(turnEvents[0].type === "user_message", "切片含 user_message");

push({ type: "done", stopReason: "end" });
const turnAfterDone = buildCurrentTurnEvents(state.eventLog, state.lastUserSeq);
console.assert(turnAfterDone.length === 5, "done 也在当前轮切片内");

// #endregion

// #region oldestSeq / latestSeq

console.assert(oldestSeq(state.eventLog) === 1, "oldestSeq");
console.assert(latestSeq(state.eventLog) === state.nextSeq - 1, "latestSeq");

console.log("[eventLog] 全部检查通过");
