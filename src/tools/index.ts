/**
 * Tool aggregation module
 * Collects all tool definitions and exports them as a unified array.
 */

import { findJsvmpDispatcherTool, FindJsvmpDispatcherInputSchema } from './findJsvmpDispatcherTool.js';

/**
 * Array of all available MCP tool definitions.
 * To add a new tool:
 * 1. Create a new tool module in src/tools/
 * 2. Import it here
 * 3. Add it to this array
 */
export const tools = [
  findJsvmpDispatcherTool,
] as const;

// Re-export ToolDefinition interface and defineTool helper
export { ToolDefinition, defineTool } from './ToolDefinition.js';

// Re-export tool and input schema
export { findJsvmpDispatcherTool, FindJsvmpDispatcherInputSchema };
