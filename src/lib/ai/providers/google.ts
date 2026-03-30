/**
 * Google Provider Definition
 *
 * Defines Gemini models available through the Google AI API.
 */

import { defineProvider } from '../registry';
import { GeminiProvider } from '../adapters/gemini-adapter';
import { uploadFile as uploadToGemini } from '../file-api';

const getApiKey = (): string => {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_API_KEY is not set. Please add it to your .env.local file."
    );
  }
  return apiKey;
};

export default defineProvider({
  id: 'google',
  name: 'Google',

  baseCapabilities: {
    fileUpload: true,
    fileApi: 'google',
    images: true,
    grounding: true,
    streaming: true,
    thinking: true,
    tools: true,
    toolsDuringThinking: false,
  },

  models: [
    {
      // Keep 'gemini' as the ID for backward compatibility
      id: 'gemini',
      name: 'Gemini 3 Flash',
      apiModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
      fallbackModels: ['gemini-3-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-flash-latest', 'gemini-1.5-flash'],
      uiPriority: 110,

      capabilities: {
        // All capabilities inherited from baseCapabilities
      },

      pricing: { input: 0.50, cachedInput: 0.05, output: 3.00 },
    },
    // {
    //   id: 'gemini-flash-lite',
    //   name: 'Gemini 3.1 Lite',
    //   apiModel: 'gemini-3.1-flash-lite-preview',
    //   uiPriority: 90,
    //
    //   capabilities: {
    //     // All capabilities inherited from baseCapabilities
    //   },
    //
    //   pricing: { input: 0.25, cachedInput: 0.025, output: 1.50 },
    // },
    {
      // Keep 'gemini-pro' as the ID for backward compatibility
      id: 'gemini-pro',
      name: 'Gemini 3.1 Pro',
      apiModel: 'gemini-3.1-pro-preview',
      uiPriority: 50,

      capabilities: {
        // All capabilities inherited from baseCapabilities
      },

      pricing: { input: 2.00, cachedInput: 0.20, output: 12.00 },
    },
  ],

  createAdapter: (modelDef, options) => {
    const apiKey = getApiKey();
    return new GeminiProvider(apiKey, modelDef.apiModel, modelDef.name, modelDef.pricing);
  },

  uploadFile: async (filePath, mimeType, displayName) => {
    const result = await uploadToGemini(filePath, mimeType, displayName);
    return {
      uri: result.uri,
      name: result.name,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      expirationTime: result.expirationTime,
    };
  },
});
