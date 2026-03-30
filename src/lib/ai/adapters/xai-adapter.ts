import { AIProvider, AIMessage, AIStreamChunk, AIGenerateOptions } from "../types";
import { ModelPricing } from '../registry/types';
import { allTools } from "../tools";
import { toOpenAIToolDefinitions } from "../tools/formatters";
import {
  buildResponseModeInstruction,
  buildTimeContext,
  buildCitationRuleReminder,
  buildPrefixReminder
} from "../system-prompts";
import { refreshAppNamesCache, appNamesCacheNeedsRefresh, refreshAppUsageCache, appUsageCacheNeedsRefresh } from '../apps-cache';
import { openaiStreamRound, runToolLoop, buildOpenAIAssistantMessage, buildOpenAIToolResultMessages } from '../sdk';
import { generateCompactionSummary } from '../compaction';

export function logXAIUsage(label: string, usage: any, modelName: string, pricing?: ModelPricing) {
  if (!pricing) return;
  const input = usage.prompt_tokens || 0;
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  const output = usage.completion_tokens || 0;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens || 0;

  // cached can exceed input (xAI reports full cache size, not just the overlap)
  const effectiveCached = Math.min(cached, input);
  const uncached = input - effectiveCached;

  const inputCost = (uncached * pricing.input + effectiveCached * pricing.cachedInput) / 1_000_000;
  const outputCost = (output * pricing.output) / 1_000_000;
  const reasoningCost = (reasoning * pricing.output) / 1_000_000;
  const totalCost = inputCost + outputCost + reasoningCost;

  console.log(`[${label} Cost] model=${modelName} prompt=${input} cached=${effectiveCached} output=${output} reasoning=${reasoning} cost=$${totalCost.toFixed(6)} (in=$${inputCost.toFixed(6)} out=$${outputCost.toFixed(6)} reason=$${reasoningCost.toFixed(6)})`);
}

export class XAIProvider implements AIProvider {
  name: string;
  private apiKey: string;
  private modelName: string;
  private pricing?: ModelPricing;
  private compactAt?: number;

  constructor(apiKey: string, modelName: string = "grok-4-1-fast-non-reasoning", displayName?: string, pricing?: ModelPricing, compactAt?: number) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.name = displayName || "Grok 4.1 Fast";
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

    // Build system prompt using centralized function
    let systemPrompt = buildResponseModeInstruction(
      options?.mode,
      this.name,
      {
        introText: "You are Grok, an AI assistant created by xAI.",
        userId: options?.userId,
      }
    );

    // Check if we have internet_search tool available and append citation rules
    const hasInternetSearch = allTools.some(t => t.definition.name === 'internet_search');
    if (hasInternetSearch) {
      systemPrompt += buildCitationRuleReminder();
    }

    // Time context for injection into last user message
    const timeContext = buildTimeContext(options?.location);
    const convertedMessages = this.convertMessages(messages, timeContext);

    const apiMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...convertedMessages,
    ];

    const excluded = options?.excludeTools;
    const filteredTools = excluded?.length
      ? allTools.filter(t => !excluded.includes(t.definition.name))
      : allTools;
    const tools = toOpenAIToolDefinitions(filteredTools);

    try {
      await runToolLoop({
        providerName: this.name,
        onChunk,
        messages: apiMessages,
        tools,
        compaction: this.compactAt ? {
          tokenLimit: this.compactAt,
          getInputTokens: (usage) => usage.prompt_tokens || 0,
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
        streamRound: (msgs, roundTools) => openaiStreamRound({
          url: 'https://api.x.ai/v1/chat/completions',
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          model: this.modelName,
          messages: msgs,
          tools: roundTools,
          providerName: this.name,
          signal: options?.signal,
        }, onChunk),
        buildAssistantMessage: buildOpenAIAssistantMessage,
        buildToolResultMessages: buildOpenAIToolResultMessages,
        logUsage: (usage) => logXAIUsage('XAI', usage, this.modelName, this.pricing),
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('XAI stream aborted by signal');
        return;
      }

      if (error.message?.toLowerCase().includes('at capacity') ||
          error.message?.toLowerCase().includes('rate limit')) {
        throw new Error("Grok is currently at capacity. Please try again in a few minutes.");
      }

      console.error('XAI API error details:', error);
      throw new Error(`XAI generation failed: ${error.message || 'Unknown error'}`);
    }
  }

  private convertMessages(messages: AIMessage[], timeContext?: string): any[] {
    return messages.map((msg, index) => {
      let content = msg.content;
      if (msg.role === "assistant" && msg.model) {
        content = `[${msg.model}]: ${content}`;
      }

      // Inject time context and prefix reminder into the last user message (keeps history cacheable)
      if (index === messages.length - 1 && msg.role === "user") {
        if (timeContext) {
          content = `${content}\n\n[Context: ${timeContext}]`;
        }
        content = `${content}${buildPrefixReminder(this.name)}`;
      }

      // Handle images - OpenAI format
      if (msg.image) {
        return {
          role: msg.role,
          content: [
            { type: "text", text: content },
            {
              type: "image_url",
              image_url: {
                url: `data:${msg.image.mimeType};base64,${msg.image.base64}`
              }
            }
          ]
        };
      }

      return {
        role: msg.role,
        content: content
      };
    });
  }
}
