/**
 * Fireworks AI Provider Definition
 *
 * Defines models available through the Fireworks API (OpenAI-compatible).
 * Only registers if FIREWORKS_API_KEY is set.
 */

import { defineProvider } from '../registry';
import { FireworksProvider } from '../adapters/fireworks-adapter';
import { uploadFileLocal } from '../local-file-api';

if (process.env.FIREWORKS_API_KEY) {
  defineProvider({
    id: 'fireworks',
    name: 'Fireworks',

    baseCapabilities: {
      fileUpload: true,
      fileApi: 'local',
      images: true,
      grounding: false,
      streaming: true,
      tools: true,
      toolsDuringThinking: true,
    },

    baseContext: {
      includeThoughtsInHistory: true,
    },

    models: [
      {
        id: 'fw-kimi-k2.5',
        name: 'Kimi K2.5',
        apiModel: 'accounts/fireworks/routers/kimi-k2p5-turbo',
        uiPriority: 95,

        capabilities: {
          thinking: true,
        },

        pricing: { input: 0.20, cachedInput: 0.10, output: 0.80 },
        compactAt: 200000,  // 75% of 256K context window
      },
      {
        id: 'fw-glm-5',
        name: 'GLM 5',
        apiModel: 'accounts/fireworks/models/glm-5',
        uiPriority: 90,

        capabilities: {
          thinking: false,
          images: false,
          toolsDuringThinking: false,
        },

        pricing: { input: 1.00, cachedInput: 0.20, output: 3.20 },
        compactAt: 150000,  // 75% of ~200K context window
      },
      // Test-only model with very low compaction threshold for E2E testing
      ...(process.env.TEST_MODE ? [{
        id: 'fw-kimi-k2.5-compact-test',
        name: 'Kimi K2.5 (Compact Test)',
        apiModel: 'accounts/fireworks/routers/kimi-k2p5-turbo',
        uiPriority: 0,

        capabilities: {
          thinking: true,
        },

        pricing: { input: 0.20, cachedInput: 0.10, output: 0.80 },
        compactAt: 1000,  // Very low threshold to trigger compaction quickly
      }] : []),
    ],

    createAdapter: (modelDef) => {
      const apiKey = process.env.FIREWORKS_API_KEY!;
      return new FireworksProvider(apiKey, modelDef.apiModel, modelDef.name, modelDef.pricing, modelDef.compactAt);
    },

    uploadFile: uploadFileLocal,
  });
}
