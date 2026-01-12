import { ShadowingMaterial } from './types';

// ============================================================
// OBSOLETE: The following configs were for Google AI Studio
// Now using DashScope (Alibaba Qwen) APIs instead
// ============================================================
/*
export const GEMINI_MODEL = 'gemini-3-flash-preview';

export const IELTS_SYSTEM_INSTRUCTION = `
You are a professional, polite, and neutral IELTS Speaking Examiner named "Alex". 
Your goal is to conduct a realistic IELTS Speaking test (Parts 1, 2, and 3) with the user.
1. Start by briefly introducing yourself and asking for the candidate's name.
2. Ask one question at a time. Wait for the user's response.
3. Do not correct the user during the exam.
4. Keep your responses short (under 30 words) to allow the user to speak more, unless you are explaining a Part 2 topic card.
5. If the user asks for feedback, politely refuse and say you will provide it at the end of the test.
6. Progress naturally from Part 1 (Introduction) to Part 2 (Cue Card - give them a topic) to Part 3 (Discussion).
7. Speak ONLY in English during the exam.
8. IMPORTANT OUTPUT FORMAT: For every turn during the exam, you MUST return ONLY a valid JSON object with the following fields:
{
  "examinerText": "string (English only)",
  "action": "ask" | "give_cue_card" | "ask_followup" | "end_part",
  "part": 1 | 2 | 3,
  "shouldEndExam": boolean
}
`;

export const FEEDBACK_PROMPT = `
You are an IELTS Speaking Rater (not the examiner). The exam is finished.
Based on the entire conversation history above, evaluate the candidate's performance according to official IELTS Speaking criteria:
Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation.

Return ONLY a valid JSON object and nothing else.
IMPORTANT: Provide the 'strengths', 'improvements', and 'comment' fields in Simplified Chinese (zh-CN).
Be conservative if the transcript is short or unclear; mention limitations in the comment when evidence is insufficient.

Structure:
{
  "reportVersion": "v1",
  "score": number (0-9, 0.5 increments),
  "fluency": number (0-9, 0.5 increments),
  "vocabulary": number (0-9, 0.5 increments),
  "grammar": number (0-9, 0.5 increments),
  "pronunciation": number (0-9, 0.5 increments),
  "strengths": ["string (Chinese)", "string (Chinese)"],
  "improvements": ["string (Chinese)", "string (Chinese)"],
  "comment": "string (Chinese overall summary)"
}
`;
*/
// ============================================================

export const MOCK_SHADOWING_DATA: ShadowingMaterial[] = [
  {
    id: '1',
    title: '乔布斯演讲：保持饥渴',
    category: '名人演讲',
    difficulty: 'Medium',
    duration: '1:30',
    text: "You can't connect the dots looking forward; you can only connect them looking backwards. So you have to trust that the dots will somehow connect in your future."
  },
  {
    id: '2',
    title: '商务谈判技巧',
    category: '商务英语',
    difficulty: 'Hard',
    duration: '2:15',
    text: "I understand your position, but we need to consider the long-term implications of this agreement. Can we meet halfway on the delivery timeline?"
  },
  {
    id: '3',
    title: '日常咖啡闲聊',
    category: '生活口语',
    difficulty: 'Easy',
    duration: '0:45',
    text: "Hey! Long time no see. How have you been? I heard you started a new job recently."
  }
];