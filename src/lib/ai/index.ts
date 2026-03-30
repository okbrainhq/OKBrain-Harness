/**
 * AI Module - Main Entry Point
 *
 * Provides a pluggable AI model system with provider/model registry.
 */

// Import providers to register them
import './providers';

import { registry } from './registry';
import { AIProvider } from './types';
import type { ModelsConfig } from './client-types';

// Re-export types
export * from './types';
export * from './context';
export { registry } from './registry';
export type { ResolvedModel, ModelCapabilities, ModelConfig, ProviderDefinition, UploadedFileResult } from './registry';
export type { ModelInfo, ModelsConfig } from './client-types';

// Re-export adapters for direct usage if needed
export { GeminiProvider } from './adapters/gemini-adapter';
export { XAIProvider } from './adapters/xai-adapter';
export { OpenRouterProvider } from './adapters/openrouter-adapter';

/**
 * Get the default model ID from the registry.
 */
export function getDefaultModelId(): string {
  const models = registry.getAllModels();
  return models[0]?.id ?? 'gemini';
}

/**
 * Get an AI provider by model ID.
 *
 * This is the main entry point for getting AI adapters.
 *
 * @param modelId - The model ID (e.g., 'gemini', 'gemini-pro', 'xai')
 * @param options - Optional configuration (e.g., { thinking: true })
 */
export function getAIProvider(
  modelId: string = getDefaultModelId(),
  options?: { thinking?: boolean }
): AIProvider {
  const model = registry.getModel(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}. Available models: ${registry.getModelIds().join(', ')}`);
  }
  return model.createAdapter(options);
}

/**
 * Get a resolved model definition by ID.
 *
 * Useful for getting model metadata like capabilities and UI config.
 */
export function getModel(modelId: string) {
  const model = registry.getModel(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  return model;
}

/**
 * Get capabilities for a model.
 */
export function getModelCapabilities(modelId: string) {
  return getModel(modelId).capabilities;
}

/**
 * Get all available models.
 */
export function getAllModels() {
  return registry.getAllModels();
}

/**
 * Get models grouped by provider (useful for UI dropdowns).
 */
export function getModelsGroupedByProvider() {
  return registry.getModelsGroupedByProvider();
}

/**
 * Check if a model ID is valid.
 */
export function isValidModelId(modelId: string): boolean {
  return registry.hasModel(modelId);
}

/**
 * Get all valid model IDs.
 */
export function getModelIds(): string[] {
  return registry.getModelIds();
}

/**
 * Get model configuration for client-side use.
 * Called from SSR to pass model info to client components.
 */
export function getModelsConfig(): ModelsConfig {
  const models = getAllModels().map(m => ({
    id: m.id,
    name: m.name,
    capabilities: {
      fileUpload: m.capabilities.fileUpload,
      thinking: m.capabilities.thinking,
      tools: m.capabilities.tools,
    },
  }));

  return {
    models,
    defaultModelId: models[0]?.id ?? 'gemini',
  };
}

/**
 * Upload a file using the provider associated with a model.
 */
export async function uploadFileForModel(
  modelId: string,
  filePath: string,
  mimeType: string,
  displayName?: string,
  options?: { userId?: string }
) {
  const model = getModel(modelId);
  if (!model.capabilities.fileUpload) {
    throw new Error(`Model ${modelId} does not support file uploads`);
  }

  const provider = registry.getProvider(model.providerId);
  if (!provider?.uploadFile) {
    throw new Error(`Provider ${model.providerId} has no uploadFile implementation`);
  }

  return provider.uploadFile(filePath, mimeType, displayName, options);
}

/**
 * Get model display name by ID.
 */
export function getModelName(modelId: string): string {
  try {
    return getModel(modelId).name;
  } catch {
    return modelId;
  }
}
