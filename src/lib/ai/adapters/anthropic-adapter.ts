import { AIProvider, AIMessage, AIStreamChunk, AIGenerateOptions } from "../types";
import { allTools } from "../tools";
import { toAnthropicToolDefinitions } from "../tools/formatters";
import { resolveLocalFileToBase64 } from "../local-file-api";
import {
  buildResponseModeInstruction,
  buildTimeContext,
  buildCitationRuleReminder,
  buildPrefixReminder
} from "../system-prompts";
import { ModelPricing } from '../registry/types';
import { refreshAppNamesCache, appNamesCacheNeedsRefresh, refreshAppUsageCache, appUsageCacheNeedsRefresh } from '../apps-cache';
import { anthropicStreamRound, runToolLoop, buildAnthropicAssistantMessage, buildAnthropicToolResultMessages } from '../sdk';
import { generateCompactionSummary } from '../compaction';

export function logAnthropicUsage(label: string, usage: any, modelName: string, pricing?: ModelPricing) {
  if (!pricing) return;
  const input = usage.input_tokens || 0;
  const cached = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const output = usage.output_tokens || 0;

  const effectiveCached = Math.min(cached, input);
  const uncached = input - effectiveCached;

  const inputCost = (uncached * pricing.input + effectiveCached * pricing.cachedInput) / 1_000_000;
  const outputCost = (output * pricing.output) / 1_000_000;
  const totalCost = inputCost + outputCost;

  console.log(`[${label} Cost] model=${modelName} prompt=${input} cached=${effectiveCached} cacheWrite=${cacheCreation} output=${output} cost=$${totalCost.toFixed(6)} (in=$${inputCost.toFixed(6)} out=$${outputCost.toFixed(6)})`);
}

export class AnthropicProvider implements AIProvider {
  name: string;
  private apiKey: string;
  private modelName: string;
  private pricing?: ModelPricing;
  private compactAt?: number;

  constructor(apiKey: string, modelName: string = "claude-haiku-4-5-20251001", displayName?: string, pricing?: ModelPricing, compactAt?: number) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.name = displayName || "Claude Haiku 4.5";
    this.pricing = pricing;
    this.compactAt = compactAt;
  }

  getModelName(): string {
    return this.name;
  }

  async generateStream(
    messages: AIMessage[],
    onChunk: (chunk: AIStreamChunk) => void,
    options?: AIGenerateOptions
  ): Promise<void> {
    // Refresh apps cache if needed
    if (options?.userId && appNamesCacheNeedsRefresh(options.userId)) {
      await refreshAppNamesCache(options.userId);
    }
    if (options?.userId && appUsageCacheNeedsRefresh(options.userId)) {
      await refreshAppUsageCache(options.userId);
    }

    // Build system prompt
    let systemPrompt = buildResponseModeInstruction(
      options?.mode,
      this.name,
      {
        introText: "You are Claude, an AI assistant created by Anthropic.",
        userId: options?.userId,
      }
    );

    const hasInternetSearch = allTools.some(t => t.definition.name === 'internet_search');
    if (hasInternetSearch) {
      systemPrompt += buildCitationRuleReminder();
    }

    const timeContext = buildTimeContext(options?.location);
    const convertedMessages = this.convertMessages(messages, timeContext);

    // System with cache_control for prompt caching
    const system = [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ];

    // Add cache breakpoint on the last assistant message
    const apiMessages = [...convertedMessages];
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'assistant') {
        const msg = apiMessages[i];
        // Wrap string content in array format to attach cache_control
        if (typeof msg.content === 'string') {
          apiMessages[i] = {
            ...msg,
            content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
          };
        } else if (Array.isArray(msg.content)) {
          // Add cache_control to the last content block
          const content = [...msg.content];
          const last = content.length - 1;
          if (last >= 0) {
            content[last] = { ...content[last], cache_control: { type: 'ephemeral' } };
          }
          apiMessages[i] = { ...msg, content };
        }
        break;
      }
    }

    const excluded = options?.excludeTools;
    const filteredTools = excluded?.length
      ? allTools.filter(t => !excluded.includes(t.definition.name))
      : allTools;
    const tools = toAnthropicToolDefinitions(filteredTools);

    const thinking = options?.thinking
      ? { type: 'enabled' as const, budget_tokens: 10000 }
      : undefined;

    try {
      await runToolLoop({
        providerName: this.name,
        onChunk,
        messages: apiMessages,
        tools,
        compaction: this.compactAt ? {
          tokenLimit: this.compactAt,
          getInputTokens: (usage) => usage.input_tokens || 0,
          generateSummary: generateCompactionSummary,
          onCompaction: (summary, tokensBefore) =>
            onChunk({ text: '', compaction: { summary, tokensBefore }, done: false }),
        } : undefined,
        executeContext: {
          userId: options?.userId,
          conversationId: options?.conversationId,
          parentJobId: options?.parentJobId,
          appContext: options?.appContext,
        },
        streamRound: async (msgs, roundTools) => {
          const result = await anthropicStreamRound({
            apiKey: this.apiKey,
            model: this.modelName,
            system,
            messages: msgs,
            tools: roundTools,
            providerName: this.name,
            signal: options?.signal,
            maxTokens: 8192,
            thinking,
          }, onChunk);
          return {
            text: result.text,
            thoughts: result.thoughts,
            toolCalls: result.toolCalls,
            usage: result.usage,
            finishReason: result.stopReason === 'end_turn' ? 'stop' : result.stopReason,
            extra: { contentBlocks: result.contentBlocks },
          };
        },
        buildAssistantMessage: buildAnthropicAssistantMessage,
        buildToolResultMessages: buildAnthropicToolResultMessages,
        logUsage: (usage) => logAnthropicUsage('Anthropic', usage, this.modelName, this.pricing),
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Anthropic stream aborted by signal');
        return;
      }

      if (error.message?.toLowerCase().includes('overloaded')) {
        throw new Error("Claude is currently overloaded. Please try again in a few minutes.");
      }

      console.error('Anthropic API error details:', error);
      throw new Error(`Anthropic generation failed: ${error.message || 'Unknown error'}`);
    }
  }

  private convertMessages(messages: AIMessage[], timeContext?: string): any[] {
    return messages.map((msg, index) => {
      let content = msg.content;
      if (msg.role === "assistant" && msg.model) {
        content = `[${msg.model}]: ${content}`;
      }

      // Inject time context and prefix reminder into the last user message
      if (index === messages.length - 1 && msg.role === "user") {
        if (timeContext) {
          content = `${content}\n\n[Context: ${timeContext}]`;
        }
        content = `${content}${buildPrefixReminder(this.name)}`;
      }

      // Build content parts for images
      const imageParts: any[] = [];

      if (msg.image) {
        imageParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: msg.image.mimeType,
            data: msg.image.base64,
          },
        });
      }

      if (msg.files && Array.isArray(msg.files)) {
        for (const file of msg.files) {
          const localFile = resolveLocalFileToBase64(file.fileUri, file.mimeType);
          if (localFile) {
            imageParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: localFile.mimeType,
                data: localFile.base64,
              },
            });
          }
        }
      }

      if (imageParts.length > 0) {
        return {
          role: msg.role,
          content: [
            { type: "text", text: content },
            ...imageParts,
          ]
        };
      }

      return { role: msg.role, content };
    });
  }
}
