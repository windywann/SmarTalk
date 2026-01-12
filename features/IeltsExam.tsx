import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Square, RefreshCw, ChevronRight, ChevronLeft, Video, VideoOff, Settings, Volume2, MessageSquare, Globe, User, History, X, Calendar, ArrowRight } from 'lucide-react';
import { ExamState, Message, FeedbackData, ExaminerTurnResponse } from '../types';
import Button from '../components/Button';
import Modal from '../components/Modal';

// Examiner Data Definitions
const EXAMINERS = [
  {
    id: 'alex',
    name: 'Alex',
    gender: 'Female', // British 女声
    accent: 'British',
    style: 'Standard',
    voice: 'Cherry', // DashScope TTS: 英式女声
    image: "/examiners/alex.jpg"
  },
  {
    id: 'sarah',
    name: 'Sarah',
    gender: 'Female',
    accent: 'American',
    style: 'Friendly',
    voice: 'Jennifer', // DashScope TTS: 美式女声
    image: "/examiners/sarah.jpg"
  },
  {
    id: 'david',
    name: 'David',
    gender: 'Male',
    accent: 'Australian',
    style: 'Strict',
    voice: 'Andre', // DashScope TTS: 男声
    image: "/examiners/david.jpg"
  }
];

interface IeltsExamProps {
  onExamStatusChange: (isOngoing: boolean) => void;
}

// Preset scripts to reduce latency
const PRESET_SCRIPTS = {
  opening: (name: string) => `Hello, my name is ${name}. Can you tell me your full name, please?`,
};

const IeltsExam: React.FC<IeltsExamProps> = ({ onExamStatusChange }) => {
  const [state, setState] = useState<ExamState>(ExamState.IDLE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiDraft, setAiDraft] = useState<string>('');
  const [feedback, setFeedback] = useState<FeedbackData | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);

  // Confirmation & History State
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [history, setHistory] = useState<FeedbackData[]>([]);

  // New state for examiner selection
  const [currentExaminerIdx, setCurrentExaminerIdx] = useState(0);

  // NEW: IELTS exam state management (State Machine)
  // 0=intro, 1=part1, 2=part2, 3=part3, 4=end
  const [currentPart, setCurrentPart] = useState(0);
  const [questionCount, setQuestionCount] = useState(0);

  // Refs
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);
  const isRecordingRef = useRef(false);
  const asrWsRef = useRef<WebSocket | null>(null);
  const asrStreamRef = useRef<MediaStream | null>(null);
  const asrCtxRef = useRef<AudioContext | null>(null);
  const asrProcessorRef = useRef<AudioWorkletNode | null>(null);
  const asrSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const asrGainRef = useRef<GainNode | null>(null);
  const finalTranscriptRef = useRef<string>('');
  const autoStopGuardRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const ttsNextTimeRef = useRef<number>(0);
  const ttsEndTimerRef = useRef<number | null>(null);
  const ttsAudioCacheRef = useRef<Map<string, Int16Array[]>>(new Map()); // Cache for replay
  const videoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ASR partial text throttling
  const asrPartialBufferRef = useRef<string>('');
  const asrPartialTimerRef = useRef<number | null>(null);

  // Derived current examiner
  const currentExaminer = EXAMINERS[currentExaminerIdx];

  // Load History on Mount
  useEffect(() => {
    const saved = localStorage.getItem('fluentflow_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Sync status with App
  useEffect(() => {
    onExamStatusChange(state === ExamState.ONGOING || state === ExamState.SETUP);
  }, [state, onExamStatusChange]);

  // Initialize Camera
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (state === ExamState.ONGOING && videoEnabled) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(s => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(err => console.error("Camera access denied:", err));
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [state, videoEnabled]);

  // Scroll logic
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Cleanup (stop any in-flight TTS stream / audio playback)
  useEffect(() => {
    return () => {
      cancelTtsPlayback();
      try {
        if (synthRef.current.speaking) synthRef.current.cancel();
      } catch {
        // ignore
      }
      try {
        asrWsRef.current?.close();
      } catch {
        // ignore
      }
      asrWsRef.current = null;
      try {
        asrStreamRef.current?.getTracks().forEach(t => t.stop());
      } catch {
        // ignore
      }
      asrStreamRef.current = null;
      try {
        asrCtxRef.current?.close();
      } catch {
        // ignore
      }
      asrCtxRef.current = null;
      try {
        audioCtxRef.current?.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: buildExaminerSystemPrompt has been removed.
  // Prompts are now dynamically generated server-side based on exam state (Part/Question Count).

  const fetchExaminerTurn = async (
    llmMessages: Array<{ role: 'user' | 'assistant'; text: string }>,
    { onDraft }: { onDraft?: (draft: string) => void } = {},
  ): Promise<{ text: string; meta?: any }> => {
    console.log(`[LLM] Calling API: part=${currentPart}, q_count=${questionCount}, msg_count=${llmMessages.length}`);

    const resp = await fetch('/api/v1/ielts/examiner/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen-plus',
        temperature: 0.7,
        messages: llmMessages,
        // NEW: Send state params
        part: currentPart,
        questionCount: questionCount,
      }),
    });

    console.log('[LLM] Response status:', resp.status);
    if (!resp.ok || !resp.body) {
      throw new Error(`LLM HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let accumulatedText = '';
    let finalMeta: any = null;
    let sawEnd = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      buf = buf.replace(/\r/g, '');

      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = frame.split('\n').map(l => l.trim()).filter(Boolean);

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const s = line.slice('data:'.length).trim();
          if (!s) continue;

          let evt: any;
          try { evt = JSON.parse(s); } catch { continue; }

          if (evt.event === 'delta' && typeof evt.text === 'string') {
            // Parse JSONL from Python
            const jsonLines = evt.text.split('\n').filter(l => l.trim());
            for (const jsonLine of jsonLines) {
              try {
                const obj = JSON.parse(jsonLine);

                if (obj.type === 'delta' && obj.text) {
                  // Accumulate plain text deltas
                  accumulatedText += obj.text;
                  if (onDraft) onDraft(accumulatedText);
                } else if (obj.type === 'final') {
                  // New format: {type: "final", text: "...", meta: {...}}
                  accumulatedText = obj.text || accumulatedText;
                  finalMeta = obj.meta;
                  console.log('[LLM] Received final response with metadata:', finalMeta);
                } else if (obj.type === 'error') {
                  throw new Error(obj.message || 'LLM API Error');
                }
              } catch (err) {
                console.warn('Failed to parse JSONL:', jsonLine, err);
              }
            }
          }

          if (evt.event === 'error') {
            console.error('[LLM] Stream error:', evt.message);
            throw new Error(evt.message || 'LLM error');
          }

          if (evt.event === 'end') {
            sawEnd = true;
            console.log('[LLM] Stream ended');
          }
        }
      }
    }

    if (!accumulatedText.trim()) {
      throw new Error('LLM returned empty response');
    }

    return {
      text: accumulatedText.trim(),
      meta: finalMeta
    };
  };

  const handleStartExam = async () => {
    setState(ExamState.SETUP);
    try {
      setMessages([]);
      setAiDraft('');

      // Reset exam state machine
      setCurrentPart(0); // Start from intro
      setQuestionCount(0);

      // OPTIMIZATION: Use preset greeting immediately (0 latency)
      const greeting = PRESET_SCRIPTS.opening(currentExaminer.name);

      setMessages([{ role: 'model', text: greeting }]);
      speakText(greeting);

      setState(ExamState.ONGOING);
    } catch (error) {
      console.error("Failed to start exam", error);
      alert("初始化失败，请检查API Key设置。");
      setState(ExamState.IDLE);
    }
  };

  const handleNextExaminer = () => {
    setCurrentExaminerIdx((prev) => (prev + 1) % EXAMINERS.length);
  };

  const handlePrevExaminer = () => {
    setCurrentExaminerIdx((prev) => (prev - 1 + EXAMINERS.length) % EXAMINERS.length);
  };

  const cancelTtsPlayback = () => {
    // Abort in-flight stream
    if (ttsAbortRef.current) {
      try { ttsAbortRef.current.abort(); } catch { /* ignore */ }
      ttsAbortRef.current = null;
    }
    // Stop scheduled nodes
    for (const n of ttsNodesRef.current) {
      try { n.stop(0); } catch { /* ignore */ }
    }
    ttsNodesRef.current = [];
    ttsNextTimeRef.current = 0;
    if (ttsEndTimerRef.current) {
      window.clearTimeout(ttsEndTimerRef.current);
      ttsEndTimerRef.current = null;
    }
  };

  const decodeBase64ToInt16 = (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  };

  const playPcmChunk = (pcm16: Int16Array, sampleRate: number) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const buffer = ctx.createBuffer(1, pcm16.length, sampleRate);
    const ch0 = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) ch0[i] = pcm16[i] / 32768;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ttsNextTimeRef.current || 0, ctx.currentTime + 0.04);
    source.start(startAt);
    ttsNextTimeRef.current = startAt + buffer.duration;
    ttsNodesRef.current.push(source);

    // cleanup
    source.onended = () => {
      ttsNodesRef.current = ttsNodesRef.current.filter((n) => n !== source);
    };
  };

  const fallbackSpeakWithBrowser = (text: string) => {
    if (synthRef.current.speaking) synthRef.current.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synthRef.current.getVoices();
    // Simple heuristic to try and match voice to gender/accent (very basic)
    let preferredVoice = null;
    if (currentExaminer.gender === 'Female') {
      preferredVoice = voices.find(v => v.name.includes('Samantha') || v.name.includes('Google US English') || v.name.includes('Female'));
    } else {
      preferredVoice = voices.find(v => v.name.includes('Daniel') || v.name.includes('Google UK English Male') || v.name.includes('Male'));
    }
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onstart = () => setIsAiSpeaking(true);
    utterance.onend = () => setIsAiSpeaking(false);
    synthRef.current.speak(utterance);
  };

  const speakText = async (text: string) => {
    console.log('[TTS] speakText called:', text.slice(0, 30));
    if (!text?.trim()) return;

    // Prefer DashScope streaming TTS from BFF; fallback to browser speechSynthesis.
    cancelTtsPlayback();
    if (synthRef.current.speaking) synthRef.current.cancel();

    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      // must be resumed from a user gesture; we try, but if it fails we fallback
      await audioCtxRef.current.resume();

      setIsAiSpeaking(true);

      const ctrl = new AbortController();
      ttsAbortRef.current = ctrl;

      const resp = await fetch('/api/v1/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: currentExaminer.voice, // Use examiner-specific voice
          language_type: 'English',
          mode: 'server_commit',
          format: 'pcm_24000'
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`TTS HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      let lastScheduledEnd = 0;

      const flushEndTimer = () => {
        if (!audioCtxRef.current) return;
        const ctx = audioCtxRef.current;
        const endAt = Math.max(lastScheduledEnd, ttsNextTimeRef.current || 0);
        const delayMs = Math.max(0, (endAt - ctx.currentTime) * 1000);
        if (ttsEndTimerRef.current) window.clearTimeout(ttsEndTimerRef.current);
        ttsEndTimerRef.current = window.setTimeout(() => {
          setIsAiSpeaking(false);
          ttsEndTimerRef.current = null;
        }, delayMs + 30);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames are separated by blank line
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          const lines = frame.split('\n').map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice('data:'.length).trim();
            if (!jsonStr) continue;
            let evt: any = null;
            try { evt = JSON.parse(jsonStr); } catch { /* ignore */ }
            if (!evt) continue;

            if (evt.event === 'audio' && evt.b64) {
              console.log('[TTS] Received audio chunk, length:', evt.b64.length);
              const pcm16 = decodeBase64ToInt16(String(evt.b64));
              playPcmChunk(pcm16, 24000);
              if (audioCtxRef.current) lastScheduledEnd = Math.max(lastScheduledEnd, ttsNextTimeRef.current || 0);
              continue;
            }

            if (evt.event === 'error') {
              console.error('[TTS] Server error event:', evt.message);
              throw new Error(evt.message || 'TTS error');
            }

            if (evt.event === 'end') {
              console.log('[TTS] End event received');
              flushEndTimer();
            }
          }
        }
      }

      flushEndTimer();
      console.log('[TTS] Stream completed successfully');
    } catch (e: any) {
      console.error('[TTS] Error caught:', e);
      // 如果是我们主动 cancel/abort（例如开始录音时），不要回退到浏览器 TTS（否则会干扰录音）
      if (e?.name === 'AbortError') {
        setIsAiSpeaking(false);
        return;
      }

      // Downgrade "Connect failed" errors to warnings, as fallback works fine.
      const msg = e?.message || '';
      if (msg.includes('Connect failed') || msg.includes('TTS HTTP 500') || msg.includes('websocket connection could not established')) {
        console.warn('Backend TTS unavailable (network/env), switching to browser TTS (Normal Fallback)');
      } else {
        console.warn('Streaming TTS error, fallback to browser TTS:', e);
      }

      cancelTtsPlayback();
      fallbackSpeakWithBrowser(text);
    }
  };

  const toggleRecording = useCallback(() => {
    const stopRealtimeAsr = (sendAndClose: boolean, finalText?: string) => {
      // Clear any pending throttle timer and flush final text
      if (asrPartialTimerRef.current) {
        window.clearTimeout(asrPartialTimerRef.current);
        asrPartialTimerRef.current = null;
      }
      // Immediately show the latest buffered text
      if (asrPartialBufferRef.current) {
        setTranscript(asrPartialBufferRef.current);
      }

      try {
        if (asrWsRef.current?.readyState === WebSocket.OPEN) {
          // In manual commit mode, send commit to trigger final recognition
          if (sendAndClose) {
            console.log('[ASR] Sending commit message');
            asrWsRef.current.send(JSON.stringify({ type: 'commit' }));
            // Give a short delay for the final transcription to arrive
            setTimeout(() => {
              try {
                asrWsRef.current?.send(JSON.stringify({ type: 'close' }));
                asrWsRef.current?.close();
                asrWsRef.current = null;
              } catch {
                // ignore
              }
            }, 500);
          } else {
            asrWsRef.current.send(JSON.stringify({ type: 'close' }));
            asrWsRef.current?.close();
            asrWsRef.current = null;
          }
        }
      } catch {
        // ignore
      }

      // Only close immediately if not waiting for commit response
      if (!sendAndClose) {
        asrWsRef.current = null;
      }

      if (asrProcessorRef.current) {
        try { asrProcessorRef.current.disconnect(); } catch { }
        asrProcessorRef.current = null;
      }
      if (asrSourceRef.current) {
        try { asrSourceRef.current.disconnect(); } catch { }
        asrSourceRef.current = null;
      }
      if (asrGainRef.current) {
        try { asrGainRef.current.disconnect(); } catch { }
        asrGainRef.current = null;
      }
      if (asrCtxRef.current) {
        try { asrCtxRef.current.close(); } catch { }
        asrCtxRef.current = null;
      }
      if (asrStreamRef.current) {
        asrStreamRef.current.getTracks().forEach(t => t.stop());
        asrStreamRef.current = null;
      }

      setIsRecording(false);

      const toSend = (finalText ?? "").trim();
      console.log(`[ASR] stopRealtimeAsr: sendAndClose=${sendAndClose}, finalText=${finalText}, toSend="${toSend}"`);

      // Only input directly if we have an explicit final text (from VAD or other source).
      // Otherwise, we wait for the WebSocket 'final' event to handle the send.
      if (sendAndClose && toSend) {
        console.log('[ASR] Triggering handleSendMessage from stopRealtimeAsr');
        handleSendMessage(toSend);
      }
    };

    const int16ToBase64 = (pcm: Int16Array) => {
      const u8 = new Uint8Array(pcm.buffer);
      let bin = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < u8.length; i += chunkSize) {
        bin += String.fromCharCode(...u8.subarray(i, i + chunkSize));
      }
      return btoa(bin);
    };

    const startRealtimeAsr = async () => {
      console.log('[ASR] startRealtimeAsr called');
      // Avoid recording the examiner voice
      cancelTtsPlayback();
      if (synthRef.current.speaking) synthRef.current.cancel();

      finalTranscriptRef.current = '';
      autoStopGuardRef.current = false;
      setTranscript('');

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      // Bypass Vite proxy for WebSocket stability, connect directly to backend port 5176
      const wsUrl = `${proto}://${window.location.hostname}:5176/api/v1/asr/realtime/ws?language=en&threshold=0.0&silenceMs=400`;
      console.log('[ASR] Connecting to WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      asrWsRef.current = ws;

      ws.onopen = () => {
        console.log('[ASR] WebSocket connected');
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.event === 'error' && typeof msg.message === 'string') {
            console.error('[ASR] Server error:', msg.message);
            if (isRecordingRef.current) {
              autoStopGuardRef.current = true;
              stopRealtimeAsr(false);
            }
            alert(`实时语音识别失败：${msg.message}\n请检查后端服务与 DASHSCOPE_API_KEY。`);
            return;
          }
          if (msg.event === 'partial' && typeof msg.text === 'string') {
            // Manual commit mode: accumulate all partial text
            // OPTIMIZATION: Throttle UI updates to reduce re-renders
            asrPartialBufferRef.current = msg.text;
            finalTranscriptRef.current = msg.text; // Keep updating with latest

            // Only update UI every 300ms to avoid excessive re-renders
            if (!asrPartialTimerRef.current) {
              asrPartialTimerRef.current = window.setTimeout(() => {
                setTranscript(asrPartialBufferRef.current);
                asrPartialTimerRef.current = null;
              }, 300);
            }
            return;
          }
          if (msg.event === 'final' && typeof msg.text === 'string') {
            // In manual commit mode, final text comes after user clicks stop (commit)
            console.log('[ASR] Final transcript after commit:', msg.text);
            setTranscript(msg.text);
            finalTranscriptRef.current = msg.text;

            // Send to LLM and cleanup
            if (msg.text.trim()) {
              handleSendMessage(msg.text.trim());
            }

            // Cleanup after receiving final text
            setTimeout(() => {
              if (asrWsRef.current) {
                try {
                  asrWsRef.current.close();
                  asrWsRef.current = null;
                } catch {
                  // ignore
                }
              }
            }, 100);
            return;
          }
          if (msg.event === 'turn_end' && typeof msg.text === 'string') {
            // In manual commit mode, ignore turn_end (no auto VAD)
            // Just update the transcript but don't stop recording
            console.log('[ASR] Turn end (ignored in manual mode):', msg.text);
            setTranscript(msg.text);
            finalTranscriptRef.current = msg.text;
            return;
          }
        } catch {
          // ignore non-JSON
        }
      };
      ws.onerror = (e) => {
        console.error('[ASR] WebSocket error:', e);
        if (isRecordingRef.current) {
          autoStopGuardRef.current = true;
          stopRealtimeAsr(false);
          alert('实时语音识别连接失败，请检查后端服务与 DASHSCOPE_API_KEY。');
        }
      };
      ws.onclose = (e) => {
        console.log('[ASR] WebSocket closed:', e.code, e.reason);

        // Clean up throttle timer
        if (asrPartialTimerRef.current) {
          window.clearTimeout(asrPartialTimerRef.current);
          asrPartialTimerRef.current = null;
        }

        // If user didn't manually stop and no auto-stop happened, just end recording state.
        if (isRecordingRef.current && !autoStopGuardRef.current) {
          stopRealtimeAsr(false);
        }
      };

      console.log('[ASR] Requesting microphone access');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[ASR] Microphone access granted');
      asrStreamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      asrCtxRef.current = ctx;
      await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      asrSourceRef.current = source;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      asrGainRef.current = gain;

      try {
        console.log('[ASR] Loading AudioWorklet');
        await ctx.audioWorklet.addModule('/worklets/asr16k-worklet.js');
        console.log('[ASR] AudioWorklet loaded');
      } catch (e) {
        console.warn('[ASR] AudioWorklet load failed, falling back to ScriptProcessor', e);
        const scriptNode = ctx.createScriptProcessor(4096, 1, 1);
        scriptNode.onaudioprocess = (ev) => {
          const inputData = ev.inputBuffer.getChannelData(0);
          const targetRate = 16000;
          const ratio = ctx.sampleRate / targetRate;
          const newLength = Math.floor(inputData.length / ratio);
          const pcm16 = new Int16Array(newLength);
          for (let i = 0; i < newLength; i++) {
            const val = inputData[Math.floor(i * ratio)];
            pcm16[i] = Math.max(-1, Math.min(1, val)) * 0x7FFF;
          }
          if (asrWsRef.current && asrWsRef.current.readyState === WebSocket.OPEN) {
            asrWsRef.current.send(JSON.stringify({ type: 'audio', audio_b64: int16ToBase64(pcm16) }));
          }
        };
        asrSourceRef.current = source;
        source.connect(scriptNode);
        scriptNode.connect(gain);
        gain.connect(ctx.destination);
        setIsRecording(true);
        return;
      }

      const worklet = new AudioWorkletNode(ctx, 'asr16k-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      asrProcessorRef.current = worklet;

      worklet.port.onmessage = (ev) => {
        const data = ev.data;
        if (!data || data.type !== 'pcm16') return;
        if (!asrWsRef.current || asrWsRef.current.readyState !== WebSocket.OPEN) return;
        const pcm16 = new Int16Array(data.buffer);
        const b64 = int16ToBase64(pcm16);
        // console.log('[ASR] Sending audio chunk'); // Too noisy
        asrWsRef.current.send(JSON.stringify({ type: 'audio', audio_b64: b64 }));
      };

      source.connect(worklet);
      worklet.connect(gain);
      gain.connect(ctx.destination);

      setIsRecording(true);
      console.log('[ASR] Started recording');
    };

    if (isRecording) {
      // Manual stop: send whatever transcript we have
      stopRealtimeAsr(true, finalTranscriptRef.current || transcript);
    } else {
      startRealtimeAsr().catch((e) => {
        console.error('Failed to start realtime ASR:', e);
        alert('无法启动实时语音识别，请检查麦克风权限与后端服务。');
      });
    }
  }, [isRecording, transcript, messages]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { role: 'user', text };

    // Check if this is the answer to the greeting (Part 1 Start)
    // History: [Greeting] + [User Name] -> length 2
    const isFirstAnswer = messages.length === 1 && messages[0].role === 'model';

    // Build full history for LLM including this user message
    const historyForLlm: Array<{ role: 'user' | 'assistant'; text: string }> = [
      ...messages.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', text: m.text })),
      { role: 'user', text },
    ];

    setMessages(prev => [...prev, userMsg]);
    setTranscript('');

    try {
      setAiDraft('');
      const response = await fetchExaminerTurn(historyForLlm, { onDraft: (d) => setAiDraft(d) });
      const examinerText = response.text;

      // Add examiner's response to messages
      const modelMsg: Message = { role: 'model', text: examinerText };
      setMessages(prev => [...prev, modelMsg]);
      speakText(examinerText);

      // Update exam state based on metadata (State Machine)
      if (response.meta) {
        console.log('[State] Updating exam state:', response.meta);

        // Update question count (increment for most cases)
        if (response.meta.action !== 'end' && response.meta.action !== 'give_cue_card') {
          setQuestionCount(prev => prev + 1);
        }

        // Check if we should transition to next part
        if (response.meta.suggested_next_part !== undefined &&
          response.meta.suggested_next_part !== currentPart) {
          console.log(`[State] Transitioning from Part ${currentPart} to Part ${response.meta.suggested_next_part}`);
          setCurrentPart(response.meta.suggested_next_part);
          setQuestionCount(0); // Reset question count for new part
        }

        // Check if exam should end
        if (response.meta.should_end_exam) {
          console.log('[State] Exam completion detected');
          // Don't end immediately - let user manually end or continue
        }
      }

      setAiDraft('');
    } catch (error) {
      console.error("Error exchanging messages", error);
      setAiDraft('');
    }
  };

  // Trigger Confirmation instead of ending immediately
  const requestEndExam = () => {
    setShowEndConfirm(true);
  };

  const confirmEndExam = async () => {
    setShowEndConfirm(false);
    cancelTtsPlayback();
    if (synthRef.current.speaking) synthRef.current.cancel();
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsRecording(false);

    setState(ExamState.FEEDBACK);
    console.log('[Feedback] Starting feedback generation...');

    try {
      // Add 30s timeout for feedback generation
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const resp = await fetch('/api/v1/ielts/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen-plus',
          transcript: messages,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log('[Feedback] Response status:', resp.status);

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ error: 'unknown', message: 'Failed to parse error response' }));
        console.error('[Feedback] API error:', errorData);
        throw new Error(errorData.message || `HTTP ${resp.status}`);
      }

      const result = await resp.json() as FeedbackData;
      console.log('[Feedback] Received result:', result);

      if (result) {
        const resultWithMeta: FeedbackData = {
          ...result,
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
        };
        setFeedback(resultWithMeta);

        const newHistory = [resultWithMeta, ...history];
        setHistory(newHistory);
        localStorage.setItem('fluentflow_history', JSON.stringify(newHistory));
      } else {
        console.warn('[Feedback] Empty result received');
        setFeedback(null);
      }
    } catch (e: any) {
      console.error('[Feedback] Request failed:', e);

      // Show user-friendly error message
      const errorMsg = e.name === 'AbortError'
        ? '评估生成超时（30秒），请重试'
        : `评估生成失败：${e.message || '未知错误'}`;

      alert(errorMsg);

      // Set a placeholder feedback to show error state
      setFeedback({
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        reportVersion: 'v1',
        score: 0,
        fluency: 0,
        vocabulary: 0,
        grammar: 0,
        pronunciation: 0,
        strengths: ['评估生成失败'],
        improvements: [errorMsg],
        comment: '请返回重试或检查网络连接'
      });
    }
  };

  const handleViewHistoryItem = (item: FeedbackData) => {
    setFeedback(item);
    setState(ExamState.FEEDBACK);
  };

  // --- VIEW: IDLE / WAITING ROOM ---
  if (state === ExamState.IDLE || state === ExamState.SETUP) {
    return (
      <div className="flex flex-col items-center h-full pt-20 md:pt-32 p-8 text-center space-y-8 animate-fade-in relative z-10 max-w-4xl mx-auto">

        {/* Top Right History Icon */}
        <div className="absolute top-6 right-6 z-20">
          <button
            onClick={() => setState(ExamState.HISTORY)}
            className="w-10 h-10 rounded-full bg-white/50 backdrop-blur border border-white/40 shadow-sm flex items-center justify-center text-slate-600 hover:bg-white hover:text-ios-blue transition-all"
            title="历史记录"
          >
            <History size={20} />
          </button>
        </div>

        <div className="space-y-4 mb-4">
          <h2 className="text-4xl font-bold text-ios-text tracking-tight">选择你的考官</h2>
          <p className="text-ios-subtext text-lg leading-relaxed max-w-md mx-auto">
            不同的考官拥有不同的口音和提问风格，请左右切换选择。
          </p>
        </div>

        {/* Examiner Carousel */}
        <div className="flex items-center justify-center gap-4 md:gap-12 w-full">
          <button
            onClick={handlePrevExaminer}
            className="w-12 h-12 rounded-full bg-white border border-ios-divider shadow-sm flex items-center justify-center text-slate-500 hover:text-ios-blue hover:scale-110 transition-all"
          >
            <ChevronLeft size={24} />
          </button>

          <div className="relative group w-64 md:w-72 perspective-1000">
            <div className="absolute inset-0 bg-ios-blue/20 rounded-[2.5rem] blur-xl transform group-hover:scale-105 transition-transform duration-500"></div>
            <div className="bg-white rounded-[2.5rem] shadow-ios-hover relative border border-white/50 overflow-hidden transition-all duration-500 transform">
              <div className="h-64 md:h-72 w-full relative overflow-hidden">
                <img
                  key={currentExaminer.id}
                  src={currentExaminer.image}
                  alt={currentExaminer.name}
                  className="w-full h-full object-cover animate-fade-in"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                <div className="absolute bottom-0 left-0 right-0 p-6 text-left">
                  <h3 className="text-2xl font-bold text-white mb-1">{currentExaminer.name}</h3>
                  <div className="flex gap-2 text-white/80 text-xs font-medium">
                    <span className="flex items-center gap-1 bg-white/20 backdrop-blur-md px-2 py-0.5 rounded-full"><Globe size={10} /> {currentExaminer.accent}</span>
                    <span className="flex items-center gap-1 bg-white/20 backdrop-blur-md px-2 py-0.5 rounded-full"><User size={10} /> {currentExaminer.style}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleNextExaminer}
            className="w-12 h-12 rounded-full bg-white border border-ios-divider shadow-sm flex items-center justify-center text-slate-500 hover:text-ios-blue hover:scale-110 transition-all"
          >
            <ChevronRight size={24} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 w-full max-w-xs pt-4">
          <Button onClick={handleStartExam} isLoading={state === ExamState.SETUP} className="w-40 text-lg py-3 shadow-ios-blue/30 justify-center group">
            <span>开始考试</span>
            <div className="bg-white/20 rounded-full p-1 group-hover:translate-x-1 transition-transform">
              <ChevronRight className="w-4 h-4" />
            </div>
          </Button>

          <div className="flex justify-center gap-6 text-ios-subtext text-xs font-medium uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><Video size={14} className="text-green-500" /> Camera Ready</span>
            <span className="flex items-center gap-1.5"><Mic size={14} className="text-green-500" /> Audio Ready</span>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW: HISTORY ---
  if (state === ExamState.HISTORY) {
    return (
      <div className="flex flex-col h-full p-6 lg:p-10 overflow-y-auto no-scrollbar animate-fade-in pb-32 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold text-ios-text tracking-tight">历史考试记录</h2>
            <p className="text-ios-subtext text-sm mt-1">Exam History</p>
          </div>
          <Button onClick={() => setState(ExamState.IDLE)} variant="secondary" className="!px-5 !py-2.5">
            返回首页
          </Button>
        </div>

        <div className="space-y-4">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-96 text-ios-subtext space-y-4">
              <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center">
                <History size={32} className="opacity-20" />
              </div>
              <p>暂无考试记录</p>
            </div>
          ) : (
            history.map((item, idx) => (
              <div
                key={item.id || idx}
                onClick={() => handleViewHistoryItem(item)}
                className="group bg-white p-6 rounded-[1.5rem] shadow-ios hover:shadow-ios-hover border border-ios-divider/50 cursor-pointer transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-6">
                  <div className="w-14 h-14 rounded-full bg-slate-50 border border-ios-divider flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                    <span className={`text-xl font-bold ${item.score >= 7 ? 'text-green-600' : item.score >= 6 ? 'text-ios-blue' : 'text-orange-500'}`}>{item.score}</span>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-ios-text text-lg">IELTS Speaking Simulation</p>
                    <div className="flex items-center gap-3 text-xs text-ios-subtext mt-1.5 font-medium">
                      <span className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md"><Calendar size={12} /> {item.timestamp ? new Date(item.timestamp).toLocaleDateString() : 'Unknown'}</span>
                      <span className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">{item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden md:flex gap-2">
                    <span className="text-[10px] bg-slate-50 text-slate-500 px-2 py-1 rounded-lg font-medium">Fluency: {item.fluency}</span>
                    <span className="text-[10px] bg-slate-50 text-slate-500 px-2 py-1 rounded-lg font-medium">Vocab: {item.vocabulary}</span>
                  </div>
                  <ArrowRight size={20} className="text-slate-300 group-hover:text-ios-blue group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // --- VIEW: FEEDBACK REPORT ---
  if (state === ExamState.FEEDBACK) {
    return (
      <div className="flex flex-col h-full p-6 lg:p-10 overflow-y-auto no-scrollbar animate-fade-in pb-32 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold text-ios-text tracking-tight">评估报告</h2>
            <p className="text-ios-subtext text-sm mt-1">Assessment Report</p>
          </div>
          <Button onClick={() => setState(ExamState.IDLE)} variant="secondary" className="!px-5 !py-2.5">
            返回首页
          </Button>
        </div>

        {feedback ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Overall Score Card */}
            <div className="md:col-span-4 bg-white p-8 rounded-[2rem] shadow-ios flex flex-col items-center justify-center border border-ios-divider/50 relative overflow-hidden group min-h-[320px]">

              {/* Corrected SVG Circle */}
              <div className="relative mb-6 z-10 w-44 h-44 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90 drop-shadow-sm" viewBox="0 0 100 100">
                  {/* Background Track */}
                  <circle cx="50" cy="50" r="40" stroke="#E5E5EA" strokeWidth="8" fill="none" strokeLinecap="round" />
                  {/* Progress Indicator - r=40, Circumference approx 251.2 */}
                  <circle cx="50" cy="50" r="40" stroke="#0071e3" strokeWidth="8" fill="none"
                    strokeDasharray="251.2"
                    strokeDashoffset={251.2 - (251.2 * feedback.score) / 9}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-5xl font-bold text-ios-text tracking-tighter">{feedback.score}</span>
                  <span className="text-xs text-ios-subtext font-bold uppercase tracking-widest mt-1">总分</span>
                </div>
              </div>

              <div className="text-center z-10">
                <p className="text-ios-subtext text-sm font-medium">基于雅思官方标准</p>
                {feedback.timestamp && <p className="text-xs text-slate-400 mt-2">{new Date(feedback.timestamp).toLocaleString()}</p>}
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="md:col-span-8 grid grid-cols-2 gap-4">
              {[
                { label: '流利度 & 连贯性', sub: 'Fluency & Coherence', val: feedback.fluency },
                { label: '词汇多样性', sub: 'Lexical Resource', val: feedback.vocabulary },
                { label: '语法广度 & 准确性', sub: 'Grammar', val: feedback.grammar },
                { label: '发音', sub: 'Pronunciation', val: feedback.pronunciation }
              ].map((m) => (
                <div key={m.label} className="bg-white p-6 rounded-[1.5rem] shadow-ios border border-ios-divider/50 flex flex-col justify-between hover:shadow-ios-hover transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-sm font-bold text-ios-text">{m.label}</p>
                      <p className="text-[10px] text-ios-subtext font-medium uppercase tracking-wide mt-0.5">{m.sub}</p>
                    </div>
                    <span className="text-2xl font-bold text-ios-blue">{m.val}</span>
                  </div>
                  <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-ios-blue rounded-full transition-all duration-1000" style={{ width: `${(m.val / 9) * 100}%` }}></div>
                  </div>
                </div>
              ))}
            </div>

            {/* AI Comment */}
            <div className="md:col-span-12 bg-white/80 backdrop-blur-xl p-8 rounded-[2rem] border border-ios-divider shadow-ios mt-2">
              <h3 className="text-lg font-bold text-ios-text mb-6 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-ios-blue/10 flex items-center justify-center">
                  <MessageSquare size={16} className="text-ios-blue" />
                </div>
                考官详细点评
              </h3>
              <div className="prose prose-slate max-w-none">
                <p className="text-slate-600 leading-loose text-[15px] whitespace-pre-wrap">{feedback.comment}</p>
              </div>

              <div className="grid md:grid-cols-2 gap-8 pt-8 mt-6 border-t border-ios-divider">
                {feedback.strengths?.length > 0 && (
                  <div className="bg-green-50/50 p-6 rounded-2xl border border-green-100">
                    <h4 className="text-sm font-bold text-green-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div> 表现亮点
                    </h4>
                    <ul className="space-y-3">
                      {feedback.strengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-slate-700 font-medium">
                          <span className="text-green-500 mt-1">✓</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {feedback.improvements?.length > 0 && (
                  <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
                    <h4 className="text-sm font-bold text-ios-blue uppercase tracking-wider mb-4 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-ios-blue"></div> 改进建议
                    </h4>
                    <ul className="space-y-3">
                      {feedback.improvements.map((s, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-slate-700 font-medium">
                          <span className="text-ios-blue mt-1">↗</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-96 space-y-6">
            <div className="relative">
              <div className="w-20 h-20 border-[6px] border-slate-100 rounded-full"></div>
              <div className="w-20 h-20 border-[6px] border-ios-blue border-t-transparent rounded-full animate-spin absolute inset-0"></div>
            </div>
            <p className="text-ios-subtext font-medium animate-pulse text-lg">正在生成详细的评估报告...</p>
          </div>
        )}
      </div>
    );
  }

  // --- VIEW: ONGOING EXAM (VIDEO CONFERENCE STYLE) ---
  return (
    <div className="flex flex-col h-full items-center justify-center p-4 lg:p-8 animate-fade-in w-full">

      {/* MAIN VIDEO FRAME */}
      <div className="relative w-full max-w-6xl aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl ring-1 ring-black/10 group isolation-auto">

        {/* 1. EXAMINER FEED (Background) */}
        <div className="absolute inset-0">
          <img
            src={currentExaminer.image}
            alt="Examiner"
            className={`w-full h-full object-cover transition-transform duration-[20s] ease-linear ${isAiSpeaking ? 'scale-110' : 'scale-100'}`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30"></div>
          <div className="absolute inset-0 bg-black/10"></div>
        </div>

        {/* 2. HEADER OVERLAY */}
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start z-10">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              <span className="text-white/90 text-xs font-medium tracking-wide">REC</span>
              <span className="text-white/50 text-xs px-1">|</span>
              <span className="text-white/90 text-xs font-medium tracking-wide">IELTS Speaking Test</span>
            </div>
          </div>

          {/* Examiner Status */}
          {isAiSpeaking && (
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 animate-fade-in">
              <div className="flex gap-1 h-3 items-end">
                <div className="w-1 bg-green-400 rounded-full animate-[bounce_1s_infinite] h-2"></div>
                <div className="w-1 bg-green-400 rounded-full animate-[bounce_1s_infinite_0.2s] h-3"></div>
                <div className="w-1 bg-green-400 rounded-full animate-[bounce_1s_infinite_0.4s] h-1.5"></div>
              </div>
              <span className="text-xs font-medium text-white">Examiner Speaking</span>
            </div>
          )}
        </div>

        {/* 3. SUBTITLES */}
        <div className="absolute bottom-32 left-0 right-0 flex justify-center px-8 z-20 pointer-events-none">
          {(transcript || aiDraft || messages.length > 0) && (
            <div className="bg-black/70 backdrop-blur-lg px-8 py-4 rounded-2xl max-w-3xl text-center shadow-lg border border-white/5 transform transition-all duration-300">
              <p className="text-xl md:text-2xl font-medium text-white leading-relaxed tracking-wide font-sans">
                {isRecording
                  ? (transcript || "Listening...")  // User speaking: show realtime transcript
                  : (isAiSpeaking || (messages.length > 0 && messages[messages.length - 1].role === 'model'))
                    ? "..." // Examiner speaking: hide text, show placeholder
                    : (transcript || "...")
                }
              </p>
            </div>
          )}
        </div>

        {/* 4. USER PIP */}
        <div className="absolute top-6 right-6 w-48 aspect-[4/3] md:w-64 bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/20 z-20 group/pip">
          {videoEnabled ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-400">
              <div className="bg-slate-700 p-3 rounded-full mb-2">
                <VideoOff size={20} className="text-slate-400" />
              </div>
              <span className="text-xs">Camera Off</span>
            </div>
          )}
          <div className="absolute bottom-2 right-2 flex gap-2 opacity-0 group-hover/pip:opacity-100 transition-opacity duration-300">
            <button
              onClick={() => setVideoEnabled(!videoEnabled)}
              className="p-2 bg-black/60 backdrop-blur-md hover:bg-black/80 rounded-full text-white transition-colors"
            >
              {videoEnabled ? <Video size={12} /> : <VideoOff size={12} />}
            </button>
          </div>
          {isRecording && (
            <div className="absolute top-2 right-2 bg-green-500 p-1.5 rounded-full shadow-sm animate-pulse">
              <Mic size={10} className="text-white" />
            </div>
          )}
        </div>

        {/* 5. BOTTOM CONTROL BAR */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-center gap-8 pb-4 z-30">

          <button
            onClick={() => {
              const lastAiMsg = [...messages].reverse().find(m => m.role === 'model');
              if (lastAiMsg) speakText(lastAiMsg.text);
            }}
            className="flex flex-col items-center gap-1 group/btn"
          >
            <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/10 flex items-center justify-center text-white group-hover/btn:bg-white/20 transition-all">
              <RefreshCw size={20} />
            </div>
            <span className="text-[10px] font-medium text-white/60">Repeat</span>
          </button>

          <button
            onClick={toggleRecording}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 transform hover:scale-105 shadow-xl border-4 ${isRecording
              ? 'bg-red-500 border-red-900/50 recording-pulse'
              : 'bg-white border-white/50 hover:bg-slate-200'
              }`}
          >
            {isRecording ? <Square className="fill-white text-white w-6 h-6" /> : <Mic className="w-7 h-7 text-black ml-0.5" />}
          </button>

          {/* End Exam with Confirm */}
          <button
            onClick={requestEndExam}
            className="flex flex-col items-center gap-1 group/btn"
          >
            <div className="w-12 h-12 rounded-full bg-red-500/20 backdrop-blur-md border border-red-500/30 flex items-center justify-center text-red-400 group-hover/btn:bg-red-500 group-hover/btn:text-white transition-all">
              <Square size={18} className="fill-current" />
            </div>
            <span className="text-[10px] font-medium text-white/60">End</span>
          </button>
        </div>
      </div>

      <div className="mt-6 text-center">
        <p className={`text-sm font-medium transition-colors duration-300 ${isRecording ? 'text-red-500' : 'text-ios-subtext'}`}>
          {isRecording ? "Listening to your answer..." : isAiSpeaking ? "Examiner is speaking..." : "Tap the microphone to answer"}
        </p>
      </div>

      {/* End Exam Confirmation Modal */}
      <Modal
        isOpen={showEndConfirm}
        title="结束考试?"
        message="您还未完成本次考试，此时结束考试会影响您的最终成绩，确认要结束吗？"
        confirmText="确认结束"
        isDanger={true}
        onConfirm={confirmEndExam}
        onCancel={() => setShowEndConfirm(false)}
      />
    </div>
  );
};

export default IeltsExam;