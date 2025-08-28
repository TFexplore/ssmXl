# 无头浏览器WebSocket监控工具

基于Node.js的无头浏览器工具，用于定时访问和刷新通过WebSocket加载信息的网站。

## 功能特性

- ✅ 使用Puppeteer控制无头Chrome浏览器
- ✅ 支持WebSocket连接监控
- ✅ 定时自动刷新页面
- ✅ 自动截图保存页面状态
- ✅ 可配置的目标URL和刷新间隔
- ✅ 详细的日志输出

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置目标网站

编辑 `.env` 文件，设置你的目标网站URL：

```
TARGET_URL=https://your-websocket-site.com
```

### 3. 启动监控

```bash
npm start
```

或使用开发模式（自动重启）：

```bash
npm run dev
```

## 配置说明

### 环境变量配置 (.env)

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `TARGET_URL` | 目标网站URL | `https://example.com` |
| `REFRESH_INTERVAL` | 刷新间隔（cron表达式） | `*/5 * * * *` |
| `HEADLESS` | 是否使用无头模式 | `true` |
| `TIMEOUT` | 页面加载超时时间（毫秒） | `30000` |

### Cron表达式示例

- `*/1 * * * *` - 每分钟刷新
- `*/5 * * * *` - 每5分钟刷新
- `0 */1 * * *` - 每小时刷新
- `0 9 * * *` - 每天9点刷新

## 使用方法

### 基本使用

```javascript
const WebSocketMonitor = require('./index');

const monitor = new WebSocketMonitor({
  url: 'https://your-websocket-site.com',
  refreshInterval: '*/2 * * * *', // 每2分钟刷新
  headless: true
});

monitor.startMonitoring();
```

### 高级配置

```javascript
const monitor = new WebSocketMonitor({
  url: 'https://your-websocket-site.com',
  refreshInterval: '*/10 * * * *',
  headless: false, // 显示浏览器窗口（调试模式）
  timeout: 60000, // 60秒超时
  customHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});
```

## 输出文件

程序运行时会生成以下文件：

- `screenshot_{timestamp}.png` - 初始页面截图
- `latest_screenshot_{timestamp}.png` - 每次刷新的最新截图

## 日志输出

程序会在控制台输出以下信息：
- 浏览器启动状态
- 页面访问进度
- WebSocket连接信息
- 收到的WebSocket消息
- 页面刷新记录

## 故障排除

### 常见问题

1. **浏览器启动失败**
   - 确保已安装Chrome/Chromium
   - 检查系统权限

2. **页面加载超时**
   - 增加TIMEOUT值
   - 检查网络连接
   - 确认目标网站可访问

3. **WebSocket连接问题**
   - 检查目标网站是否使用WebSocket
   - 查看浏览器控制台日志

### 调试模式

设置 `HEADLESS=false` 可以看到浏览器窗口，便于调试：

```bash
HEADLESS=false npm start
```

## 技术栈

- **Puppeteer** - 无头浏览器控制
- **Node-cron** - 定时任务调度
- **WS** - WebSocket客户端支持
- **dotenv** - 环境变量管理

## 许可证

MIT License