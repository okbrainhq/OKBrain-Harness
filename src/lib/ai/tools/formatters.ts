import { Tool as GeminiTool, FunctionDeclaration } from "@google/genai";
import { Tool } from './types';

/**
 * Convert our canonical tool definitions to Gemini format
 */
export function toGeminiTools(tools: Tool[]): GeminiTool[] {
  const functionDeclarations: FunctionDeclaration[] = tools.map(t => ({
    name: t.definition.name,
    description: t.definition.description,
    parameters: t.definition.parameters as any
  }));

  return [{ functionDeclarations }];
}

/**
 * Convert tool definitions to OpenAI/XAI format (for raw HTTP calls)
 */
export function toOpenAIToolDefinitions(tools: Tool[]): any[] {
  return tools.map(t => ({
    type: "function",
    function: {
      name: t.definition.name,
      description: t.definition.description,
      parameters: {
        type: "object",
        properties: convertPropertiesToJsonSchema(t.definition.parameters.properties),
        required: t.definition.parameters.required || []
      }
    }
  }));
}

/**
 * Convert tool definitions to Anthropic format (for raw HTTP calls)
 */
export function toAnthropicToolDefinitions(tools: Tool[]): any[] {
  return tools.map(t => ({
    name: t.definition.name,
    description: t.definition.description,
    input_schema: {
      type: "object",
      properties: convertPropertiesToJsonSchema(t.definition.parameters.properties),
      required: t.definition.parameters.required || []
    }
  }));
}

/**
 * Convert our parameter format to JSON Schema format (lowercase types)
 */
function convertPropertiesToJsonSchema(properties: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(properties)) {
    result[key] = convertPropertyToJsonSchema(value);
  }

  return result;
}

function convertPropertyToJsonSchema(prop: any): any {
  const type = prop.type?.toLowerCase() || 'string';
  const result: any = { type };

  if (prop.description) result.description = prop.description;
  if (prop.enum) result.enum = prop.enum;

  if (type === 'object' && prop.properties) {
    result.properties = convertPropertiesToJsonSchema(prop.properties);
    if (prop.required) result.required = prop.required;
  }

  if (type === 'array' && prop.items) {
    result.items = convertPropertyToJsonSchema(prop.items);
  }

  return result;
}
