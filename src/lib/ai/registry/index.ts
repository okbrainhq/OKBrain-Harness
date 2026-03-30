/**
 * AI Model Registry
 *
 * Central registry for all AI providers and models.
 * Providers register themselves, and the registry resolves models with merged capabilities.
 */

import {
  ProviderDefinition,
  ResolvedModel,
  ModelConfig,
  ModelCapabilities,
  ModelContextConfig,
  DEFAULT_CAPABILITIES,
  DEFAULT_CONTEXT_CONFIG,
  AdapterOptions,
} from './types';

class Registry {
  private providers = new Map<string, ProviderDefinition>();
  private models = new Map<string, ResolvedModel>();

  /**
   * Register a provider and all its models
   */
  registerProvider(provider: ProviderDefinition): void {
    this.providers.set(provider.id, provider);

    // Resolve and register each model
    for (const modelConfig of provider.models) {
      const resolved = this.resolveModel(provider, modelConfig);
      this.models.set(resolved.id, resolved);
    }
  }

  /**
   * Resolve a model by merging provider defaults with model-specific config
   */
  private resolveModel(provider: ProviderDefinition, config: ModelConfig): ResolvedModel {
    // Merge capabilities: defaults -> provider base -> model specific
    const capabilities: ModelCapabilities = {
      ...DEFAULT_CAPABILITIES,
      ...provider.baseCapabilities,
      ...config.capabilities,
    };

    // Merge context: defaults -> provider base -> model specific
    const context: ModelContextConfig = {
      ...DEFAULT_CONTEXT_CONFIG,
      ...provider.baseContext,
      ...config.context,
    };

    return {
      id: config.id,
      name: config.name,
      providerId: provider.id,
      apiModel: config.apiModel,
      fallbackModels: config.fallbackModels,
      uiPriority: config.uiPriority ?? 0,
      capabilities,
      context,
      pricing: config.pricing,
      compactAt: config.compactAt,
      createAdapter: (options?: AdapterOptions) => provider.createAdapter(config, options),
    };
  }

  /**
   * Get a specific model by ID
   */
  getModel(id: string): ResolvedModel | undefined {
    return this.models.get(id);
  }

  /**
   * Get all registered models
   */
  getAllModels(): ResolvedModel[] {
    return Array.from(this.models.values()).sort((a, b) => b.uiPriority - a.uiPriority);
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get a provider definition by ID
   */
  getProvider(id: string): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  /**
   * Get models by provider ID
   */
  getModelsByProvider(providerId: string): ResolvedModel[] {
    return this.getAllModels().filter(m => m.providerId === providerId);
  }

  /**
   * Get models by capability
   */
  getModelsByCapability(cap: keyof ModelCapabilities): ResolvedModel[] {
    return this.getAllModels().filter(m => m.capabilities[cap]);
  }

  /**
   * Get models grouped by provider (useful for UI dropdowns)
   */
  getModelsGroupedByProvider(): Map<string, ResolvedModel[]> {
    const grouped = new Map<string, ResolvedModel[]>();
    for (const model of this.getAllModels()) {
      const existing = grouped.get(model.providerId) || [];
      existing.push(model);
      grouped.set(model.providerId, existing);
    }
    return grouped;
  }

  /**
   * Check if a model ID is valid
   */
  hasModel(id: string): boolean {
    return this.models.has(id);
  }

  /**
   * Get model IDs as a type-safe array (for validation)
   */
  getModelIds(): string[] {
    return Array.from(this.models.keys());
  }
}

// Singleton instance
export const registry = new Registry();

/**
 * Helper function for defining providers.
 * Automatically registers the provider with the registry.
 */
export function defineProvider(def: ProviderDefinition): ProviderDefinition {
  registry.registerProvider(def);
  return def;
}

// Re-export types
export * from './types';
