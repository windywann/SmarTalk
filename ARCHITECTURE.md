# SmarTalk（FluentFlow AI）架构说明（API 堆砌版 / 不本地跑）

本文档用于把当前“前端已完成但依赖模拟/直连第三方”的实现，演进为**前端 + BFF 后端 + 第三方 AI/语音服务**的可维护架构，并作为后续版本管理与迭代的基线文档（持续更新）。

---

## 目标与约束

- **目标**：完成“雅思口语模拟考试”的完整交互链路：出题/追问 → 录音 → 转写 → 反馈/评分 → 历史记录/回放。
- **约束**：
  - 不本地跑（不自建 Whisper/TTS/模型等推理服务）
  - 用户音频允许上传第三方
  - 并发目标：个位数用户同时练（轻量优先、可先用同步接口）

---

## 当前前端现状（重要：为什么必须加后端 BFF）

当前 `features/IeltsExam.tsx`：

- 使用浏览器 `SpeechRecognition` 进行语音转写（不同浏览器支持差，且无法获得原始音频、无法做发音评测/回放）。
- 直接在浏览器里调用 `@google/genai`（Gemini），并且 Vite 将 `GEMINI_API_KEY` 注入前端 bundle（**生产环境高风险：Key 可被提取滥用**）。
- 历史记录仅存 `localStorage`（无法跨设备、无法审计、无法复评）。

因此必须引入 **BFF（Backend For Frontend）**：

- **隐藏第三方 Key**（前端永远不持有）
- 统一多家第三方 API（STT/TTS/LLM/发音评测/语法）
- 负责会话状态机、计时、题卡、落库、风控、日志

---

## 推荐总体架构（V1）

### 组件

- **Web 前端（现有 Vite/React）**
  - 录音：使用 `MediaRecorder` 采集音频（webm/ogg/wav）
  - 传输：上传音频到 BFF（multipart 或分片）
  - 展示：考官问题、字幕、倒计时、评分报告、历史

- **BFF 后端（Serverless 或轻量 Node 服务）**
  - 部署建议（任选其一）：
    - **Vercel Functions**（Node/TS）
    - **Cloudflare Workers**（TS，适合轻量，但对大文件上传要按其限制设计）
    - **Render/Fly.io**（长期在线的小 Node 服务）
  - 核心职责：Session/Turn 编排，调用第三方 STT/LLM/TTS/评测，持久化，鉴权

- **持久化（托管）**
  - 推荐：**Supabase**
    - Postgres：会话/turn/评分报告
    - Storage：音频文件（用户答题音频、TTS 音频）
    - Auth（可选）：匿名/邮箱登录

- **第三方 AI/语音能力（纯 API）**
  - STT：语音转写
  - LLM：考官对话与评分
  - TTS：考官语音
  - Pronunciation：发音评测（可选但强烈建议）
  - Grammar：语法/拼写纠错（可选，用于报告更可解释）

---

## 端到端链路（V1 交互）

### 1) 开始考试

1. 前端：用户选择考官风格/口音（UI 已有）
2. 前端 → BFF：`POST /api/ielts/sessions`
3. BFF：
   - 创建 session 记录（part=1）
   - 生成开场白与第一问（LLM）
   - （可选）生成 TTS 音频并存储，返回音频 URL
4. BFF → 前端：`sessionId` + `examinerText` + `ttsAudioUrl?`

### 2) 一轮答题（用户说话 → 转写 → 考官追问）

1. 前端：录音完成后上传音频
2. 前端 → BFF：`POST /api/ielts/sessions/:id/turns`（multipart: audio + meta）
3. BFF：
   - 存音频到存储（Supabase Storage / S3）
   - 调用 STT 得到 transcript（含置信度/时间戳则保存）
   - 将 transcript 写入 turn
   - 调用 LLM 生成下一问（遵守 Part1/2/3 规则）
   - （可选）TTS 合成下一问
4. BFF → 前端：`userTranscript` + `examinerText` + `ttsAudioUrl?` + `partState`

### 3) 结束与评分

1. 前端 → BFF：`POST /api/ielts/sessions/:id/finish`
2. BFF：
   - 汇总对话 transcript +（可选）发音评测结果 + 语法统计
   - 调用 LLM 产出结构化评分 JSON（与前端 `FeedbackData` 对齐）
   - 写入报告表、返回给前端

### 4) 历史/回放

- `GET /api/ielts/sessions`：列表（时间/总分）
- `GET /api/ielts/sessions/:id`：详情（每轮转写、问题、音频 URL、评分报告）

---

## 第三方 API 方案（按“堆砌即可跑”优先级）

下面给出两套可选组合：**A（最省事）**与**B（口语评测更像雅思）**。

### 方案 A：极简一套（一个供应商为主）

适合：V1 快速上线、先跑通闭环、允许“发音分”主要由 LLM 主观给出。

- **STT**：OpenAI Audio Transcription（Whisper 模型，Whisper 开源但此处用托管 API）
- **LLM（考官对话 + 评分）**：OpenAI Responses / Chat Completions（如 `gpt-4o-mini`）
- **TTS**：OpenAI Text-to-Speech（如 `gpt-4o-mini-tts` 或 `tts-1`）
- **存储/鉴权**：Supabase（可选）

优点：

- 接入最少、工程量小
- 效果整体稳定，端到端成本可控（小并发）

缺点：

- 没有“官方级发音评测”能力（可以做简化指标或后续再补）

### 方案 B：更贴近雅思口语（推荐）

适合：你希望“发音分”更可信、报告更像考试机构输出。

- **STT**：Azure Speech-to-Text（或 Deepgram STT）
- **Pronunciation**：Azure Pronunciation Assessment（强烈推荐，省掉自研/自建难题）
- **TTS**：Azure Neural TTS（可选英音/美音等）
- **LLM（考官对话 + 评分）**：OpenAI / Azure OpenAI / Gemini（任选其一，建议统一在 BFF 做“模型适配层”）
- **Grammar**：LanguageTool Cloud / 自托管（这里按“不本地跑”，用其 SaaS/API）
- **存储/鉴权**：Supabase

优点：

- 发音分有相对明确依据（音素/单词级别）
- 报告可以解释“哪里发音不清、哪些词读错/弱读不自然”

缺点：

- 供应商更多，计费与稳定性需要更细的错误处理

---

## 方案 B 落地细化（推荐默认实现）

本节把“方案 B”落到**可直接开工**的粒度：用 Azure Speech 覆盖 **STT + TTS + 发音评测**，再用 LLM 覆盖 **考官对话编排 + 雅思 rubric 评分/点评**，最后用 Supabase 做**会话与音频存档**。

### 关键结论（务必先对齐预期）

- **Azure Pronunciation Assessment 属于“有参考文本（reference text）”的评测**：最适合影子跟读/朗读/跟读材料这种“文本已知”的场景。
- **雅思口语模拟考试是自由表达（unscripted）**：没有标准参考文本。
  - V1 仍可以接入 Pronunciation Assessment，但建议将其定位为**“清晰度/流畅度的近似指标”**：
    - 先 STT 得到 transcript
    - 再用 transcript 作为 reference text 做一次评测（会有偏差，分数可能偏乐观）
  - **最终 IELTS band score 仍以 LLM rubric 为主**，Pronunciation Assessment 结果作为加权特征与“可解释证据”。

> 如果你希望“自由表达也能给出非常可信的发音分”，通常需要更专门的发音评测产品/数据与对齐算法（属于 V2+ 规划）。

### 推荐供应商组合（方案 B 的默认值）

- **STT + Pronunciation + TTS**：Azure Speech
- **LLM（考官对话 + 评分）**：OpenAI（推荐先用，后续可替换 Azure OpenAI / Gemini）
- **存储/鉴权**：Supabase
- **语法增强（可选）**：LanguageTool Cloud API（用于报告更“可解释”）

### Azure Speech：资源与参数建议（V1）

- **语言**：雅思口试建议 `en-US`（或按你 UI 里的口音选择 `en-GB` / `en-AU`）
- **音频输入**：
  - 前端用 `MediaRecorder` 录音上传（webm/ogg）
  - 后端尽量统一转成 Azure 更友好的 PCM WAV（16kHz/16-bit/mono）再送 Speech SDK（转码可用托管服务或简单 ffmpeg；若你不想在后端跑 ffmpeg，V1 可以先要求前端录制 wav）
- **TTS voice（示例）**：
  - 英音：`en-GB-SoniaNeural` / `en-GB-RyanNeural`
  - 美音：`en-US-JennyNeural` / `en-US-GuyNeural`
  - 澳音：`en-AU-NatashaNeural` / `en-AU-WilliamNeural`

> voice 名称会随区域/产品更新，最终以 Azure 控制台/文档为准；BFF 里建议做一个 `examinerId -> voiceName` 的映射表，便于迭代与 A/B。

### BFF 实现建议：用 Speech SDK（而不是手写 REST）

原因：

- Pronunciation Assessment 在 SDK 路径上最稳定（返回结构也更全：word/phoneme 级）
- 少踩 REST 参数/音频格式坑

后端建议运行环境：

- **Node.js（非 Edge）**：Vercel Node Functions / Render / Fly.io
- 不建议：Cloudflare Workers（Edge 环境对某些 SDK 兼容性与包体限制更苛刻）

（伪代码示意，最终以实现为准）

```ts
// 伪代码：BFF 内部服务
// 1) 上传音频 -> 2) STT -> 3)（可选）Pronunciation -> 4) 写库 -> 5) LLM 出题/追问 -> 6) TTS

import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

function createSpeechConfig() {
  const cfg = SpeechSDK.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY!, process.env.AZURE_SPEECH_REGION!);
  cfg.speechRecognitionLanguage = "en-US";
  return cfg;
}

async function sttOnce(wavBuffer: Buffer) {
  const speechConfig = createSpeechConfig();
  const audioConfig = SpeechSDK.AudioConfig.fromWavFileInput(wavBuffer);
  const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  return await new Promise<{ text: string }>((resolve, reject) => {
    recognizer.recognizeOnceAsync(
      (result) => resolve({ text: result.text || "" }),
      (err) => reject(err),
    );
  });
}

async function pronunciationAssess(wavBuffer: Buffer, referenceText: string) {
  const speechConfig = createSpeechConfig();
  const audioConfig = SpeechSDK.AudioConfig.fromWavFileInput(wavBuffer);
  const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  const pa = new SpeechSDK.PronunciationAssessmentConfig(
    referenceText,
    SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
    SpeechSDK.PronunciationAssessmentGranularity.Word,
    true, // enableMiscue
  );
  pa.applyTo(recognizer);

  return await new Promise<any>((resolve, reject) => {
    recognizer.recognizeOnceAsync(
      (result) => resolve(result.properties),
      (err) => reject(err),
    );
  });
}
```

### LLM（考官对话）建议：把“考试规则”从 Prompt 升级为“状态机 + Prompt”

你现在的前端是把 Part1/2/3 的推进交给模型“自由发挥”。V1 的 BFF 建议改为：

- BFF 存 `state_part`（1/2/3）与 `turn`、Part2 计时状态
- Prompt 只负责“在当前 part 下生成下一问”，而不是让模型自己决定什么时候换 part

好处：

- 可控、可复现（尤其是结束时评分要依据完整对话）
- 便于后续加入题库、难度控制、时间控制

### 评分（LLM rubric）建议输入结构

评分调用时，把以下信息一并传给 LLM（越结构化越稳）：

- 全部对话 transcript（按 turn）
- Part2 cue card 与用户 Part2 的完整回答 transcript
- 来自 Azure 的 proxy 指标（若启用）：fluency/accuracy/pronScore（注明“近似”）
- 语法/拼写统计（可选：LanguageTool summary）
- 评分输出：严格对齐前端 `FeedbackData`（score/fluency/vocabulary/grammar/pronunciation/strengths/improvements/comment），并加 `reportVersion`

### 失败降级策略（V1 必备）

- **STT 失败**：提示用户“请重录本段回答”，并记录失败原因（不进入 LLM）
- **Pronunciation 失败**：不阻塞考试流程，`pronunciationMetrics = null`，由 LLM 仅基于文本给出发音建议（标注可信度）
- **TTS 失败**：返回 `examinerText`，前端用文字展示；可选回退浏览器 `speechSynthesis`
- **LLM 失败**：返回兜底提示语（“网络异常，请重试”），不推进 part 状态

---

## BFF 接口定义（建议 V1）

> 说明：这份接口是给前端对接与版本演进用的“契约”。实现可先同步，后续再升级 SSE/WebSocket。

### `POST /api/ielts/sessions`

请求（JSON）：

- `examinerId`: string（如 alex/sarah/david）
- `accent`: string（如 british/american/australian，可选）
- `mode`: `"full"` | `"part1"` | `"part2"` | `"part3"`（可选，默认 full）

响应（JSON）：

- `sessionId`: string
- `examinerText`: string（第一句话/第一问）
- `ttsAudioUrl?`: string
- `state`: `{ part: 1, turn: 1 }`

### `POST /api/ielts/sessions/:sessionId/turns`

请求（multipart/form-data）：

- `audio`: file
- `mimeType`: string（如 `audio/webm`）
- `clientTimestamp`: string（ISO，可选）

响应（JSON）：

- `turnId`: string
- `userTranscript`: string
- `examinerText`: string
- `ttsAudioUrl?`: string
- `state`: `{ part: 1|2|3, turn: number, done: boolean }`

### `POST /api/ielts/sessions/:sessionId/finish`

响应（JSON）：

- `report`: `FeedbackData`（与前端 `types.ts` 对齐）
- `reportVersion`: string（例如 `v1`）

### `GET /api/ielts/sessions`

响应（JSON）：

- `items`: `{ sessionId, startedAt, finishedAt?, overallScore?, reportVersion? }[]`

### `GET /api/ielts/sessions/:sessionId`

响应（JSON）：

- `session`
- `turns[]`（含 audioUrl、transcript、examinerText）
- `report?`

---

## 数据模型（建议 V1）

### 表：`ielts_sessions`

- `id` (pk)
- `user_id`（可选，匿名可为空）
- `examiner_id`
- `accent`
- `mode`
- `state_part`（1/2/3）
- `started_at`
- `finished_at`

### 表：`ielts_turns`

- `id` (pk)
- `session_id` (fk)
- `role`（`user`/`examiner`，或拆两条记录）
- `audio_url`（用户音频）
- `transcript`
- `stt_meta`（jsonb：置信度/时间戳）
- `created_at`

### 表：`ielts_reports`

- `session_id` (pk/fk)
- `report_version`（例如 `v1`）
- `overall_score`
- `fluency`/`vocabulary`/`grammar`/`pronunciation`
- `strengths`（jsonb array）
- `improvements`（jsonb array）
- `comment`
- `raw_model_output`（可选，审计）
- `created_at`

---

## 安全与风控（V1 必做）

- **第三方 API Key 永不下发到前端**
- BFF 加：
  - **速率限制**（IP + userId/sessionId）
  - **配额/计费保护**（每天最大分钟数、每次最大音频时长、最大并发 turn）
  - **内容安全**（可选：供应商自带 moderation）
- 音频存储：
  - URL 使用短期签名（Signed URL）或受控访问
  - 明确数据保留策略（如 7/30/90 天）

---

## 版本演进与变更管理（用于后续更新版本管理）

### 版本命名

- **API 版本**：`/api/v1/...`（建议从 V1 就启用）
- **报告版本**：`reportVersion`（如 `v1`/`v2`），用于评分逻辑升级后的可追溯

### 兼容策略（建议）

- **向后兼容优先**：
  - 新增字段：允许前端忽略未知字段
  - 字段改名/删除：至少保留一个小版本周期（例如 2-4 周）
- **破坏性变更**：
  - 新开 `/api/v2`，同时支持 v1 一段时间

### 变更记录（建议落地为 ADR）

建议在仓库新增 `docs/adr/`，每次重要决策写一篇 ADR：

- ADR-0001：选择 BFF + 第三方 API（原因：安全、可控、可替换）
- ADR-0002：选择 STT/TTS/Pronunciation 供应商
- ADR-0003：评分 rubric pipeline 设计

模板（简版）：

- 背景
- 决策
- 备选方案
- 取舍
- 影响范围（前端/后端/数据/成本）

---

## 待办（下一步实现顺序建议）

1. 前端把 `SpeechRecognition` 切换为 `MediaRecorder` 上传音频到 BFF（先只做 webm）
2. 实现 BFF 的 `sessions/turns/finish` 三个核心接口
3. 接入 STT → LLM → TTS 的闭环
4. 接入存储（Supabase），完成历史列表/回放
5.（推荐）接入 Pronunciation Assessment，升级“发音”维度可信度


