import { GoogleGenAI, Chat, GenerateContentResponse, Type } from "@google/genai";
import { GEMINI_MODEL, IELTS_SYSTEM_INSTRUCTION, FEEDBACK_PROMPT } from "../constants";
import { ExaminerTurnResponse, FeedbackData } from "../types";

let client: GoogleGenAI | null = null;

const getClient = () => {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return client;
};

export const startIeltsSession = (): Chat => {
  const ai = getClient();
  return ai.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction: IELTS_SYSTEM_INSTRUCTION,
      temperature: 0.7,
    },
  });
};

export const sendMessageToGemini = async (chat: Chat, message: string): Promise<string> => {
  try {
    // Force structured JSON output for each examiner turn
    const response: GenerateContentResponse = await chat.sendMessage({
      message,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            examinerText: { type: Type.STRING },
            action: { type: Type.STRING },
            part: { type: Type.NUMBER },
            shouldEndExam: { type: Type.BOOLEAN },
          },
          required: ["examinerText", "action", "part", "shouldEndExam"],
        },
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      return JSON.stringify({
        examinerText: "I'm sorry, I didn't catch that. Could you repeat?",
        action: "ask",
        part: 1,
        shouldEndExam: false,
      } satisfies ExaminerTurnResponse);
    }

    // Keep the return type backward-compatible (string), but now it's JSON string.
    return jsonText;
  } catch (error) {
    console.error("Gemini Error:", error);
    return JSON.stringify({
      examinerText: "Connection error. Please try again.",
      action: "ask",
      part: 1,
      shouldEndExam: false,
    } satisfies ExaminerTurnResponse);
  }
};

export const getExamFeedback = async (chat: Chat): Promise<FeedbackData | null> => {
  try {
    // We send a final message to the existing chat context to generate feedback
    const response: GenerateContentResponse = await chat.sendMessage({ 
      message: FEEDBACK_PROMPT,
      config: {
        responseMimeType: "application/json",
         responseSchema: {
            type: Type.OBJECT,
            properties: {
              reportVersion: { type: Type.STRING },
              score: { type: Type.NUMBER },
              fluency: { type: Type.NUMBER },
              vocabulary: { type: Type.NUMBER },
              grammar: { type: Type.NUMBER },
              pronunciation: { type: Type.NUMBER },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
              comment: { type: Type.STRING }
            },
            required: ["reportVersion", "score", "fluency", "vocabulary", "grammar", "pronunciation", "strengths", "improvements", "comment"]
         }
      } 
    });

    const jsonText = response.text;
    if (!jsonText) return null;

    return JSON.parse(jsonText) as FeedbackData;
  } catch (error) {
    console.error("Feedback Generation Error:", error);
    return null;
  }
};