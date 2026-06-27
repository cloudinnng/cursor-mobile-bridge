# Cursor 移动设备桥接

通过 Web 界面在局域网内远程操控 Cursor Agent（ACP 协议），适配手机竖屏。

## 架构

```
手机浏览器 (HTML) ←WebSocket→ Node server.js ←stdio JSON-RPC→ agent acp (cwd=./workspace)
```

## 前置条件

- Node.js >= 18
- 已安装并登录 Cursor Agent CLI（`agent login`）
- Windows: `agent.cmd` 在 PATH 中（默认安装路径 `C:\Users\<用户>\AppData\Local\cursor-agent\`）

## 安装

```bash
npm install
```

## 启动

```bash
npm start
```

启动后终端会打印局域网访问地址，例如：

```
[server] 本地访问: http://localhost:3456
[server] 局域网访问: http://192.168.1.100:3456
```

## 手机连接

1. 确保手机和电脑在同一 Wi-Fi 局域网
2. 手机浏览器打开 `http://<电脑局域网IP>:3456`
3. 即可开始对话

可通过环境变量 `PORT` 修改端口（默认 3456）：

```bash
PORT=8080 npm start
```

## 功能

- **图片插入**：点击 🖼 选图/拍照，支持粘贴与拖放，最多 4 张（自动压缩）
- **完整对话 UI**：聊天记录、输入框、发送按钮
- **流式回复**：Agent 回复和思考内容实时显示
- **思考块**：可折叠查看 Agent 思考过程
- **工具调用**：可折叠查看工具执行详情
- **模型选择**：下拉切换可用模型
- **模式选择**：Agent / Plan / Ask 三种模式
- **新会话**：保留显示历史，后端创建新 ACP session
- **权限自动放行**：工具执行不打断移动端操作
- **localStorage 历史**：刷新页面后恢复聊天记录显示

## 工作空间

Agent 的文件读写操作限定在项目下的 `./workspace` 子目录。请在此目录放置需要 Agent 操作的项目文件。

## 自检

```bash
npm run selfcheck
```

验证 ACP 客户端整条链路（initialize → auth → session/new → prompt → 流式回复）。

## 目录结构

```
├── acp/
│   └── acpClient.js    # ACP 子进程 + JSON-RPC 封装
├── public/
│   ├── index.html      # 移动端 UI
│   ├── style.css       # 竖屏样式
│   └── app.js          # 前端逻辑
├── workspace/          # Agent 工作空间（cwd）
├── server.js           # HTTP + WebSocket 服务器
├── selfcheck.js        # 冒烟自检
└── package.json
```

## 注意事项

- 多客户端共享单个 ACP session，并发发送消息会交叉
- ACP 模式下 MCP 服务器注入在部分 CLI 版本不稳定，本项目不依赖 MCP
- 模型 ID 含方括号参数（如 `claude-opus-4-8[thinking=true,...]`），前端原值传回
