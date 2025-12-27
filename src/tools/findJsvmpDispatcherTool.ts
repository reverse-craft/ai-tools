import { z } from 'zod';
import { defineTool } from './ToolDefinition.js';
import { findJsvmpDispatcher } from '../jsvmpDetector.js';

/**
 * Input schema for find_jsvmp_dispatcher tool
 */
export const FindJsvmpDispatcherInputSchema = {
  filePath: z.string().describe('Path to the JavaScript file to analyze'),
  charLimit: z.number().int().positive().optional().describe('Character limit for string truncation (default: 300)'),
  maxTokensPerBatch: z.number().int().positive().optional().describe('Maximum tokens per batch for LLM analysis (default: 150000)'),
};

/**
 * MCP Tool: find_jsvmp_dispatcher
 * 
 * Uses LLM to detect JSVMP (JavaScript Virtual Machine Protection) patterns in code.
 * 
 * JSVMP is a code protection technique that converts JavaScript to bytecode
 * executed by a virtual machine. This tool identifies:
 * - If-Else Dispatchers
 * - Switch Dispatchers  
 * - Instruction Arrays
 * - Stack Operations
 * 
 * Requires OPENAI_API_KEY environment variable to be set.
 */
export const findJsvmpDispatcherTool = defineTool({
  name: 'find_jsvmp_dispatcher',
  description: `Detect JSVMP (JavaScript Virtual Machine Protection) patterns in code using LLM analysis.

JSVMP is a code protection technique that converts JavaScript to bytecode executed by a virtual machine. This tool identifies:
- If-Else Dispatchers: Nested if-else chains for instruction dispatch
- Switch Dispatchers: Large switch statements (>20 cases) for opcode handling
- Instruction Arrays: Arrays storing bytecode instructions
- Stack Operations: Virtual stack push/pop patterns

Automatically splits large files into batches based on token limits and merges results.

Returns detection results with confidence levels (ultra_high, high, medium, low) and detailed descriptions.

Requires OPENAI_API_KEY environment variable. Optional: OPENAI_BASE_URL, OPENAI_MODEL.`,
  schema: FindJsvmpDispatcherInputSchema,
  handler: async (params): Promise<string> => {
    const { filePath, charLimit, maxTokensPerBatch } = params;

    const result = await findJsvmpDispatcher(filePath, {
      charLimit: charLimit ?? 300,
      maxTokensPerBatch: maxTokensPerBatch ?? 150000,
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Detection failed');
    }

    return result.formattedOutput ?? 'No output generated';
  },
});
