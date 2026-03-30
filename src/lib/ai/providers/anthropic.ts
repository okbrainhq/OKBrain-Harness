/**
 * Anthropic Provider Definition
 *
 * Defines Claude models available through the Anthropic API.
 * Only registers if ANTHROPIC_API_KEY is set.
 */

import { defineProvider } from '../registry';
import { AnthropicProvider } from '../adapters/anthropic-adapter';
import { uploadFileLocal } from '../local-file-api';

if (process.env.ANTHROPIC_API_KEY) {
  defineProvider({
    id: 'anthropic',
    name: 'Anthropic',

    baseCapabilities: {
      fileUpload: true,
      fileApi: 'local',
      images: true,
      grounding: false,
      streaming: true,
      tools: true,
      toolsDuringThinking: true,
    },

    models: [
      {
        id: 'claude-sonnet',
        name: 'Sonnet 4.6',
        apiModel: 'claude-sonnet-4-6',
        uiPriority: 90,

        capabilities: {
          thinking: true,
        },

        pricing: { input: 3.00, cachedInput: 0.30, output: 15.00 },
        compactAt: 750000,  // 75% of 1M context window
      },
      {
        id: 'claude-haiku',
        name: 'Haiku 4.5',
        apiModel: 'claude-haiku-4-5-20251001',
        uiPriority: 40,

        capabilities: {
          thinking: true,
        },

        pricing: { input: 0.80, cachedInput: 0.08, output: 4.00 },
        compactAt: 150000,  // 75% of 200K context window
      },
    ],

    createAdapter: (modelDef) => {
      const apiKey = process.env.ANTHROPIC_API_KEY!;
      return new AnthropicProvider(apiKey, modelDef.apiModel, modelDef.name, modelDef.pricing, modelDef.compactAt);
    },

    uploadFile: uploadFileLocal,
  });
}
