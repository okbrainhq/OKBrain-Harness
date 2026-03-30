/**
 * Ollama Provider Definition
 *
 * Defines models available through a local Ollama instance.
 * Only registers if OLLAMA_URL is set.
 */

import { defineProvider } from '../registry';
import { OllamaProvider } from '../adapters/ollama-adapter';
import { uploadFileLocal } from '../local-file-api';

if (process.env.OLLAMA_URL) {
  defineProvider({
    id: 'ollama',
    name: 'Ollama',

    baseCapabilities: {
      fileUpload: true,
      fileApi: 'local',
      images: true,
      grounding: false,
      streaming: true,
      tools: false,
      toolsDuringThinking: false,
    },

    baseContext: {
      minimalContext: true,
    },

    models: [
      {
        id: 'qwen3.5-4b',
        name: 'Qwen 4B',
        apiModel: 'qwen3.5:4b',
        uiPriority: 25,

        capabilities: {
          thinking: true,
        },
      },
    ],

    createAdapter: (modelDef, options) => {
      const baseURL = process.env.OLLAMA_URL!;
      const thinking = options?.thinking !== false;
      return new OllamaProvider(baseURL, modelDef.apiModel, modelDef.name, thinking);
    },

    uploadFile: uploadFileLocal,
  });
}
