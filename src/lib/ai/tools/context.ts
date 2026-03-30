import { AsyncLocalStorage } from 'async_hooks';

/**
 * Tool execution context
 */
interface ToolContext {
  userId?: string;
  [key: string]: any;
}

/**
 * AsyncLocalStorage for tool execution context
 * This allows us to pass context (like userId) through the execution chain
 * without explicitly passing it as parameters
 */
const toolContextStorage = new AsyncLocalStorage<ToolContext>();

/**
 * Run a function with tool context
 * @param context - Context to provide (e.g., { userId })
 * @param fn - Function to run with context
 */
export function runWithToolContext<T>(context: ToolContext, fn: () => T): T {
  return toolContextStorage.run(context, fn);
}

/**
 * Get the current tool context
 * @returns The current context or undefined if not in a context
 */
export function getToolContext(): ToolContext | undefined {
  return toolContextStorage.getStore();
}

/**
 * Get the current userId from tool context
 * @returns The userId or undefined if not available
 */
export function getUserIdFromContext(): string | undefined {
  const context = getToolContext();
  return context?.userId;
}

/**
 * Get the current userId from tool context (throws if not available)
 * @returns The userId
 * @throws Error if userId is not available in context
 */
export function requireUserId(): string {
  const userId = getUserIdFromContext();
  if (!userId) {
    console.error('[TOOL CONTEXT ERROR] User ID not found in context');
    console.error('[TOOL CONTEXT ERROR] Ensure tools are executed within runWithToolContext({ userId })');
    console.error('[TOOL CONTEXT ERROR] Stack:', new Error().stack);
    throw new Error('User ID not found in context. Please ensure user is authenticated.');
  }
  return userId;
}
