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
 * - Multiple independent JSVMP instances
 * - If-Else Dispatchers
 * - Switch Dispatchers  
 * - Instruction Arrays
 * - VM Components (IP, SP, Stack, Bytecode Array)
 * - Debugging Entry Points
 * 
 * Requires OPENAI_API_KEY environment variable to be set.
 */
export const findJsvmpDispatcherTool = defineTool({
  name: 'find_jsvmp_dispatcher',
  description: `Detect JSVMP (JavaScript Virtual Machine Protection) patterns in code using LLM analysis.

JSVMP is a code protection technique that converts JavaScript to bytecode executed by a virtual machine. A single file may contain multiple independent JSVMP instances.

This tool identifies for each JSVMP instance:
- Region location and dispatcher type (If-Else Dispatcher, Switch Dispatcher, Instruction Array)
- VM Components: Instruction Pointer (IP), Stack Pointer (SP), Virtual Stack, Bytecode Array
- Debugging Entry Point: The optimal line number to set breakpoints

Detection confidence levels: ultra_high, high, medium, low

Automatically splits large files into batches based on token limits and merges results.

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
