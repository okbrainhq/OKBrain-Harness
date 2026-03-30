/**
 * OpenRouter Provider Definition
 *
 * Defines models available through the OpenRouter API.
 * Only registers if OPENROUTER_API_KEY is set.
 */

import { defineProvider } from "../registry";
import { OpenRouterProvider } from "../adapters/openrouter-adapter";
import { uploadFileLocal } from "../local-file-api";

if (process.env.OPENROUTER_API_KEY) {
    defineProvider({
        id: "openrouter",
        name: "OpenRouter",

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
                id: "gpt-5.4-mini",
                name: "GPT 5.4 Mini",
                apiModel: "openai/gpt-5.4-mini",
                uiPriority: 70,

                capabilities: {
                    thinking: true,
                },
                pricing: { input: 0.75, cachedInput: 0.075, output: 4.50 },
                compactAt: 300000,  // 75% of 400K context window
            },
            // Test-only model that always returns thinking tokens
            ...(process.env.TEST_MODE ? [{
                id: "or-minimax-m2.7",
                name: "MiniMax M2.7 (Think Test)",
                apiModel: "minimax/minimax-m2.7",
                uiPriority: 0,

                capabilities: {
                    thinking: true,
                },
                pricing: { input: 0.50, cachedInput: 0.05, output: 1.10 },
                compactAt: 200000,
            }] : []),
       ],

        uploadFile: uploadFileLocal,

        createAdapter: (modelDef) => {
            const apiKey = process.env.OPENROUTER_API_KEY!;
            return new OpenRouterProvider(
                apiKey,
                modelDef.apiModel,
                modelDef.name,
                modelDef.providerSort,
                modelDef.providerOrder,
                modelDef.pricing,
                modelDef.compactAt,
            );
        },
    });
}

//
