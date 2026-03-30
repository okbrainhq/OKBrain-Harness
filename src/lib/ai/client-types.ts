/**
 * Client-Side Model Types
 *
 * Lightweight types for client-side use (no registry dependency).
 * These are safe to import in client components.
 */

// Model capabilities exposed to client
export interface ModelCapabilitiesClient {
  fileUpload: boolean;
  thinking: boolean;
  tools: boolean;
}

// Model info for client-side display and logic
export interface ModelInfo {
  id: string;
  name: string;
  capabilities: ModelCapabilitiesClient;
}

// Full models config passed from server to client
export interface ModelsConfig {
  models: ModelInfo[];
  defaultModelId: string;
}
