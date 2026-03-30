/**
 * Common tool definition type - provider agnostic
 */
export interface ToolDefinition {
  name: string;
  description: string;
  shortDescription?: string; // Concise description for small models with limited context
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tool execution function type - handles its own configuration internally
 */
export type ToolExecutor = (args: any) => Promise<any>;

/**
 * Complete tool with definition and executor
 */
export interface Tool {
  definition: ToolDefinition;
  execute: ToolExecutor;

  // Optional: customize what's stored in the tool_call chat event content
  getCallEventExtra?: (args: any) => Record<string, any> | undefined;

  // Optional: customize what's stored in the tool_result chat event content
  getResultEventExtra?: (result: any, error?: Error) => Record<string, any> | undefined;
}
