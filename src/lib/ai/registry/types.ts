/**
 * Registry Types for Pluggable AI Model System
 *
 * This module defines the types for the provider/model registry architecture.
 */

import { AIProvider, AIMessage, AIStreamChunk, AIGenerateOptions } from '../types';

// Context behavior configuration
export interface ModelContextConfig {
  includeThoughtsInHistory?: boolean;
  minimalContext?: boolean; // Skip heavy context injection (memory, facts, events, etc.)
}

// Model capabilities
export interface ModelCapabilities {
  thinking: boolean;
  tools: boolean;
  toolsDuringThinking: boolean;
  fileUpload: boolean;
  fileApi: 'google' | 'openai' | 'xai' | 'local' | null;
  images: boolean;
  grounding: boolean;
  streaming: boolean;
}

// Pricing per 1M tokens (USD)
export interface ModelPricing {
  input: number;
  cachedInput: number;
  output: number;
}

// Adapter creation options
export interface AdapterOptions {
  thinking?: boolean;
}

// Model configuration within a provider
export interface ModelConfig {
  id: string;
  name: string;
  apiModel: string;
  fallbackModels?: string[];
  uiPriority?: number; // Higher number = appears first in UI (like z-index). Default: 0
  providerSort?: 'price' | 'throughput' | 'latency'; // Provider sorting strategy (OpenRouter)
  providerOrder?: string[]; // Lock to specific providers (OpenRouter provider.order)
  capabilities: Partial<ModelCapabilities>;
  context?: Partial<ModelContextConfig>;
  pricing?: ModelPricing;
  compactAt?: number;  // Input token count that triggers context compaction
}

// Standardized result for file uploads across all providers
export interface UploadedFileResult {
  uri: string;           // Provider-specific file reference
  name: string;          // Provider's internal name/ID
  mimeType: string;
  sizeBytes: number;
  expirationTime?: string;  // Optional - not all providers expire files
}

// Provider definition - what you write to define a provider
export interface ProviderDefinition {
  id: string;
  name: string;
  baseCapabilities: Partial<ModelCapabilities>;
  baseContext?: Partial<ModelContextConfig>;
  models: ModelConfig[];
  createAdapter: (model: ModelConfig, options?: AdapterOptions) => AIProvider;
  uploadFile?: (filePath: string, mimeType: string, displayName?: string, options?: { userId?: string }) => Promise<UploadedFileResult>;
}

// Resolved model - fully merged model with all capabilities and UI filled in
export interface ResolvedModel {
  id: string;
  name: string;
  providerId: string;
  apiModel: string;
  fallbackModels?: string[];
  uiPriority: number;
  capabilities: ModelCapabilities;
  context: ModelContextConfig;
  pricing?: ModelPricing;
  compactAt?: number;
  createAdapter: (options?: AdapterOptions) => AIProvider;
}

// Default capabilities (used when not specified)
export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  thinking: false,
  tools: false,
  toolsDuringThinking: false,
  fileUpload: false,
  fileApi: null,
  images: false,
  grounding: false,
  streaming: true,
};

// Default context config (used when not specified)
export const DEFAULT_CONTEXT_CONFIG: ModelContextConfig = {
  includeThoughtsInHistory: false,
};

