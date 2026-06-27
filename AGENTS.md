使用 `start-server.bat` 启动服务器（人工双击 / 首次启动）。脚本会自动请求 **管理员权限（UAC）**；若从 `restart-server.bat` 间接启动，同样会触发提升。

**agent 修改代码后**：若改动涉及 `server.js`、`acp/` 等需 Node 重载的后端逻辑，agent **应自行重启服务器**（勿只提示用户刷新）；静态资源 `public/` 一般刷新即可，但 agent 仍可在同轮任务末尾顺手重启以确保一致。

## 重启方式（Windows）

| 场景 | 命令 | 说明 |
|------|------|------|
| **Cursor IDE Agent**（本机 Shell） | `restart-server.bat` | 杀端口 → 新窗口启动 → **立即退出，不阻塞 Shell** |
| **移动桥接内 Agent**（跑在 server 里） | `schedule-restart-server.bat` | 延迟 2s 后重启；**不可**直接 `restart-server.bat`（会自杀） |

**禁止**：在 Agent Shell 里直接 `start-server.bat`（前台阻塞）；禁止用 PowerShell `foreach ($pid in ...)`（`$PID` 只读会报错）。

移动桥接 Agent 重启后当前会话会断开，需提示用户刷新浏览器；IDE Agent 调用 `restart-server.bat` 后可继续工作。