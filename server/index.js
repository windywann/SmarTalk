import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';

// 防止在某些终端/后台环境 stdout 管道关闭时触发 EPIPE 导致进程崩溃
try {
  process.stdout.on('error', (err) => {
    if (err && err.code === 'EPIPE') return;
  });
  process.stderr.on('error', (err) => {
    if (err && err.code === 'EPIPE') return;
  });
} catch {
  // ignore
}

const PORT = Number(process.env.PORT || 5176);
const PYTHON_BIN =
  process.env.PYTHON ||
  (fs.existsSync(`${process.cwd()}/.venv/bin/python3`) ? `${process.cwd()}/.venv/bin/python3` : 'python3');

function json(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: 'not_found' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  // Initial comment to open the stream promptly in some proxies
  res.write(':ok\n\n');
}

function sseSend(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ...
const server = http.createServer(async (req, res) => {
  const reqStart = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;
  const method = (req.method || 'GET').toUpperCase();

  // Log incoming requests
  console.log(`[REQ] ${method} ${pathname}`);

  res.on('finish', () => {
    console.log(`[RES] ${method} ${pathname} ${res.statusCode} (${Date.now() - reqStart}ms)`);
  });

  try {
    // Health
    // ...
    if (method === 'GET' && pathname === '/api/health') {
      return json(res, 200, { ok: true, service: 'smartalk-bff', time: new Date().toISOString() });
    }

    // Qwen ASR (DashScope) - stream via SSE
    if (method === 'POST' && pathname === '/api/v1/asr/stream') {
      console.log(`[ASR] Starting stream request`);
      const bodyBuf = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(bodyBuf.toString('utf8') || '{}');
      } catch {
        return json(res, 400, { error: 'bad_request', message: 'Body must be JSON.' });
      }

      const audioUrl = String(payload.audioUrl || '').trim();
      const language = payload.language ? String(payload.language) : '';
      const enableItN = payload.enable_itn === true ? 'true' : payload.enable_itn === false ? 'false' : '';
      const contextText = payload.context ? String(payload.context) : '';

      if (!audioUrl) {
        return json(res, 400, { error: 'bad_request', message: 'Missing audioUrl.' });
      }
      if (!process.env.DASHSCOPE_API_KEY) {
        return json(res, 500, {
          error: 'missing_env',
          message: 'DASHSCOPE_API_KEY is not set for the server process. Export it before starting dev:server.',
        });
      }

      sseInit(res);
      sseSend(res, { event: 'start' });

      const args = ['server/qwen_asr_stream.py', '--audio-url', audioUrl];
      if (language) args.push('--language', language);
      if (enableItN) args.push('--enable-itn', enableItN);
      if (contextText) args.push('--context', contextText);

      const py = spawn(PYTHON_BIN, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuf = '';
      py.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        // Python outputs one "delta" per line
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim();
          if (!t) continue;
          sseSend(res, { event: 'delta', text: t });
        }
      });

      py.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString('utf8');
      });

      const closeAll = () => {
        try {
          py.kill('SIGKILL');
        } catch {
          // ignore
        }
      };
      req.on('close', closeAll);
      req.on('aborted', closeAll);

      py.on('close', (code) => {
        if (code === 0) {
          sseSend(res, { event: 'end' });
        } else {
          sseSend(res, { event: 'error', message: stderrBuf || `python exited with code ${code}` });
        }
        res.end();
      });

      return;
    }

    // Qwen LLM (DashScope) - IELTS examiner (JSON-only) stream via SSE
    if (method === 'POST' && pathname === '/api/v1/ielts/examiner/stream') {
      console.log(`[LLM] Starting examiner stream`);
      if (!process.env.DASHSCOPE_API_KEY) {
        console.error(`[LLM] Missing API Key`);
        return json(res, 500, {
          error: 'missing_env',
          message: 'DASHSCOPE_API_KEY is not set for the server process. Export it before starting dev:server.',
        });
      }

      const bodyBuf = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(bodyBuf.toString('utf8') || '{}');
      } catch {
        return json(res, 400, { error: 'bad_request', message: 'Body must be JSON.' });
      }

      sseInit(res);
      sseSend(res, { event: 'start' });

      const py = spawn(PYTHON_BIN, ['server/qwen_llm_examiner_stream.py'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const payloadJson = JSON.stringify(payload);
      console.log(`[LLM] Sending payload to Python (${payloadJson.length} bytes):`, payloadJson.substring(0, 200));
      py.stdin.write(payloadJson);
      py.stdin.end();

      let stderrBuf = '';
      py.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        if (text) sseSend(res, { event: 'delta', text });
      });
      py.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString('utf8');
      });

      const closeAll = () => {
        try {
          py.kill('SIGKILL');
        } catch {
          // ignore
        }
      };
      req.on('close', closeAll);
      req.on('aborted', closeAll);

      py.on('close', (code) => {
        if (code === 0) {
          sseSend(res, { event: 'end' });
        } else {
          sseSend(res, { event: 'error', message: stderrBuf || `python exited with code ${code}` });
        }
        res.end();
      });

      return;
    }

    // Qwen TTS Realtime (DashScope) - stream audio deltas via SSE (base64 PCM chunks)
    if (method === 'POST' && pathname === '/api/v1/tts/stream') {
      console.log(`[TTS] Starting TTS stream`);
      if (!process.env.DASHSCOPE_API_KEY) {
        console.error(`[TTS] Missing API Key`);
        return json(res, 500, {
          error: 'missing_env',
          message: 'DASHSCOPE_API_KEY is not set for the server process. Export it before starting dev:server.',
        });
      }

      const bodyBuf = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(bodyBuf.toString('utf8') || '{}');
      } catch {
        return json(res, 400, { error: 'bad_request', message: 'Body must be JSON.' });
      }

      const text = String(payload.text || '').trim();
      if (!text) return json(res, 400, { error: 'bad_request', message: 'Missing text.' });

      const voice = payload.voice ? String(payload.voice) : 'Cherry';
      const languageType = payload.language_type ? String(payload.language_type) : 'English';
      const mode = payload.mode ? String(payload.mode) : 'server_commit';
      const format = payload.format ? String(payload.format) : 'pcm_24000';
      const wsUrl = payload.wsUrl ? String(payload.wsUrl) : '';
      const speechRate = payload.speech_rate != null ? String(payload.speech_rate) : '';
      const pitchRate = payload.pitch_rate != null ? String(payload.pitch_rate) : '';
      const volume = payload.volume != null ? String(payload.volume) : '';

      sseInit(res);
      sseSend(res, { event: 'start', format: 'pcm_s16le', sampleRate: 24000, channels: 1 });

      const args = ['server/qwen_tts_stream.py', '--text', text, '--voice', voice, '--language-type', languageType, '--mode', mode, '--format', format];
      if (wsUrl) args.push('--ws-url', wsUrl);
      if (speechRate) args.push('--speech-rate', speechRate);
      if (pitchRate) args.push('--pitch-rate', pitchRate);
      if (volume) args.push('--volume', volume);

      const py = spawn(PYTHON_BIN, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuf = '';
      py.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim();
          if (!t) continue;
          try {
            const obj = JSON.parse(t);
            sseSend(res, obj);
          } catch {
            // ignore malformed line
          }
        }
      });

      py.stderr.on('data', (chunk) => {
        const errText = chunk.toString('utf8');
        stderrBuf += errText;
        // Forward to console for debugging
        process.stderr.write(errText);
      });

      const closeAll = () => {
        try {
          py.kill('SIGKILL');
        } catch {
          // ignore
        }
      };
      req.on('close', closeAll);
      req.on('aborted', closeAll);

      py.on('close', (code) => {
        if (code !== 0) {
          sseSend(res, { event: 'error', message: stderrBuf || `python exited with code ${code}` });
        }
        sseSend(res, { event: 'end' });
        res.end();
      });

      return;
    }

    // Qwen LLM - IELTS feedback report (non-stream JSON)
    // Request: POST /api/v1/ielts/feedback { model?, transcript: [{role,text}...] }
    if (method === 'POST' && pathname === '/api/v1/ielts/feedback') {
      if (!process.env.DASHSCOPE_API_KEY) {
        return json(res, 500, {
          error: 'missing_env',
          message: 'DASHSCOPE_API_KEY is not set for the server process. Export it before starting dev:server.',
        });
      }

      const bodyBuf = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(bodyBuf.toString('utf8') || '{}');
      } catch {
        return json(res, 400, { error: 'bad_request', message: 'Body must be JSON.' });
      }

      const py = spawn(PYTHON_BIN, ['server/qwen_llm_feedback.py'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      py.stdin.write(JSON.stringify(payload));
      py.stdin.end();

      let stdoutBuf = '';
      let stderrBuf = '';
      py.stdout.on('data', (c) => (stdoutBuf += c.toString('utf8')));
      py.stderr.on('data', (c) => {
        const errText = c.toString('utf8');
        stderrBuf += errText;
        process.stderr.write('[FEEDBACK-PY] ' + errText);
      });

      py.on('close', (code) => {
        if (code !== 0) {
          return json(res, 500, { error: 'feedback_failed', message: stderrBuf || `python exited with code ${code}` });
        }
        try {
          const parsed = JSON.parse(stdoutBuf);
          return json(res, 200, parsed);
        } catch {
          return json(res, 500, { error: 'bad_model_output', message: stdoutBuf || 'empty output' });
        }
      });

      return;
    }

    // V1: create session (stub)
    if (method === 'POST' && pathname === '/api/v1/ielts/sessions') {
      return json(res, 200, {
        sessionId: `local_${Date.now()}`,
        examinerText: 'Hello! This is a local stub BFF. Please answer in English: What is your full name?',
        ttsAudioUrl: null,
        state: { part: 1, turn: 1 },
      });
    }

    // V1: turns (stub) - 先不解析 multipart，仅返回固定追问，保证前后端联调时有“回包”
    {
      const m = pathname.match(/^\/api\/v1\/ielts\/sessions\/([^/]+)\/turns$/);
      if (m && method === 'POST') {
        const sessionId = m[1];
        const bodyBuf = await readBody(req);
        // 尝试把 JSON 文本里带的 transcript 透传出来，方便调试
        let transcript = '';
        try {
          const maybeJson = JSON.parse(bodyBuf.toString('utf8') || '{}');
          transcript = String(maybeJson.text || maybeJson.transcript || '');
        } catch {
          // ignore
        }
        return json(res, 200, {
          turnId: `turn_${Date.now()}`,
          sessionId,
          userTranscript: transcript || '(audio received - stub did not transcribe)',
          examinerText: 'Thanks. (stub) Could you tell me why you want to improve your English speaking?',
          ttsAudioUrl: null,
          state: { part: 1, turn: 2, done: false },
        });
      }
    }

    // V1: finish (stub)
    {
      const m = pathname.match(/^\/api\/v1\/ielts\/sessions\/([^/]+)\/finish$/);
      if (m && method === 'POST') {
        return json(res, 200, {
          reportVersion: 'v1-local-stub',
          report: {
            score: 6,
            fluency: 6,
            vocabulary: 6,
            grammar: 6,
            pronunciation: 6,
            strengths: ['本地后端桩已打通：请求/响应链路正常。'],
            improvements: ['接入 Azure STT/Pronunciation/TTS + OpenAI 评分后，这里会输出真实报告。'],
            comment: '这是本地 stub 报告，用于验证前后端联调与页面展示。',
          },
        });
      }
    }

    return notFound(res);
  } catch (err) {
    return json(res, 500, { error: 'internal_error', message: String(err?.message || err) });
  }
});

// WebSocket bridge for Qwen ASR Realtime (browser <-> python <-> DashScope)
// Client connects to ws(s)://<host>/api/v1/asr/realtime/ws
const wss = new WebSocketServer({ noServer: true, path: '/api/v1/asr/realtime/ws' });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);
  console.log(`[UPGRADE] ${pathname}`);

  if (pathname === '/api/v1/asr/realtime/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    // Let other handlers handle or destroy
    // socket.destroy(); // Optional if no other WS handlers
  }
});

wss.on('connection', (ws, req) => {
  console.log(`[ASR-WS] New connection from ${req.socket.remoteAddress}`);
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error(`[ASR-WS] Missing API Key`);
    ws.send(JSON.stringify({ event: 'error', message: 'DASHSCOPE_API_KEY is not set for the server process.' }));
    ws.close();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const language = url.searchParams.get('language') || 'en';
  const silenceMs = url.searchParams.get('silenceMs') || '400';
  const threshold = url.searchParams.get('threshold') || '0.0';
  const corpusText = url.searchParams.get('corpus_text') || '';
  const dashWsUrl = url.searchParams.get('dashWsUrl') || process.env.DASHSCOPE_ASR_WS_URL || '';

  // python bridge reads config/audio JSON lines from stdin and outputs JSON lines to stdout
  const env = { ...process.env };
  if (dashWsUrl) env.DASHSCOPE_ASR_WS_URL = dashWsUrl;
  const py = spawn(PYTHON_BIN, ['server/qwen_asr_realtime_bridge.py'], {
    cwd: process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  ws.send(JSON.stringify({ event: 'start' }));

  // Send initial config
  const sendToPython = (str) => {
    if (py.stdin.writable) {
      py.stdin.write(str);
    }
  };

  py.stdin.on('error', (err) => {
    console.error('[ASR-WS] Python stdin error:', err.code);
  });

  sendToPython(
    JSON.stringify({
      type: 'config',
      language,
      enable_turn_detection: true,
      turn_detection_threshold: Number(threshold),
      turn_detection_silence_duration_ms: Number(silenceMs),
      corpus_text: corpusText,
    }) + '\n',
  );
  // NOTE: DashScope ws url override is passed via child env above

  let stdoutBuf = '';
  py.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      ws.send(line);
    }
  });

  let stderrBuf = '';
  py.stderr.on('data', (chunk) => {
    const s = chunk.toString('utf8');
    stderrBuf += s;
    console.error(`[ASR-PY] ${s.trim()}`);
  });

  ws.on('message', (data) => {
    try {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      // Expect JSON line from browser:
      // { "type": "audio", "audio_b64": "..." } | { "type": "commit" } | { "type": "close" }
      sendToPython(text.trim() + '\n');
    } catch {
      // ignore
    }
  });

  const cleanup = () => {
    try {
      sendToPython(JSON.stringify({ type: 'close' }) + '\n');
    } catch {
      // ignore
    }
    try {
      py.kill('SIGKILL');
    } catch {
      // ignore
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);

  py.on('close', (code) => {
    if (code !== 0) {
      ws.send(JSON.stringify({ event: 'error', message: stderrBuf || `python exited with code ${code}` }));
    }
    try { ws.close(); } catch { /* ignore */ }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[smartalk-bff] listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[smartalk-bff] health: http://localhost:${PORT}/api/health`);
  // eslint-disable-next-line no-console
  console.log(`[smartalk-bff] DASHSCOPE_API_KEY: ${process.env.DASHSCOPE_API_KEY ? 'SET' : 'EMPTY'}`);
});


