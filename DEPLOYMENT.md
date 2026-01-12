# SmarTalk 部署指南

本文档详细说明如何将 SmarTalk 部署到生产环境。

## 🏗️ 架构概览

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
┌──────▼──────────────────┐
│  Frontend (React/Vite)  │ ← Vercel
└──────┬──────────────────┘
       │ HTTP/WebSocket
┌──────▼──────────────────┐
│  Node.js BFF Server     │ ← Railway/Render
├─────────────────────────┤
│  Python AI Services:    │
│  - LLM (Examiner)       │
│  - ASR (Speech-to-Text) │
│  - TTS (Text-to-Speech) │
│  - Feedback Generator   │
└──────┬──────────────────┘
       │ API Calls
┌──────▼──────────────────┐
│ DashScope (Qwen) APIs   │
└─────────────────────────┘
```

## 方案 A：Vercel 前端 + Railway 后端（推荐）

### 步骤 1：部署后端到 Railway

1. **创建 Railway 账号**
   - 访问 https://railway.app
   - 使用 GitHub 登录

2. **创建新项目**
   - 点击 "New Project"
   - 选择 "Deploy from GitHub repo"
   - 选择您的 SmarTalk 仓库

3. **配置环境变量**
   ```
   DASHSCOPE_API_KEY=sk-your-key-here
   PORT=5176
   ```

4. **配置启动命令**
   在 Railway Dashboard:
   - Build Command: `npm install && pip3 install -r server/requirements.txt`
   - Start Command: `npm run dev:server`

5. **获取后端 URL**
   - Railway 会自动生成一个 URL，如：`https://smartalk-backend-production.up.railway.app`
   - 记录这个 URL

### 步骤 2：部署前端到 Vercel

1. **修改前端 API 配置**

编辑所有前端文件中的 API 调用，将 `localhost:5176` 替换为 Railway URL：

```typescript
// 例如在 features/IeltsExam.tsx
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5176';

// 使用
fetch(`${API_BASE}/api/v1/tts/stream`, ...)
```

2. **创建 vercel.json**

在项目根目录创建：
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "env": {
    "VITE_API_BASE": "https://your-railway-url.up.railway.app"
  }
}
```

3. **部署到 Vercel**

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 部署
vercel

# 配置环境变量（在 Vercel Dashboard）
VITE_API_BASE=https://your-railway-url.up.railway.app

# 生产部署
vercel --prod
```

4. **配置 CORS（后端）**

编辑 `server/index.js`，添加 Vercel 域名到 CORS 白名单：

```javascript
const allowedOrigins = [
  'http://localhost:5173',
  'https://your-vercel-app.vercel.app'
];

res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
```

## 方案 B：全部部署到 Railway

1. **部署整个项目**
   - Deploy from GitHub
   - 配置环境变量 `DASHSCOPE_API_KEY`

2. **配置启动命令**
   ```bash
   # Build Command
   npm install && pip3 install -r server/requirements.txt && npm run build

   # Start Command  
   node server/index.js
   ```

3. **配置静态文件服务**

编辑 `server/index.js`，添加静态文件服务：

```javascript
// Serve built frontend
const path = require('path');
const express = require('express');
const app = express();

app.use(express.static(path.join(__dirname, '../dist')));

// ... API routes ...

// Catch-all route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});
```

## 方案 C：Vercel Serverless Functions

> ⚠️ 复杂度较高，需要重构后端

将 Python 脚本改为 Vercel Serverless Functions：

1. 创建 `api/` 目录
2. 每个 Python 脚本改为独立的 API endpoint
3. 配置 `vercel.json`

示例：
```json
{
  "functions": {
    "api/**/*.py": {
      "runtime": "python3.9"
    }
  }
}
```

## 🔒 安全建议

1. **永远不要提交 API Key**
   - 使用环境变量
   - 检查 .gitignore

2. **设置速率限制**
   ```javascript
   const rateLimit = require('express-rate-limit');
   
   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100 // limit each IP to 100 requests per windowMs
   });
   
   app.use('/api/', limiter);
   ```

3. **启用 HTTPS**
   - Vercel 和 Railway 自动提供

## 📊 监控和日志

### Railway
- 内置日志查看
- 自动重启
- 健康检查

### Vercel
- Analytics
- Function Logs
- Error Tracking

## 🐛 常见问题

### Q: WebSocket 连接失败
A: 确保后端支持 WebSocket Upgrade。Railway 默认支持。

### Q: Python 依赖安装失败
A: 检查 `requirements.txt` 中的版本兼容性，Railway 使用 Python 3.9。

### Q: TTS/ASR 不工作
A: 验证 `DASHSCOPE_API_KEY` 环境变量正确配置。

## 📝 部署检查清单

- [ ] .gitignore 包含所有敏感文件
- [ ] ENV.local 未提交到 Git
- [ ] API Key 配置为环境变量
- [ ] CORS 配置正确
- [ ] 前端 API URL 指向正确的后端
- [ ] WebSocket 端点可访问
- [ ] 所有 Python 依赖已安装
- [ ] 测试所有功能（ASR/TTS/LLM）

## 🚀 快速部署命令

```bash
# 1. 提交所有更改
git add .
git commit -m "Ready for deployment"
git push origin main

# 2. 部署到 Vercel
vercel --prod

# 3. 在 Railway 中触发重新部署
# (通过 Dashboard 或 Git push)
```

## 📞 获取帮助

- Railway 文档: https://docs.railway.app
- Vercel 文档: https://vercel.com/docs
- 阿里云 DashScope: https://help.aliyun.com/zh/dashscope/

---

**推荐配置**：Vercel (前端) + Railway (后端)
**预估成本**：
- Vercel: 免费额度充足
- Railway: $5-20/月（根据使用量）
