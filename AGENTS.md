**agent 修改代码后**：若改动涉及 `server.js`、`acp/` 等需 Node 重载的后端逻辑，agent **应自行重启服务器**（勿只提示用户刷新）；静态资源 `public/` 一般刷新即可，但 agent 仍可在同轮任务末尾顺手重启以确保一致。

## 启动（人工 / 首次）

| 平台 | 命令 | 说明 |
|------|------|------|
| **Windows** | `start-server.bat` | 双击或 cmd 执行；自动请求 **管理员权限（UAC）** |
| **macOS / Linux** | `./start-server.sh` | 前台启动；需先 `chmod +x *.sh` |

**禁止**：在 Agent Shell 里直接跑前台启动脚本（`start-server.bat` / `start-server.sh`），会阻塞 Shell。

## 重启方式

| 场景 | Windows | macOS / Linux | 说明 |
|------|---------|---------------|------|
| **Cursor IDE Agent**（本机 Shell） | `restart-server.bat` | `./restart-server.sh` | 杀端口 → 后台/新窗口启动 → **立即退出，不阻塞 Shell** |
| **移动桥接内 Agent**（跑在 server 里） | `schedule-restart-server.bat` | `./schedule-restart-server.sh` | 延迟 2s 后重启；**不可**直接 restart（会自杀） |

**Windows 额外禁止**：用 PowerShell `foreach ($pid in ...)`（`$PID` 只读会报错）。

**macOS / Linux**：重启日志写入 `server.log`，可用 `tail -f server.log` 查看。

移动桥接 Agent 重启后当前会话会断开，需提示用户刷新浏览器；IDE Agent 调用 restart 脚本后可继续工作。