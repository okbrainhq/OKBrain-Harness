/**
 * Chat Worker
 *
 * Processes chat jobs using AI providers (Gemini/XAI).
 * Streams responses through job events for real-time updates.
 */

import { registerWorker, ClaimedJob, WorkerContext, stopJob } from '../lib/jobs';
import { getAIProvider, getModel, injectContextMessages, buildMessagesFromEvents } from '../lib/ai';
import { generateTitle } from '../lib/ai/title';
import { AIFileData } from '../lib/ai/types';
import {
  updateConversationTitle,
  getConversation,
  getUserMemory,
  getConversationDocuments,
  getLatestFactSheet,
  getRecentConversationsWithUserMessages,
  searchFactsByEmbedding,
  ResponseMode,
  setConversationActiveJob,
  getConversationToolJobsByParentJob,
  getYieldedToolCallLogsByParentJob,
  createChatYieldSession,
  updateConversationToolJobState,
  updateToolCallLogResult,
  addChatEvent,
  getChatEvents,
  getAppSecretsAsEnv,
  setConversationLoopState,
} from '../lib/db';
import type { FactSheetEntry } from '../lib/db';
import { getUpcomingEventsContext } from '../lib/ai/tools/events';
import { runWithParentJobContext } from '../lib/ai/tools/job-context';
import { CODING_TOOL_NAMES } from '../lib/ai/tools/coding-tools';
import { embedQuery, isOllamaAvailable, isEmbeddingsEnabled } from '../lib/ai/embeddings';


function createReasoningTagClassifier() {
  const openingTags = ['<think>', '<thinking>'];
  const closingTags = ['</think>', '</thinking>'];
  const allTags = [...openingTags, ...closingTags];
  const maxTagLength = Math.max(...allTags.map((tag) => tag.length));

  let mode: 'output' | 'thought' = 'output';
  let carry = '';

  const findNextTag = (text: string, tags: string[]): { index: number; tag: string } => {
    let index = -1;
    let tag = '';
    for (const candidate of tags) {
      const candidateIndex = text.indexOf(candidate);
      if (candidateIndex !== -1 && (index === -1 || candidateIndex < index)) {
        index = candidateIndex;
        tag = candidate;
      }
    }
    return { index, tag };
  };

  const splitTrailingPartial = (text: string, tags: string[]): { ready: string; partial: string } => {
    const maxLen = Math.min(maxTagLength - 1, text.length);
    for (let len = maxLen; len > 0; len--) {
      const suffix = text.slice(-len);
      if (tags.some((tag) => tag.startsWith(suffix))) {
        return {
          ready: text.slice(0, -len),
          partial: suffix,
        };
      }
    }
    return { ready: text, partial: '' };
  };

  const consume = (chunkText: string): { outputText: string; thoughtText: string } => {
    let outputText = '';
    let thoughtText = '';
    let working = `${carry}${chunkText}`;
    carry = '';

    while (working.length > 0) {
      const tags = mode === 'output' ? openingTags : closingTags;
      const { index, tag } = findNextTag(working, tags);

      if (index === -1) {
        const { ready, partial } = splitTrailingPartial(working, tags);
        if (mode === 'output') {
          outputText += ready;
        } else {
          thoughtText += ready;
        }
        carry = partial;
        break;
      }

      const beforeTag = working.slice(0, index);
      if (mode === 'output') {
        outputText += beforeTag;
      } else {
        thoughtText += beforeTag;
      }

      working = working.slice(index + tag.length);
      mode = mode === 'output' ? 'thought' : 'output';
    }

    return { outputText, thoughtText };
  };

  const flush = (): { outputText: string; thoughtText: string } => {
    if (!carry) return { outputText: '', thoughtText: '' };
    const remaining = carry;
    carry = '';
    if (mode === 'output') {
      return { outputText: remaining, thoughtText: '' };
    }
    return { outputText: '', thoughtText: remaining };
  };

  return { consume, flush };
}

async function generateObserverSummary(
  toolCalls: any[],
  thoughts: string,
  partialResponse: string
): Promise<string> {
  const gemini = getAIProvider('gemini', { thinking: true });
  
  const summaryPrompt = `You are an observer summarizing what happened in an AI conversation that was interrupted.

TOOL CALLS THAT WERE EXECUTED:
${JSON.stringify(toolCalls.map(t => ({ name: t.name, arguments: t.arguments })), null, 2)}

THE AI'S THOUGHTS DURING PROCESSING:
${thoughts}

PARTIAL RESPONSE (if any):
${partialResponse || 'None'}

Generate a detailed summary of what the AI was doing, what it accomplished, and what it was about to do when interrupted. Be specific about the tool calls made and their purposes. Write in a neutral, observer tone.`;

  let summary = '';
  
  await gemini.generateStream(
    [{ role: 'user', content: summaryPrompt }],
    async (chunk) => {
      if (chunk.text) {
        summary += chunk.text;
      }
    },
    { thinking: true }
  );
  
  if (!summary) {
    summary = `Process was interrupted after executing ${toolCalls.length} tool calls. The AI was working on the task but did not complete its response.`;
  }
  
  return summary;
}

function extractYieldNote(raw: string): { note: string | null; stripped: string } {
  if (!raw) return { note: null, stripped: raw };
  const match = raw.match(/<yeild>([\s\S]*?)<\/yeild>/i) || raw.match(/<yeild>([\s\S]*?)<\/yield>/i);
  if (!match) return { note: null, stripped: raw };
  const note = (match[1] || '').trim();
  const stripped = raw
    .replace(/<yeild>[\s\S]*?<\/yeild>/ig, '')
    .replace(/<yeild>[\s\S]*?<\/yield>/ig, '')
    .trim();
  return {
    note: note || null,
    stripped,
  };
}

function mergeContinuation(prefix?: string | null, continuation?: string | null): string {
  const base = prefix || '';
  const next = continuation || '';
  if (!base) return next;
  if (!next) return base;
  if (next.startsWith(base)) return next;
  if (base.endsWith(next)) return base;
  return `${base}${next}`;
}

function buildResumeContextBlock(input: NonNullable<ChatJobInput['resumeContext']>): string {
  const maxCharsRaw = Number(process.env.RESUME_TOOL_OUTPUT_MAX_CHARS || '120000');
  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 120000;

  const serializeWithLimit = (value: any): string => {
    let serialized: string;
    try {
      serialized = JSON.stringify(value, null, 2);
    } catch {
      serialized = String(value);
    }

    if (serialized.length <= maxChars) {
      return serialized;
    }

    const hidden = serialized.length - maxChars;
    return `${serialized.slice(0, maxChars)}\n... [truncated ${hidden} chars due to RESUME_TOOL_OUTPUT_MAX_CHARS=${maxChars}]`;
  };

  const lines = [
    'RESUME CONTEXT:',
    'You are continuing a previously yielded assistant run.',
    `Resume reason: ${input.resumeReason}`,
    `Yield note from previous run: ${input.yieldNote}`,
    `Elapsed since yield: ${Math.max(0, Math.floor(input.elapsedMs))}ms`,
    `Yield timeout: ${Math.max(0, Math.floor(input.timeoutMs))}ms`,
    '',
    'IMPORTANT DECISION RULES:',
    '- Treat this as continuation of the same task.',
    '- Use the tool snapshot below to decide the next action.',
  ];

  if (input.resumeReason === 'timeout_decision') {
    lines.push('- A timeout occurred while waiting for yielded tool jobs.');
    lines.push('- Choose one of these options:');
    lines.push('  1) Continue waiting by yielding again with exactly one <yeild>...</yeild> note.');
    lines.push('  2) Stop specific running jobs using kill_tool_call_job.');
    lines.push('  3) Proceed with available results.');
    lines.push('- Use kill_tool_call_job only when waiting no longer provides value.');
  } else {
    lines.push('- All yielded tool jobs reached terminal states.');
    lines.push('- Treat successful outputs as authoritative and continue from them.');
  }

  lines.push('- Do not rerun completed tool calls unless absolutely necessary.');
  lines.push('- Do not call retrieve_tool_responses unless output is truncated.');
  lines.push('');
  lines.push('Yielded tool calls snapshot (JSON):');

  const completedCallPayload = input.toolCalls.map((call) => ({
    tool_call_id: call.tool_call_id,
    tool_name: call.tool_name,
    log_status: call.log_status,
    job_state: call.job_state,
    is_terminal: call.is_terminal,
    response: call.response ?? null,
    error: call.error ?? null,
  }));

  lines.push(serializeWithLimit(completedCallPayload));
  lines.push('');
  lines.push('Continue from the snapshot above.');
  return lines.join('\n');
}

export interface ChatJobInput {
  userId: string;
  conversationId: string;
  userMessageId: string;
  message: string;
  thinking: boolean;
  mode: ResponseMode;
  aiProvider: 'gemini' | 'gemini-pro' | 'xai' | 'claude-sonnet' | 'claude-haiku';
  location?: string;
  documentIds: string[];
  contentContexts?: Array<{ title: string; content: string }>;
  fileData?: AIFileData[];
  imageData?: { mimeType: string; base64: string };
  appId?: string | null;
  resumeContext?: {
    yieldSessionId: string;
    yieldNote: string;
    originChatJobId: string;
    resumeReason: 'all_completed' | 'timeout_decision';
    timeoutMs: number;
    elapsedMs: number;
    partialOutput?: string;
    partialThoughts?: string;
    partialThinkingDuration?: number;
    toolCalls: Array<{
      tool_call_id: string;
      tool_name: string;
      log_status: 'yielded' | 'succeeded' | 'failed';
      job_state: string | null;
      is_terminal: boolean;
      response: any;
      error: string | null;
    }>;
  };
}

async function handleChatJob(job: ClaimedJob, ctx: WorkerContext): Promise<void> {
  const input = job.input as ChatJobInput;
  const {
    userId,
    conversationId,
    userMessageId,
    message,
    thinking,
    mode,
    aiProvider,
    location,
    documentIds,
    contentContexts,
    fileData,
    imageData,
    appId,
    resumeContext,
  } = input;

  console.log(`[ChatWorker] Processing job ${job.jobId} for conversation: ${conversationId}`);

  // Get AI provider
  const ai = getAIProvider(aiProvider, { thinking });

  // Check if we should include thoughts in history for this model
  const resolvedModel = getModel(aiProvider);
  const includeThoughtsInHistory = resolvedModel.context.includeThoughtsInHistory === true;

  // Build AI context from chat events
  const chatEvents = await getChatEvents(conversationId);
  const baseMessages = buildMessagesFromEvents(chatEvents, {
    modelName: ai.getModelName(),
    includeThoughtsInHistory,
    imageData,
    fileData,
  });

  if (resumeContext) {
    const resumeBlock = buildResumeContextBlock(resumeContext);
    baseMessages.push(
      {
        role: 'assistant',
        content: resumeContext.resumeReason === 'timeout_decision'
          ? 'Acknowledged. A tool wait timeout occurred. I will decide whether to wait, stop jobs, or continue with available outputs.'
          : 'Acknowledged. I have the yielded tool outputs and will continue without re-running completed calls.',
        model: ai.getModelName(),
      },
      { role: 'user', content: resumeBlock }
    );
  }

  // Skip heavy context injection for minimal-context models (e.g., Ollama with small context windows)
  const minimalContext = resolvedModel.context.minimalContext === true;

  let aiMessages: typeof baseMessages;
  if (minimalContext) {
    // Lightweight context: only fact sheet + events
    const eventsContext = await getUpcomingEventsContext(userId, 5);
    let facts: Array<{ category: string; fact: string }> = [];
    const factSheet = await getLatestFactSheet(userId);
    if (factSheet) {
      const entries: FactSheetEntry[] = JSON.parse(factSheet.facts_json);
      facts = entries.map(e => ({ category: e.category, fact: e.fact }));
    }

    aiMessages = injectContextMessages(baseMessages, {
      modelName: ai.getModelName(),
      facts,
      eventsContext,
    });
  } else {
    // Get context data
    const userMemory = await getUserMemory(userId);
    const eventsContext = await getUpcomingEventsContext(userId, 5);
    const docs = documentIds.length > 0
      ? await getConversationDocuments(userId, conversationId)
      : [];
    const allDocs = [...docs, ...(contentContexts || [])];

    // Load facts from fact sheet
    let facts: Array<{ category: string; fact: string }> = [];
    const factSheet = await getLatestFactSheet(userId);
    if (factSheet) {
      const entries: FactSheetEntry[] = JSON.parse(factSheet.facts_json);
      facts = entries.map(e => ({ category: e.category, fact: e.fact }));
    } else {
      console.warn(`[ChatWorker] No fact sheet found for user ${userId}`);
    }

    // Load recent conversations (since last fact sheet generation)
    const recentConversations = await getRecentConversationsWithUserMessages(
      userId,
      conversationId,
      factSheet?.created_at
    );

    // RAG: find semantically relevant facts for the current user message
    let ragFacts: Array<{ fact: string; category: string; distance: number; last_extracted_at: string | null }> = [];
    try {
      const lastUserMessage = baseMessages.filter(m => m.role === 'user').pop();
      if (lastUserMessage?.content && isEmbeddingsEnabled() && await isOllamaAvailable()) {
        const queryEmbedding = await embedQuery(lastUserMessage.content);
        ragFacts = await searchFactsByEmbedding(userId, queryEmbedding, 10);
      }
    } catch (e) {
      // RAG search failure should never break chat
    }

    // Inject context as message pairs
    aiMessages = injectContextMessages(baseMessages, {
      modelName: ai.getModelName(),
      userMemory,
      facts,
      ragFacts,
      eventsContext,
      documents: allDocs,
      includeTimezone: true,
      recentConversations,
    });
  }

  // In app chats, nudge the AI to keep README.md and DEV.md up to date.
  // Prepended to the last user message so it's always outside the cache boundary.
  if (appId && aiMessages.length > 0) {
    for (let i = aiMessages.length - 1; i >= 0; i--) {
      if (aiMessages[i].role === 'user') {
        const nudge = '[Reminder: After making changes, update README.md (user-facing docs) and DEV.md (dev instructions) if affected.]\n\n';
        if (typeof aiMessages[i].content === 'string') {
          aiMessages[i] = { ...aiMessages[i], content: nudge + aiMessages[i].content };
        }
        break;
      }
    }
  }

  // Track loop state for crash recovery (only for compaction-enabled models)
  const hasCompaction = !!resolvedModel.compactAt;
  if (hasCompaction) {
    await setConversationLoopState(conversationId, 'running', JSON.stringify(input));
  }

  // Stream the AI response
  let fullResponse = '';
  let allThoughts = '';
  let sources: Array<{ uri?: string; title?: string }> | undefined;
  let thoughtSignature: string | undefined;
  let thinkingStartTime: number | null = null;
  let thinkingDuration: number | undefined;
  let accumulatedToolCalls: any[] = [];
  let finishReason: string | undefined;
  const reasoningTagClassifier = createReasoningTagClassifier();

  const emitEventPersistedWithData = async (evt: { id: string; seq: number; kind: string; content: string; created_at: string }) => {
    let parsedContent: any;
    try { parsedContent = JSON.parse(evt.content); } catch { parsedContent = evt.content; }
    await ctx.emit('event_persisted', {
      seq: evt.seq,
      event_kind: evt.kind,
      event: { id: evt.id, seq: evt.seq, kind: evt.kind, content: parsedContent, feedback: null, created_at: evt.created_at },
    });
  };

  // Event buffering state for incremental persistence
  let thoughtBuffer = '';
  let textBuffer = '';
  let lastSegmentKind: 'thought' | 'text' | null = null;

  const flushThoughtSegment = async () => {
    if (!thoughtBuffer) return;
    const text = thoughtBuffer;
    thoughtBuffer = '';
    const evt = await addChatEvent(conversationId, 'thought', {
      text,
      signature: thoughtSignature,
    });
    await emitEventPersistedWithData(evt);
  };

  const flushTextSegment = async () => {
    if (!textBuffer) return;
    const text = textBuffer;
    textBuffer = '';
    const evt = await addChatEvent(conversationId, 'assistant_text', {
      text,
      model: ai.getModelName(),
    });
    await emitEventPersistedWithData(evt);
  };

  const flushEventBuffers = async () => {
    await flushThoughtSegment();
    await flushTextSegment();
  };

  const emitThoughtText = async (thoughtText: string) => {
    if (!thoughtText) return;
    if (thinkingStartTime === null) {
      thinkingStartTime = Date.now();
    }
    // Flush text segment at boundary: text -> thought
    if (lastSegmentKind === 'text') {
      await flushTextSegment();
    }
    lastSegmentKind = 'thought';
    allThoughts += thoughtText;
    thoughtBuffer += thoughtText;
    await ctx.emit('thought', { text: thoughtText });
  };

  const emitOutputText = async (outputText: string) => {
    if (!outputText) return;
    if (thinkingStartTime !== null && thinkingDuration === undefined) {
      thinkingDuration = Math.round((Date.now() - thinkingStartTime) / 1000);
    }
    // Flush thought segment at boundary: thought -> text
    if (lastSegmentKind === 'thought') {
      await flushThoughtSegment();
    }
    lastSegmentKind = 'text';
    fullResponse += outputText;
    textBuffer += outputText;
    await ctx.emit('output', { text: outputText });
  };

  // AbortController to stop the stream when stop is requested
  const abortController = new AbortController();

  // Emit init event
  await ctx.emit('output', {
    type: 'init',
    conversationId,
    model: ai.getModelName(),
  });

  // Emit initial status so UI shows something during early processing
  const modelDisplayName = ai.getModelName().split(' ')[0];
  const initialStatus = resumeContext?.resumeReason === 'timeout_decision'
    ? 'Tool wait timed out; deciding next step.'
    : `Talking to ${modelDisplayName}`;
  await ctx.emit('status', { status: initialStatus });

  try {
    const emitEventPersisted = async (evt: { id: string; seq: number; kind: string; content: string; created_at: string }) => {
      await emitEventPersistedWithData(evt);
    };

    await runWithParentJobContext(ctx, job.jobId, job.input, abortController.signal, async () => {
      await ai.generateStream(
        aiMessages,
        async (chunk) => {
          // Check stop request and abort the stream
          if (await ctx.stopRequested()) {
            console.log(`[ChatWorker] Stop requested for job ${job.jobId}, aborting stream`);
            abortController.abort();
            return;
          }

          if (chunk.status) {
            await ctx.emit('status', { status: chunk.status });
          }

          // Persist compaction events
          if (chunk.compaction) {
            await flushEventBuffers();
            const compactEvt = await addChatEvent(conversationId, 'compaction', {
              text: chunk.compaction.summary,
              tokensBefore: chunk.compaction.tokensBefore,
              model: 'Compaction (Auto-summarized)',
            });
            await emitEventPersistedWithData(compactEvt);
          }

          // Stream thoughts for live display and accumulate for saving
          if (chunk.thought && !chunk.done) {
            await emitThoughtText(chunk.thought);
          }

          if (chunk.text) {
            const classified = reasoningTagClassifier.consume(chunk.text);
            if (classified.thoughtText) {
              await emitThoughtText(classified.thoughtText);
            }
            if (classified.outputText) {
              await emitOutputText(classified.outputText);
            }
          }

          if (chunk.done) {
            // Extract sources if available
            if (chunk.sources && chunk.sources.length > 0) {
              sources = chunk.sources;
            }
            // Capture final accumulated thoughts and signature
            if (chunk.thought) {
              allThoughts = mergeContinuation(allThoughts, chunk.thought);
            }
            if (chunk.thoughtSignature) {
              thoughtSignature = chunk.thoughtSignature;
            }
            // Capture finish reason and tool calls for step limit handling
            finishReason = chunk.finishReason;
            if (chunk.toolCalls) {
              accumulatedToolCalls = chunk.toolCalls;
            }
          }
        },
        {
          thinking: Boolean(thinking),
          mode,
          location,
          userId,
          conversationId,
          parentJobId: job.jobId,
          signal: abortController.signal,
          ...(appId ? {
            excludeTools: ['discover_apps', 'app_info', 'run_app'],
            appContext: { appId, appSecrets: await getAppSecretsAsEnv(appId) },
          } : {
            excludeTools: [...CODING_TOOL_NAMES],
          }),
        }
      );
    }, flushEventBuffers, emitEventPersisted);

    // Flush any trailing partial tags/chunks after provider stream closes.
    const flushed = reasoningTagClassifier.flush();
    if (flushed.thoughtText) {
      await emitThoughtText(flushed.thoughtText);
    }
    if (flushed.outputText) {
      await emitOutputText(flushed.outputText);
    }

    // Flush remaining event buffers after stream completes
    await flushEventBuffers();

    // Persist sources event
    if (sources && sources.length > 0) {
      const srcEvt = await addChatEvent(conversationId, 'sources', { items: sources });
      await emitEventPersistedWithData(srcEvt);
    }
  } catch (error) {
    // If the error was caused by a stop request (e.g., abort during compaction), handle as stop
    if (await ctx.stopRequested()) {
      await flushEventBuffers();
      const stoppedEvt = await addChatEvent(conversationId, 'stopped', { model: ai.getModelName() });
      await emitEventPersistedWithData(stoppedEvt);

      const userMessageEvents = chatEvents.filter(e => e.kind === 'user_message');
      const isNewConversation = userMessageEvents.length <= 1;
      let title: string | undefined;
      let conversation: any | undefined;
      if (isNewConversation && message) {
        try {
          title = await generateTitle(message, fullResponse || undefined);
          await updateConversationTitle(userId, conversationId, title);
          conversation = await getConversation(userId, conversationId);
        } catch (e) {
          console.error('[ChatWorker] Failed to generate title on stop:', e);
        }
      }

      if (hasCompaction) await setConversationLoopState(conversationId, null, null);
      console.log(`[ChatWorker] Stopped (via error path): preserved partial progress for conversation ${conversationId}`);
      await ctx.emit('output', { final: true, stopped: true, title, conversation });
      await setConversationActiveJob(userId, conversationId, null);
      await ctx.complete(true);
      return;
    }

    console.error(`[ChatWorker] Stream error for job ${job.jobId}:`, error);
    let errorMessage = 'Failed to generate response';
    if (error instanceof Error) {
      console.error(`[ChatWorker] Error type=${error.name} message=${error.message}`);
      let msg = error.message;
      try {
        for (let i = 0; i < 3; i++) {
          const parsed = JSON.parse(msg);
          if (parsed?.error?.message) {
            msg = parsed.error.message;
          } else if (parsed?.message) {
            msg = parsed.message;
          } else {
            break;
          }
        }
      } catch {
        // msg is no longer JSON — it's the final human-readable string
      }
      if (msg && msg !== '[object Object]') {
        errorMessage = msg;
      }
    }
    if (hasCompaction) await setConversationLoopState(conversationId, null, null);
    await ctx.emit('output', {
      final: true,
      error: errorMessage,
    });
    await setConversationActiveJob(userId, conversationId, null);
    await ctx.complete(false);
    return;
  }

  // Check if stopped during streaming — preserve partial progress
  if (await ctx.stopRequested()) {
    // Flush any remaining buffers to persist partial content
    await flushEventBuffers();

    // Add a stopped event so the AI knows this turn was interrupted
    const stoppedEvt = await addChatEvent(conversationId, 'stopped', { model: ai.getModelName() });
    await emitEventPersistedWithData(stoppedEvt);

    // Generate title for new conversations so they don't stay "New Chat"
    const userMessageEvents = chatEvents.filter(e => e.kind === 'user_message');
    const isNewConversation = userMessageEvents.length <= 1;
    let title: string | undefined;
    let conversation: any | undefined;
    if (isNewConversation && message) {
      try {
        title = await generateTitle(message, fullResponse || undefined);
        await updateConversationTitle(userId, conversationId, title);
        conversation = await getConversation(userId, conversationId);
      } catch (e) {
        console.error('[ChatWorker] Failed to generate title on stop:', e);
      }
    }

    if (hasCompaction) await setConversationLoopState(conversationId, null, null);
    console.log(`[ChatWorker] Stopped: preserved partial progress for conversation ${conversationId}`);
    await ctx.emit('output', {
      final: true,
      stopped: true,
      title,
      conversation,
    });
    await setConversationActiveJob(userId, conversationId, null);
    await ctx.complete(true);
    return;
  }

  const yieldedToolCalls = await getYieldedToolCallLogsByParentJob(job.jobId);
  if (yieldedToolCalls.length > 0) {
    const yieldExtraction = extractYieldNote(fullResponse);

    if (!yieldExtraction.note) {
      // Protocol failure: model did not emit required <yeild> note
      // Cancel all background jobs to prevent orphaned processes
      const cancelledToolCalls: string[] = [];
      
      for (const toolCall of yieldedToolCalls) {
        if (toolCall.async_job_id) {
          try {
            // Stop the background job
            await stopJob(toolCall.async_job_id);
            
            // Update tool call log to failed status
            await updateToolCallLogResult(toolCall.id, {
              status: 'failed',
              response: {
                status: 'stopped',
                reason: 'Protocol failure: Assistant did not emit required <yeild> note',
              },
              error: 'Tool call cancelled due to protocol failure - no <yeild> note provided',
            });
            
            // Update conversation tool job state
            await updateConversationToolJobState(
              toolCall.async_job_id,
              'stopped',
              {
                status: 'stopped',
                reason: 'Protocol failure: Assistant did not emit required <yeild> note',
              },
              'Tool call cancelled due to protocol failure - no <yeild> note provided'
            );
            
            cancelledToolCalls.push(toolCall.tool_call_id);
          } catch (err) {
            console.error(`[ChatWorker] Failed to cancel yielded tool call ${toolCall.tool_call_id}:`, err);
          }
        }
      }

      const errorMessage = 
        `[ChatWorker] PROTOCOL FAILURE: Missing valid <yeild> note for yielded tool calls on job ${job.jobId}. ` +
        `Yielded calls: ${yieldedToolCalls.map(t => t.tool_call_id).join(', ')}. ` +
        `Cancelled ${cancelledToolCalls.length} background jobs: ${cancelledToolCalls.join(', ')}. ` +
        `Not creating resumable session.`;
      
      console.error(errorMessage);

      const toolJobs = await getConversationToolJobsByParentJob(job.jobId);

      // Emit final output with protocol failure info and cancelled job list
      await ctx.emit('output', {
        final: true,
        yielded: false,
        protocolError: true,
        errorMessage: 'Assistant failed to emit required <yeild> note. Background jobs were cancelled.',
        cancelledToolCalls,
        yieldNote: null,
        stripYieldTag: false,
        model: ai.getModelName(),
        toolJobs,
      });

      await setConversationActiveJob(userId, conversationId, null);
      await ctx.complete(true);
      return;
    }

    // Valid yield exit - create resumable session
    const session = await createChatYieldSession(
      conversationId,
      userId,
      job.jobId,
      'yield_exit',
      yieldExtraction.note,
      {
        nextCheckAt: new Date().toISOString(),
        partialOutput: yieldExtraction.stripped || null,
        partialThoughts: allThoughts || null,
        partialThinkingDuration: thinkingDuration ?? null,
      }
    );

    const toolJobs = await getConversationToolJobsByParentJob(job.jobId);

    // Generate title for new conversations before yield exit
    const yieldUserMsgEvents = chatEvents.filter(e => e.kind === 'user_message');
    const yieldIsNew = yieldUserMsgEvents.length <= 1;
    let yieldTitle: string | undefined;
    let yieldConversation: any | undefined;
    if (yieldIsNew) {
      try {
        let firstMsg = message;
        if (resumeContext && yieldUserMsgEvents.length > 0) {
          try {
            const content = typeof yieldUserMsgEvents[0].content === 'string'
              ? JSON.parse(yieldUserMsgEvents[0].content)
              : yieldUserMsgEvents[0].content;
            firstMsg = content.text || message;
          } catch {
            // keep firstMsg = message
          }
        }
        if (firstMsg) {
          yieldTitle = await generateTitle(firstMsg, yieldExtraction.stripped || undefined);
          await updateConversationTitle(userId, conversationId, yieldTitle);
          yieldConversation = await getConversation(userId, conversationId);
        }
      } catch (e) {
        console.error('[ChatWorker] Failed to generate title on yield:', e);
      }
    }

    await ctx.emit('output', {
      final: true,
      yielded: true,
      yieldNote: yieldExtraction.note,
      stripYieldTag: true,
      model: ai.getModelName(),
      thinkingDuration,
      toolJobs,
      title: yieldTitle,
      conversation: yieldConversation,
    });

    await setConversationActiveJob(userId, conversationId, null);
    await ctx.complete(true);
    return;
  }

  // Check if stopped due to step/tool-calls limit - generate observer summary
  // Note: allThoughts is optional - works even for models without thinking (e.g., Grok)
  if ((finishReason === 'length' || finishReason === 'tool-calls') && accumulatedToolCalls.length > 0) {
    if (hasCompaction) await setConversationLoopState(conversationId, null, null);
    console.log(`[ChatWorker] Step limit hit - generating observer summary...`);
    
    const summary = await generateObserverSummary(accumulatedToolCalls, allThoughts, fullResponse);

    // Write summary chat event
    const summaryEvt1 = await addChatEvent(conversationId, 'summary', { text: summary, model: 'Observer (Auto-summarized)' });
    await emitEventPersistedWithData(summaryEvt1);

    // Emit observer summary (partial output already streamed during chunk processing)
    await ctx.emit('output', { text: summary });
    await ctx.emit('output', {
      final: true,
      model: 'Observer',
      truncated: true,
    });

    await setConversationActiveJob(userId, conversationId, null);
    await ctx.complete(true);
    return;
  }

  // If stream completed but produced no content
  if (!fullResponse.trim()) {
    // If we have tool calls, generate a summary even without thoughts
    if (accumulatedToolCalls.length > 0) {
      console.log(`[ChatWorker] Empty response with tool calls - generating observer summary...`);
      
      const summary = await generateObserverSummary(accumulatedToolCalls, allThoughts, fullResponse);
      
      // Write summary chat event
      const summaryEvt2 = await addChatEvent(conversationId, 'summary', { text: summary, model: 'Observer (Auto-summarized)' });
      await emitEventPersistedWithData(summaryEvt2);

      // Emit the summary text so user sees it during streaming
      await ctx.emit('output', { text: summary });

      // Emit final so UI knows the message is complete
      await ctx.emit('output', {
        final: true,
        model: 'Observer',
        truncated: true,
      });

      await setConversationActiveJob(userId, conversationId, null);
      await ctx.complete(true);
      return;
    }

    console.warn(`[ChatWorker] Empty response for job ${job.jobId} — thoughts=${!!allThoughts}, thinkingDuration=${thinkingDuration ?? 'none'}`);
    await ctx.emit('output', {
      final: true,
      error: 'The model returned an empty response. It may be temporarily unavailable — please try again.',
    });
    await setConversationActiveJob(userId, conversationId, null);
    await ctx.complete(false);
    return;
  }

  const toolJobs = await getConversationToolJobsByParentJob(job.jobId);
  if (resumeContext?.originChatJobId) {
    const originToolJobs = await getConversationToolJobsByParentJob(resumeContext.originChatJobId);
    const mergedMap = new Map<string, any>();
    for (const toolJob of [...originToolJobs, ...toolJobs]) {
      mergedMap.set(toolJob.job_id, toolJob);
    }
    toolJobs.length = 0;
    toolJobs.push(...Array.from(mergedMap.values()));
  }

  // Check if this is a new conversation using chat events
  const userMessageEvents = chatEvents.filter(e => e.kind === 'user_message');
  const isNewConversation = userMessageEvents.length <= 1;
  let title: string | undefined;
  let conversation: any | undefined;

  if (isNewConversation && fullResponse) {
    try {
      // Get first user message text from events or fallback to message param
      let firstUserMessage = message;
      if (resumeContext && userMessageEvents.length > 0) {
        try {
          const content = typeof userMessageEvents[0].content === 'string'
            ? JSON.parse(userMessageEvents[0].content)
            : userMessageEvents[0].content;
          firstUserMessage = content.text || message;
        } catch {
          firstUserMessage = message;
        }
      }

      if (firstUserMessage) {
        title = await generateTitle(firstUserMessage, fullResponse);
        await updateConversationTitle(userId, conversationId, title);
        conversation = await getConversation(userId, conversationId);
      }
    } catch (e) {
      console.error('[ChatWorker] Failed to generate title:', e);
    }
  }

  if (hasCompaction) await setConversationLoopState(conversationId, null, null);

  // Emit final done event
  await ctx.emit('output', {
    final: true,
    sources,
    model: ai.getModelName(),
    thinkingDuration,
    title,
    conversation,
    toolJobs,
  });

  await setConversationActiveJob(userId, conversationId, null);
  await ctx.complete(true);
}

registerWorker({
  jobType: 'chat',
  pollIntervalMs: 100,
  maxConcurrency: 10,
  onJob: handleChatJob,
  onError: (error, job) => {
    console.error('[ChatWorker] Job failed:', error, job?.jobId);
  },
});
