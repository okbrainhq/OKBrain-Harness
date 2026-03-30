// Database wrapper interface
export interface DbWrapper {
  prepare: (sql: string) => {
    all: (...params: any[]) => Promise<any[]>
    get: (...params: any[]) => Promise<any>
    run: (...params: any[]) => Promise<{ changes: number; lastInsertRowid: number }>
  }
  exec: (sql: string) => Promise<void>
  transaction: <T>(fn: () => Promise<T>) => () => Promise<T>
}

// Response mode types
export type ResponseMode = 'quick' | 'detailed';

// Folder types
export interface Folder {
  id: string;
  name: string;
  user_id: string;
  is_shared?: number;
  created_at: string;
  updated_at: string;
}

// Conversation types
export interface Conversation {
  id: string;
  title: string;
  folder_id?: string | null;
  grounding_enabled?: number;
  response_mode?: string;
  ai_provider?: string; // 'gemini' | 'xai'
  document_ids?: string[];
  active_job_id?: string | null;
  last_fact_extracted_at?: string | null;
  source_shared_link_id?: string | null;
  app_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "summary";
  content: string;
  model?: string; // AI model name
  sources?: string; // JSON string of sources array
  was_grounded?: number; // Whether grounding was enabled for this message
  thoughts?: string; // Model's thinking text (for display only, not included in history)
  thought_signature?: string; // Opaque signature for reusing thoughts in subsequent requests
  thinking_duration?: number; // Duration in seconds the model spent thinking
  feedback?: number | null; // User feedback rating: 1 for good, -1 for bad
  created_at: string;
}

export interface FileAttachment {
  id: string;
  message_id: string;
  file_uri: string; // Gemini FILE API URI
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string; // Server timestamp of upload
  created_at: string;
}

// Document types
export interface Document {
  id: string;
  title: string;
  content: string;
  folder_id?: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

// User types
export interface User {
  id: string;
  email: string;
  password?: string; // Hashed - omitted in some contexts
  created_at: string;
  updated_at: string;
}

// User Memory types
export interface UserMemory {
  user_id: string;
  memory_text: string;
  updated_at: string;
}

// Event types
export interface Event {
  id: string;
  user_id: string;
  title: string;
  description: string;
  location: string;
  start_datetime: string; // ISO 8601 datetime string
  end_datetime: string | null; // ISO 8601 datetime string, optional
  recurrence_type: string | null; // 'weekly' or 'monthly', null for non-recurring
  recurrence_end_date: string | null; // ISO 8601 date string, when recurrence stops
  created_at: string;
  updated_at: string;
}

// Document Snapshot types
export interface DocumentSnapshot {
  id: string;
  document_id: string;
  user_id: string;
  message: string;
  title: string;
  content: string;
  created_at: string;
}

// Shared Link types
export interface SharedLink {
  id: string;
  type: 'conversation' | 'document' | 'snapshot';
  resource_id: string;
  user_id: string;
  created_at: string;
}

// File Browser types
export interface FileBrowser {
  id: string;
  title: string;
  current_path: string;
  folder_id?: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

// App types
export interface App {
  id: string;
  title: string;
  description: string;
  folder_id?: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface AppSecret {
  id: string;
  app_id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

// Sidebar item types
export interface SidebarItem {
  id: string;
  title: string;
  folder_id?: string | null;
  updated_at: string;
  type: 'chat' | 'document' | 'filebrowser' | 'app';
  active_job_id?: string | null;
  is_running?: number;
  is_yielding?: number;
}

// Fact types
export interface Fact {
  id: string;
  user_id: string;
  category: string;
  fact: string;
  created_at: string;
  extraction_count: number;
}

// Fact Sheet types
export interface FactSheet {
  id: string;
  user_id: string;
  facts_json: string;
  dedup_log: string | null;
  fact_count: number;
  source: string;
  created_at: string;
}

export interface FactSheetEntry {
  category: string;
  fact: string;
}

// Job system types
export type JobState = 'idle' | 'running' | 'stopping' | 'stopped' | 'succeeded' | 'failed';
export type JobQueueState = 'queued' | 'claimed' | 'done' | 'failed';
export type JobEventKind = 'input' | 'output' | 'thought' | 'status' | string;

export interface Job {
  id: string;
  type: string;
  user_id: string | null;
  state: JobState;
  last_seq: number;
  last_input_seq: number;
  created_at: string;
  updated_at: string;
}

export interface JobEvent {
  id: string;
  job_id: string;
  seq: number;
  kind: JobEventKind;
  payload: string; // JSON string
  created_at: string;
}

export interface JobQueueItem {
  id: string;
  job_id: string;
  input: string; // JSON string
  priority: number;
  state: JobQueueState;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ConversationToolJobState = 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout';

export type ToolCallLogStatus = 'requested' | 'yielded' | 'succeeded' | 'failed';

export interface ToolCallLog {
  id: string;
  conversation_id: string;
  parent_job_id: string | null;
  message_id: string | null;
  tool_call_id: string;
  tool_name: string;
  status: ToolCallLogStatus;
  arguments: string;
  response: string | null;
  error: string | null;
  async_job_id: string | null;
  yielded_at: string | null;
  completed_at: string | null;
  is_retrieval_tool: number;
  created_at: string;
  updated_at: string;
}

// Chat Event types for chronological rendering
export type ChatEventKind =
  | 'user_message'
  | 'assistant_text'
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'status'
  | 'sources'
  | 'summary'
  | 'compaction'
  | 'stopped';

export interface ChatEvent {
  id: string;
  conversation_id: string;
  seq: number;
  kind: ChatEventKind;
  content: string; // JSON string in DB, parsed on read
  feedback?: number | null;
  created_at: string;
}

export interface UserMessageContent {
  text: string;
  model?: string;
  attachments?: Array<{ name: string; uri: string; mime_type: string }>;
  image?: { mimeType: string; base64: string };
}

export interface AssistantTextContent {
  text: string;
  model?: string;
  was_grounded?: number;
}

export interface ThoughtContent {
  text: string;
  duration?: number;
  signature?: string;
}

export interface ToolCallContent {
  tool_name: string;
  arguments: any;
  call_id: string;
  async_job_id?: string;
}

export interface ToolResultContent {
  call_id: string;
  status: 'success' | 'error' | 'timeout' | 'yield' | 'cancelled';
  error?: string;
}

export interface StatusContent {
  text: string;
}

export interface SourcesContent {
  items: Array<{ url?: string; uri?: string; title?: string }>;
}

export interface SummaryContent {
  text: string;
  model?: string;
}

export type ChatYieldSessionState = 'waiting' | 'resume_queued' | 'resumed' | 'cancelled' | 'failed';
export type ChatYieldSessionOriginExit = 'yield_exit';
export type ChatYieldSessionResumeReason = 'all_completed' | 'timeout_decision';

export interface ChatYieldSession {
  id: string;
  conversation_id: string;
  user_id: string;
  origin_chat_job_id: string;
  origin_exit: ChatYieldSessionOriginExit;
  state: ChatYieldSessionState;
  yield_note: string;
  deadline_at: string;
  next_check_at: string;
  resume_reason: ChatYieldSessionResumeReason | null;
  resume_attempt_count: number;
  last_error: string | null;
  resume_queued_at: string | null;
  timed_out_at: string | null;
  resume_job_id: string | null;
  partial_output: string | null;
  partial_thoughts: string | null;
  partial_thinking_duration: number | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationToolJob {
  id: string;
  conversation_id: string;
  parent_job_id: string;
  job_id: string;
  message_id: string | null;
  tool_name: string;
  metadata: string | null;
  state: ConversationToolJobState;
  output: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
