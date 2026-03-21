export interface VocabularyItem {
  word: string;
  translation: string;
  part_of_speech: string;
  example: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConversationSettings {
  agent_id: string;
  target_language: string;
  history?: HistoryMessage[];
}

export interface LlmResponse {
  reply_text: string;
  corrected: string | null;
  has_error: boolean;
  vocabulary: VocabularyItem[];
}

export interface ConversationResponse {
  user_text: string;
  reply_text: string;
  reply_audio: string;
  corrected: string | null;
  has_error: boolean;
  vocabulary: VocabularyItem[];
}
