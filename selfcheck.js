/**
 * @file selfcheck.js
 * @description 冒烟自检 — 验证 ACP 客户端整条链路可用
 * 用法: npm run selfcheck
 */

import { AcpClient } from "./acp/acpClient.js";

const LOG_PREFIX = "[selfcheck]";
const TIMEOUT_MS = 60_000;

/**
 * 带超时的 Promise
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms)
    ),
  ]);
}

async function main() {
  console.log(`${LOG_PREFIX} 开始冒烟自检...`);

  const client = new AcpClient();
  let gotMessage = false;
  let gotDone = false;

  client.on("message", (data) => {
    console.log(`${LOG_PREFIX} 收到 message chunk: "${data.text?.slice(0, 40)}..."`);
    gotMessage = true;
  });

  client.on("thought", (data) => {
    console.log(`${LOG_PREFIX} 收到 thought chunk: "${data.text?.slice(0, 40)}..."`);
  });

  client.on("done", (data) => {
    console.log(`${LOG_PREFIX} 收到 done stopReason=${data.stopReason}`);
    gotDone = true;
  });

  client.on("error", (data) => {
    console.error(`${LOG_PREFIX} 收到 error: ${data.message}`);
  });

  try {
    // 1. 启动
    await withTimeout(client.start(), 30_000, "start");
    console.log(`${LOG_PREFIX} ✓ start 成功 sessionId=${client.sessionId}`);

    // 2. 验证 models/modes
    if (client.models.length === 0) {
      throw new Error("models 列表为空");
    }
    console.log(`${LOG_PREFIX} ✓ models 数量=${client.models.length}`);

    if (client.modes.length === 0) {
      throw new Error("modes 列表为空");
    }
    console.log(`${LOG_PREFIX} ✓ modes 数量=${client.modes.length}`);

    // 3. 切换模式
    await client.setMode("ask");
    console.log(`${LOG_PREFIX} ✓ setMode(ask) 成功`);

    // 4. 发送 prompt
    await withTimeout(
      client.prompt("用一句话说你好，不要调用任何工具。"),
      TIMEOUT_MS,
      "prompt"
    );

    // 5. 断言
    if (!gotMessage) {
      throw new Error("未收到任何 agent_message_chunk");
    }
    console.log(`${LOG_PREFIX} ✓ 收到 agent 回复`);

    if (!gotDone) {
      throw new Error("未收到 done 事件");
    }
    console.log(`${LOG_PREFIX} ✓ 收到 done 事件`);

    console.log(`\n${LOG_PREFIX} ===== 全部检查通过 =====\n`);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n${LOG_PREFIX} ===== 检查失败: ${message} =====\n`);
    process.exit(1);
  } finally {
    client.stop();
  }
}

main();
