/**
 * Auto-register all AI providers
 *
 * Import this module to ensure all providers are registered with the registry.
 * Each provider file registers itself via defineProvider() when imported.
 */

// Import all providers to trigger registration
import './google';
import './xai';
import './anthropic';
import './openrouter';
import './fireworks';
import './ollama';
import './zai';

// Re-export registry for convenience
export { registry } from '../registry';
