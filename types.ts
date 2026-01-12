
export enum AppTab {
  EXAM = 'EXAM',
  SHADOWING = 'SHADOWING'
}

export enum ExamState {
  IDLE = 'IDLE',
  SETUP = 'SETUP',
  ONGOING = 'ONGOING',
  FEEDBACK = 'FEEDBACK',
  HISTORY = 'HISTORY'
}

export interface Message {
  role: 'user' | 'model';
  text: string;
}

export interface FeedbackData {
  id?: string; // Unique ID for history
  timestamp?: string; // Date of the exam
  reportVersion?: string; // Report schema/versioning for future iterations
  score: number;
  fluency: number;
  vocabulary: number;
  grammar: number;
  pronunciation: number;
  strengths: string[];
  improvements: string[];
  comment: string;
}

export interface ExaminerTurnResponse {
  examinerText: string;
  action: 'ask' | 'give_cue_card' | 'ask_followup' | 'end_part';
  part: 1 | 2 | 3;
  shouldEndExam: boolean;
}

export interface ShadowingMaterial {
  id: string;
  title: string;
  category: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  duration: string;
  text: string;
  audioUrl?: string; // Optional for simulation
}
