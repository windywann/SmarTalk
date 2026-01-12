# SmarTalk - AI IELTS Speaking Practice Platform

基于阿里云通义千问（Qwen）API 的智能雅思口语模拟考试平台。

## ✨ 功能特性

- 🎯 **真实考试模拟**：完整的 IELTS Speaking Part 1/2/3 流程
- 🗣️ **实时语音识别**：基于 Qwen ASR 的实时语音转文字
- 🤖 **智能考官**：Qwen-Plus 驱动的 AI 考官，自然对话
- 🎵 **真人发音**：Qwen TTS 多音色支持（英式/美式/澳式）
- 📊 **专业评估**：AI 生成详细的 IELTS 评分报告
- 👥 **多考官选择**：3 位不同口音和风格的 AI 考官

## 🏗️ 技术栈

### 前端
- React + TypeScript
- Vite
- TailwindCSS

### 后端
- Node.js (BFF层)
- Python 3.9+ (AI服务)
- 阿里云通义千问 API:
  - Qwen-Plus (LLM)
  - Qwen ASR Realtime (语音识别)
  - Qwen TTS Realtime (语音合成)

## 📦 本地开发

### 前置要求

- Node.js 18+
- Python 3.9+
- 阿里云 DashScope API Key

### 安装步骤

1. **克隆仓库**
```bash
git clone <your-repo-url>
cd SmarTalk
```

2. **安装依赖**
```bash
# 前端依赖
npm install

# Python 依赖
pip3 install -r server/requirements.txt
```

3. **配置环境变量**
```bash
cp ENV.example ENV.local
```

编辑 `ENV.local`，填入您的 API Key：
```bash
DASHSCOPE_API_KEY=sk-your-api-key-here
PORT=5176
```

4. **启动开发服务器**
```bash
# 终端1：启动前端
npm run dev

# 终端2：启动后端
npm run dev:server
```

5. **访问应用**

打开 http://localhost:5173

## 🚀 部署指南

### Vercel 部署（仅前端）

> ⚠️ 注意：由于项目包含 Python 后端，完整功能需要分离部署

1. **安装 Vercel CLI**
```bash
npm i -g vercel
```

2. **登录 Vercel**
```bash
vercel login
```

3. **部署前端**
```bash
vercel
```

4. **配置环境变量**

在 Vercel Dashboard 中设置：
- `DASHSCOPE_API_KEY`: 您的 API Key

### Railway 部署（全栈）

推荐使用 Railway 部署完整应用（前端 + 后端）

1. 连接 GitHub 仓库
2. 配置环境变量 `DASHSCOPE_API_KEY`
3. 自动部署

详见：[DEPLOYMENT.md](./DEPLOYMENT.md)

## 📁 项目结构

```
SmarTalk/
├── features/           # React 功能组件
│   └── IeltsExam.tsx  # 主考试界面
├── server/            # 后端服务
│   ├── index.js       # Node.js BFF
│   ├── qwen_llm_examiner_stream.py   # LLM 考官
│   ├── qwen_asr_realtime_bridge.py   # ASR 语音识别
│   ├── qwen_tts_stream.py            # TTS 语音合成
│   └── qwen_llm_feedback.py          # 评分系统
├── public/            # 静态资源
├── ENV.example        # 环境变量模板
└── package.json       # 项目配置
```

## 🔑 API Key 获取

1. 访问 [阿里云百炼平台](https://bailian.console.aliyun.com/)
2. 开通模型服务
3. 创建 API Key
4. 将 Key 配置到 ENV.local

## 📝 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系方式

如有问题，请提交 Issue。
