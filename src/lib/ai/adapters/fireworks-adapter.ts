import { AIProvider, AIMessage, AIStreamChunk, AIGenerateOptions } from "../types";
import { allTools } from "../tools";
import { toOpenAIToolDefinitions } from "../tools/formatters";
import { resolveLocalFileToBase64 } from "../local-file-api";
import {
  buildResponseModeInstruction,
  buildTimeContext,
  buildCitationRuleReminder,
  buildPrefixReminder,
  buildThinkingContextInstruction
} from "../system-prompts";
import { refreshAppNamesCache, appNamesCacheNeedsRefresh, refreshAppUsageCache, appUsageCacheNeedsRefresh } from '../apps-cache';
import { ModelPricing } from '../registry/types';
import { openaiStreamRound, runToolLoop, buildOpenAIAssistantMessage, buildOpenAIToolResultMessages } from '../sdk';
import { generateCompactionSummary } from '../compaction';

export function logFireworksUsage(label: string, usage: any, modelName: string, pricing?: ModelPricing) {
  if (!pricing) return;
  const input = usage.prompt_tokens || 0;
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  const output = usage.completion_tokens || 0;

  const effectiveCached = Math.min(cached, input);
  const uncached = input - effectiveCached;

  const inputCost = (uncached * pricing.input + effectiveCached * pricing.cachedInput) / 1_000_000;
  const outputCost = (output * pricing.output) / 1_000_000;
  const totalCost = inputCost + outputCost;

  const shortModel = modelName.replace('accounts/fireworks/models/', '');
  console.log(`[${label} Cost] model=${shortModel} prompt=${input} cached=${effectiveCached} output=${output} cost=$${totalCost.toFixed(6)} (in=$${inputCost.toFixed(6)} out=$${outputCost.toFixed(6)})`);
}

export class FireworksProvider implements AIProvider {
  name: string;
  private apiKey: string;
  private modelName: string;
  private pricing?: ModelPricing;
  private compactAt?: number;

  constructor(apiKey: string, modelName: string, displayName?: string, pricing?: ModelPricing, compactAt?: number) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.name = displayName || "Kimi K2.5";
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

    // Build system prompt (same pattern as OpenRouter)
    let systemPrompt = buildResponseModeInstruction(
      options?.mode,
      this.name,
      { introText: `You are ${this.name}, an AI assistant.`, userId: options?.userId }
    );
    systemPrompt += buildThinkingContextInstruction();

    const hasInternetSearch = allTools.some(t => t.definition.name === 'internet_search');
    if (hasInternetSearch) {
      systemPrompt += buildCitationRuleReminder();
    }

    const timeContext = buildTimeContext(options?.location);
    const convertedMessages = this.convertMessages(messages, timeContext, options?.mode);

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
          url: 'https://api.fireworks.ai/inference/v1/chat/completions',
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          model: this.modelName,
          messages: msgs,
          tools: roundTools,
          providerName: this.name,
          signal: options?.signal,
          maxTokens: 32768,
          temperature: 0.6,
        }, onChunk),
        buildAssistantMessage: buildOpenAIAssistantMessage,
        buildToolResultMessages: buildOpenAIToolResultMessages,
        logUsage: (usage) => logFireworksUsage('Fireworks', usage, this.modelName, this.pricing),
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Fireworks stream aborted by signal');
        return;
      }

      if (error.message?.toLowerCase().includes('overloaded') ||
          error.message?.toLowerCase().includes('rate limit')) {
        throw error;
      }

      console.error('Fireworks API error:', error);
      throw new Error(`Fireworks generation failed: ${error.message || 'Unknown error'}`);
    }
  }

  private convertMessages(messages: AIMessage[], timeContext?: string, mode?: string): any[] {
    return messages.map((msg, index) => {
      let content = msg.content;
      if (msg.role === 'assistant' && msg.model) {
        content = `[${msg.model}]: ${content}`;
      }

      // Inject time context and prefix reminder into the last user message
      if (index === messages.length - 1 && msg.role === 'user') {
        if (timeContext) {
          content = `${content}\n\n[Context: ${timeContext}]`;
        }
        content = `${content}${buildPrefixReminder(this.name)}`;
        if (mode === 'quick') {
          content = `${content}\n\n(Reminder: Follow the OUTPUT MODE in the system prompt strictly.)`;
        }
      }

      // Build multipart content for messages with images
      const imageParts: any[] = [];

      if (msg.image) {
        imageParts.push({
          type: 'image_url',
          image_url: { url: `data:${msg.image.mimeType};base64,${msg.image.base64}` },
        });
      }

      if (msg.files && Array.isArray(msg.files)) {
        for (const file of msg.files) {
          const localFile = resolveLocalFileToBase64(file.fileUri, file.mimeType);
          if (localFile) {
            imageParts.push({
              type: 'image_url',
              image_url: { url: `data:${localFile.mimeType};base64,${localFile.base64}` },
            });
          }
        }
      }

      if (imageParts.length > 0) {
        return {
          role: msg.role,
          content: [
            { type: 'text', text: content },
            ...imageParts,
          ],
        };
      }

      return { role: msg.role, content };
    });
  }
}
