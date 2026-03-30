import { GoogleGenAI, Content, Part, Tool, GroundingChunk } from "@google/genai";
import { allTools, toGeminiTools, executeTool, getToolStatusMessage } from "../tools";
import { runWithToolContext } from "../tools/context";
import { AIProvider, AIMessage, AIStreamChunk, AIGenerateOptions } from "../types";
import { ModelPricing } from '../registry/types';
import { StreamSanitizer } from "../utils";
import {
  buildResponseModeInstruction,
  buildTimeContext,
  buildInternetSearchInstructions,
  buildPrefixReminder
} from "../system-prompts";
import { refreshAppNamesCache, appNamesCacheNeedsRefresh, refreshAppUsageCache, appUsageCacheNeedsRefresh } from '../apps-cache';

export function calculateGeminiCost(usage: any, pricing?: ModelPricing) {
  if (!pricing) return { inputCost: 0, outputCost: 0, thinkingCost: 0, totalCost: 0 };
  const promptTokens = usage.promptTokenCount || 0;
  const cachedTokens = usage.cachedContentTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  const thinkingTokens = usage.thoughtsTokenCount || 0;
  const uncachedInputTokens = promptTokens - cachedTokens;

  const inputCost = (uncachedInputTokens * pricing.input + cachedTokens * pricing.cachedInput) / 1_000_000;
  const outputCost = (outputTokens * pricing.output) / 1_000_000;
  const thinkingCost = (thinkingTokens * pricing.output) / 1_000_000;
  return { inputCost, outputCost, thinkingCost, totalCost: inputCost + outputCost + thinkingCost };
}

export function logGeminiUsage(label: string, usage: any, modelName: string, pricing?: ModelPricing) {
  const cost = calculateGeminiCost(usage, pricing);
  const cached = usage.cachedContentTokenCount || 0;
  const thinking = usage.thoughtsTokenCount || 0;
  console.log(`[${label} Cost] model=${modelName} prompt=${usage.promptTokenCount} cached=${cached} output=${usage.candidatesTokenCount} thinking=${thinking} cost=$${cost.totalCost.toFixed(6)} (in=$${cost.inputCost.toFixed(6)} out=$${cost.outputCost.toFixed(6)} think=$${cost.thinkingCost.toFixed(6)})`);
}

export class GeminiProvider implements AIProvider {
  name: string;
  private client: GoogleGenAI;
  private modelName: string;
  private apiKey: string;
  private pricing?: ModelPricing;

  constructor(apiKey: string, modelName: string = "gemini-3-flash-preview", displayName?: string, pricing?: ModelPricing) {
    this.client = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
    this.apiKey = apiKey;
    this.pricing = pricing;
    // Use provided display name or fall back to detection
    this.name = displayName || (modelName.includes('pro') ? "Gemini 3 Pro" : "Gemini 3 Flash");
  }

  getModelName(): string {
    return this.name;
  }

  async generateStream(
    messages: AIMessage[],
    onChunk: (chunk: AIStreamChunk) => void,
    options?: AIGenerateOptions
  ): Promise<void> {
    // Use custom tools, filtering out excluded ones
    const excluded = options?.excludeTools;
    const filteredTools = excluded?.length
      ? allTools.filter(t => !excluded.includes(t.definition.name))
      : allTools;
    const activeTools: Tool[] = toGeminiTools(filteredTools);

    return this.generateStreamInternal(messages, onChunk, options, activeTools);
  }

  private async generateStreamInternal(
    messages: AIMessage[],
    onChunk: (chunk: AIStreamChunk) => void,
    options: AIGenerateOptions | undefined,
    tools: Tool[]
  ): Promise<void> {
    try {
      // Refresh apps cache if needed
      if (options?.userId && appNamesCacheNeedsRefresh(options.userId)) {
        await refreshAppNamesCache(options.userId);
      }
      if (options?.userId && appUsageCacheNeedsRefresh(options.userId)) {
        await refreshAppUsageCache(options.userId);
      }

      // Build system instruction using centralized functions
      let systemInstruction = buildResponseModeInstruction(
        options?.mode,
        this.name,
        {
          introText: "You are a helpful assistant.",
          userId: options?.userId,
        }
      );

      // Add instructions for custom internet_search tool if available
      const hasInternetSearch = tools.some(t => {
        // Check Gemini function declarations (format: { functionDeclarations: [...] })
        if ('functionDeclarations' in t) {
          return (t as any).functionDeclarations?.some((fd: any) => fd.name === 'internet_search') ?? false;
        }
        return false;
      });

      if (hasInternetSearch) {
        systemInstruction += buildInternetSearchInstructions();
      }

      // Time context moved to conversation pair for cacheability (see below)

      // Convert messages to Gemini format
      // Note: We need to handle previous function calls/responses if we are in a recursive loop
      // But here we rely on the `messages` argument being accumulated if needed,
      // OR we just append the current turn's tool interactions to the contents.

      // Time context will be injected into the last user message to keep history prefix cacheable
      const timeContext = buildTimeContext(options?.location);
      const isLastMessage = (index: number) => index === messages.length - 1;

      const contents: Content[] = messages.map((msg, index) => {
        const parts: Part[] = [];

        // Add files first if present (from FILE API)
        if (msg.files && Array.isArray(msg.files)) {
          msg.files.forEach((file) => {
            parts.push({
              fileData: {
                mimeType: file.mimeType,
                fileUri: file.fileUri,
              },
            });
          });
        }

        // Add image if present (legacy base64 support)
        if (msg.image) {
          parts.push({
            inlineData: {
              mimeType: msg.image.mimeType,
              data: msg.image.base64,
            },
          });
        }

        // Build the text content
        let textContent = msg.content;

        // Add model prefix for assistant messages in history
        if (msg.role === "assistant" && msg.model) {
          textContent = `[${msg.model}]: ${textContent}`;
        }

        // Inject time context into the last user message (keeps history prefix cacheable)
        if (msg.role === "user" && isLastMessage(index)) {
          textContent = `${textContent}\n\n[Context: ${timeContext}]`;
        }

        // For assistant messages with thoughtSignature
        if (msg.role === "assistant" && msg.thoughtSignature) {
          parts.push({
            text: textContent,
            thoughtSignature: msg.thoughtSignature,
          } as any);
        } else {
          // If message content is empty but it has files/images, we might still add empty text or skip?
          // Gemini usually requires some content or parts.
          if (textContent || parts.length === 0) {
            parts.push({ text: textContent });
          }
        }

        return {
          role: msg.role === "user" ? "user" : "model",
          parts,
        };
      });

      // Handle the case where we are re-entering with tool responses
      // If the last message is a TOOL response, it should be part of the conversation.
      // However, the `messages` array from the generic `AIProvider` interface usually just has user/assistant structure.
      // So we must handle the tool execution flow within this function's scope (recursion)
      // by appending to `contents` directly for subsequent calls.

      // IMPORTANT: The `messages` argument is what the UI/Client sent.
      // In a tool use scenario:
      // 1. User sends message.
      // 2. Model responds with FunctionCall.
      // 3. We execute function.
      // 4. We send back [UserMessage, AssistantMessage(FunctionCall), FunctionResponse].
      // 5. Model responds with final answer.

      // Since `generateStream` is stateless regarding the previous turns of *this specific generation*,
      // we need to manage the intermediate parts if we loop.

      return this.generateStreamLoop(contents, systemInstruction, tools, onChunk, options, this.client);

    } catch (error: any) {
      // ... (error handling)
      console.error("Gemini API error:", error);
      // Try fallback models if current one fails
      const fallbackModels = ["gemini-3-flash-preview", "gemini-3-flash", "gemini-2.0-flash-exp", "gemini-1.5-flash-latest", "gemini-1.5-flash"];
      if ((error.status === 404 || error.status === 400) && fallbackModels.length > 0) {
        let fallback = fallbackModels.shift();
        // Skip current model in fallback
        if (fallback === this.modelName) {
          fallback = fallbackModels.shift();
        }
        if (fallback) {
          console.log(`Model ${this.modelName} failed, trying ${fallback}`);
          this.modelName = fallback;
          // We need slightly complex retry logic here to support the loop,
          // but for now simpler recursion is okay since we haven't started tool loop yet in a fallback scenario usually.
          return this.generateStream(messages, onChunk, options);
        }
      }
      throw error;
    }
  }

  /**
   * Gemini uses its own recursive tool loop (not runToolLoop from the SDK).
   * This means it does NOT support infinite looping or context compaction.
   * It has a fixed depth limit (MAX_TOOL_DEPTH) and falls back to the
   * observer summary in chat-worker.ts when the limit is hit.
   * TODO: Migrate to runToolLoop with compaction support.
   */
  private async generateStreamLoop(
    contents: Content[],
    systemInstruction: string,
    tools: Tool[],
    onChunk: (chunk: AIStreamChunk) => void,
    options: AIGenerateOptions | undefined,
    client: GoogleGenAI,
    recursionDepth = 0,
    accumulatedToolCalls: Array<{ id: string; name: string; arguments: Record<string, any>; result: any }> = []
  ): Promise<void> {
    const MAX_TOOL_DEPTH = 50;

    console.log(`[GeminiAdapter] Tool loop depth=${recursionDepth}, model=${this.modelName}`);

    if (recursionDepth > MAX_TOOL_DEPTH) {
      // Safety net — should not normally be reached since we handle MAX_TOOL_DEPTH below
      console.error(`[GeminiAdapter] Unexpected recursion depth ${recursionDepth} exceeded MAX_TOOL_DEPTH ${MAX_TOOL_DEPTH}`);
      await onChunk({
        text: "",
        done: true,
        finishReason: 'tool-calls',
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
      });
      return;
    }

    // Modify the last message with any additional instructions (only if it's the first pass or we want to persist it)
    // This part from original code injects specific prompts into the last message.
    // We should be careful not to dupe this if we recurse, but `contents` is fresh or appended to.

    // For the first pass, we might want to check if the last item is user text to attach specific instructions.
    // But if we are in recursion loop, the last item might be a FunctionResponse.

    const lastContent = contents[contents.length - 1];
    const isUserMessage = lastContent.role === 'user';

    // Only inject the heavy grounding/formatting instructions on the *User's* message part
    // and only if we haven't done it yet (though `contents` is recreated or appended).
    // Actually, standard Gemini practice is system instructions + tools.
    // The original code appended instructions to the USER message text.
    // We'll keep that logic but only for the user message.

    if (isUserMessage && recursionDepth === 0) {
      const lastPart = lastContent.parts?.[lastContent.parts.length - 1];
      // ... (existing logic to append STRICT REMINDER)
      if (lastPart && 'text' in lastPart && typeof lastPart.text === 'string') {
        const strengthenedContent = `${lastPart.text}${buildPrefixReminder(this.name)}`;

        // We clone valid parts to avoid mutating the original `messages` array implicitly if it was passed by ref
        // content parts are usually new objects here.
        lastPart.text = strengthenedContent;
      }
    }

    const isThinkingModel = this.modelName.includes('thinking');
    const isGemini3 = this.modelName.includes('gemini-3');
    const isFinalDepth = recursionDepth === MAX_TOOL_DEPTH;

    // On the final allowed depth, force a text response by removing tools and instructing the model to wrap up
    let effectiveSystemInstruction = systemInstruction;
    if (isFinalDepth) {
      console.warn(`[GeminiAdapter] Final tool call depth (${MAX_TOOL_DEPTH}) reached — disabling tools to force text response`);
      effectiveSystemInstruction += "\n\nIMPORTANT: You have used the maximum allowed number of tool calls. Provide your best answer using the information already gathered. If you couldn't find something specific, tell the user clearly what you were and weren't able to find.";
    }

    // Thinking models do NOT support tools yet (experimental ones)
    // But Flash 3 likely supports tools.
    const config: any = {
      systemInstruction: effectiveSystemInstruction,
      maxOutputTokens: 8192,
    };

    if (isThinkingModel || isGemini3) {
      const isFlashModel = this.modelName.includes('flash');
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: options?.thinking ? 'HIGH' : (isFlashModel ? 'MINIMAL' : 'LOW')
      };
    }

    // Explicitly keeping tools undefined for experimental thinking models that don't support them
    // Also strip tools on the final depth to force a text response
    if (isThinkingModel || isFinalDepth) {
      // Do nothing, tools remain undefined
    } else {
      if (tools.length > 0) {
        config.tools = tools;
      }
    }

    const streamResult = await client.models.generateContentStream({
      model: this.modelName,
      contents,
      config,
    });

    let allSources: Array<{ uri?: string; title?: string }> = [];
    const sanitizer = new StreamSanitizer(this.name);
    let allThoughts = "";
    let finalThoughtSignature: string | undefined;

    let functionCallPart: Part | null = null;
    let textResponseAccumulated = "";

    let lastUsageMetadata: any = null;

    // Wrap the async iterator with a timeout to handle Gemini silently hanging
    const STREAM_TIMEOUT_MS = 60_000;
    const iterator = streamResult[Symbol.asyncIterator]();

    const nextWithTimeout = async () => {
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Stream timed out waiting for response from the model. Please try again.')), STREAM_TIMEOUT_MS);
      });
      try {
        return await Promise.race([iterator.next(), timeout]);
      } finally {
        clearTimeout(timer!);
      }
    };

    let iterResult = await nextWithTimeout();
    while (!iterResult.done) {
      const chunk = iterResult.value;
      if (options?.signal?.aborted) {
        console.log(`[GeminiAdapter] Stream aborted by user stop signal at depth=${recursionDepth}`);
        return;
      }

      // Capture usage metadata from every chunk (final chunk has the most complete info)
      if (chunk.usageMetadata) {
        lastUsageMetadata = chunk.usageMetadata;
      }

      // Check for function calls
      if (chunk.candidates && chunk.candidates[0].content?.parts) {
        for (const part of chunk.candidates[0].content.parts) {
          if ('functionCall' in part) {
            functionCallPart = part;
            // We typically break here or continue to consume other parts?
            // Usually function call is the main thing.
            // We assume one function call per turn for simplicity or handle the first one.
          }
        }
      }

      // ... (existing thought extraction logic)
      if (chunk.candidates && chunk.candidates[0]) {
        const parts = chunk.candidates[0].content?.parts;
        if (parts && Array.isArray(parts)) {
          for (const part of parts) {
            // Check if this is a thought part
            if ((part as any).thought && (part as any).text) {
              const thoughtText = (part as any).text;
              allThoughts += thoughtText;
              await onChunk({ text: "", thought: thoughtText, done: false });
            }
            if ((part as any).thoughtSignature) {
              finalThoughtSignature = (part as any).thoughtSignature;
            }
          }
        }
      }

      // Check if this chunk has a function call to avoid SDK warning about non-text parts
      const hasFunctionCall = chunk.candidates?.[0]?.content?.parts?.some(
        (part) => 'functionCall' in part
      );
      const text = hasFunctionCall ? '' : chunk.text;

      if (text) {
        textResponseAccumulated += text;
        const sanitizedText = sanitizer.process(text);
        if (sanitizedText) {
          await onChunk({ text: sanitizedText, done: false });
        }
      }

      // Extract sources (existing)
      if (chunk.candidates && chunk.candidates[0]) {
        const candidate = chunk.candidates[0];
        if (candidate.groundingMetadata) {
          const groundingMeta = candidate.groundingMetadata;
          const groundingChunks = groundingMeta.groundingChunks;
          if (groundingChunks && Array.isArray(groundingChunks)) {
            groundingChunks.forEach((grChunk: GroundingChunk) => {
              if (grChunk.web) {
                const source = {
                  uri: grChunk.web.uri,
                  title: grChunk.web.title,
                };
                if (!allSources.some(s => s.uri === source.uri)) {
                  allSources.push(source);
                }
              }
            });
          }
        }
      }

      iterResult = await nextWithTimeout();
    } // end stream loop

    // Log the final usage metadata (last chunk has the most complete info including cache stats)
    if (lastUsageMetadata) {
      logGeminiUsage('Gemini', lastUsageMetadata, this.modelName, this.pricing);
    }

    // If we found a function call
    if (functionCallPart && functionCallPart.functionCall) {
      const call = functionCallPart.functionCall;
      const toolName = call.name || 'unknown';

      // Skip Google Search grounding calls - they're handled automatically by Google's servers
      // We only need to execute custom function calls that we defined
      if (toolName === 'google_search' || toolName === 'googleSearch') {
        // Google Search grounding is handled server-side, don't try to execute it
        // Just continue with the response (the grounding metadata will be in the chunks)
        const remainingText = sanitizer.flush();
        if (remainingText) {
          await onChunk({ text: remainingText, done: false });
        }

        await onChunk({
          text: "",
          done: true,
          sources: allSources.length > 0 ? allSources : undefined,
          thought: allThoughts || undefined,
          thoughtSignature: finalThoughtSignature,
          finishReason: accumulatedToolCalls.length > 0 && recursionDepth >= MAX_TOOL_DEPTH ? 'tool-calls' : undefined,
          toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        });
        return;
      }

      console.log(`[GeminiAdapter] Tool call detected: ${toolName} at depth=${recursionDepth}`);
      const statusMessage = getToolStatusMessage(toolName);
      await onChunk({ text: "", done: false, status: statusMessage });

      // Execute tool with user context
      const result = await runWithToolContext(
        {
          userId: options?.userId,
          conversationId: options?.conversationId,
          parentJobId: options?.parentJobId,
          appContext: options?.appContext,
        },
        () => executeTool(toolName, call.args)
      );

      // Reset status after tool execution
      await onChunk({ text: '', status: `Talking to ${this.name.split(' ')[0]}`, done: false });

      // Accumulate tool call for step limit handling
      accumulatedToolCalls.push({
        id: call.id || `call-${recursionDepth}`,
        name: toolName,
        arguments: call.args || {},
        result,
      });

      // Note: Citation instructions for internet_search are in the system prompt
      // via buildInternetSearchInstructions() - no need to inject into tool response

      // Construct the conversation history to continue
      // 1. Model's FunctionCall
      // Note: thoughtSignature is REQUIRED for thinking models - without it the API returns 400
      if (finalThoughtSignature && !(functionCallPart as any).thoughtSignature) {
        (functionCallPart as any).thoughtSignature = finalThoughtSignature;
      }

      contents.push({
        role: "model",
        parts: [functionCallPart]
      });

      // 2. FunctionResponse - include thoughtSignature if present (required for thinking models)
      const functionResponsePart: any = {
        functionResponse: {
          name: call.name,
          response: {
            name: call.name,
            content: result
          }
        }
      };

      // If the function call has a thought signature, include it in the response
      if ((functionCallPart as any).thoughtSignature) {
        functionResponsePart.thoughtSignature = (functionCallPart as any).thoughtSignature;
      }

      contents.push({
        role: "function",
        parts: [functionResponsePart]
      });

      // Recurse to generate final answer
      return this.generateStreamLoop(contents, systemInstruction, tools, onChunk, options, client, recursionDepth + 1, accumulatedToolCalls);
    }

    // If no function call, we are done
    // Flush sanitizer
    const remainingText = sanitizer.flush();
    if (remainingText) {
      await onChunk({ text: remainingText, done: false });
    }

    await onChunk({
      text: "",
      done: true,
      sources: allSources.length > 0 ? allSources : undefined,
      thought: allThoughts || undefined,
      thoughtSignature: finalThoughtSignature,
      finishReason: accumulatedToolCalls.length > 0 && recursionDepth >= MAX_TOOL_DEPTH ? 'tool-calls' : undefined,
      toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
    });

  }

}
