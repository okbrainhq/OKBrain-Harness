/**
 * ZAI (GLM Coding Plan) Provider Definition
 *
 * Defines models available through the Z.AI Coding Plan API (OpenAI-compatible).
 * Only registers if ZAI_API_KEY is set.
 */

import { defineProvider } from '../registry';
import { ZAIProvider } from '../adapters/zai-adapter';
import { uploadFileLocal } from '../local-file-api';

if (process.env.ZAI_API_KEY) {
  defineProvider({
    id: 'zai',
    name: 'ZAI',

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
        id: 'zai-glm-5-turbo',
        name: 'GLM-5 Turbo',
        apiModel: 'glm-5-turbo',
        uiPriority: 80,

        capabilities: {
          thinking: true,
        },

        compactAt: 150000,
      },
    ],

    createAdapter: (modelDef) => {
      const apiKey = process.env.ZAI_API_KEY!;
      return new ZAIProvider(apiKey, modelDef.apiModel, modelDef.name, modelDef.pricing, modelDef.compactAt);
    },

    uploadFile: uploadFileLocal,
  });
}
