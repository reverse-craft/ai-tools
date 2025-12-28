/**
 * Property-based tests for findJsvmpDispatcherTool
 * 
 * Tests the MCP tool's input validation and response format properties.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { z } from 'zod';
import { FindJsvmpDispatcherInputSchema, findJsvmpDispatcherTool } from '../tools/findJsvmpDispatcherTool.js';

// Create Zod schema object for validation
const inputSchema = z.object(FindJsvmpDispatcherInputSchema);

/**
 * Feature: mcp-server-integration, Property 1: Input Validation Completeness
 * 
 * *For any* input object where required field (filePath) is missing,
 * has wrong type (non-string filePath), or where optional charLimit/maxTokensPerBatch
 * is provided but not a positive integer, the tool SHALL return a validation error
 * before attempting detection.
 * 
 * **Validates: Requirements 2.1, 2.2, 3.2, 3.3**
 */
describe('Property 1: Input Validation Completeness', () => {
  it('should reject inputs with missing filePath', () => {
    fc.assert(
      fc.property(
        fc.record({
          charLimit: fc.option(fc.integer({ min: 1 }), { nil: undefined }),
          maxTokensPerBatch: fc.option(fc.integer({ min: 1 }), { nil: undefined }),
        }),
        (input) => {
          const result = inputSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject inputs with non-string filePath', () => {
    fc.assert(
      fc.property(
        fc.record({
          filePath: fc.oneof(
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.array(fc.string())
          ),
        }),
        (input) => {
          const result = inputSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject inputs with non-positive-integer charLimit when provided', () => {
    fc.assert(
      fc.property(
        fc.record({
          filePath: fc.string(),
          charLimit: fc.oneof(
            fc.integer({ max: 0 }),  // zero or negative
            fc.double(),              // non-integer
            fc.string()               // wrong type
          ),
        }),
        (input) => {
          const result = inputSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject inputs with non-positive-integer maxTokensPerBatch when provided', () => {
    fc.assert(
      fc.property(
        fc.record({
          filePath: fc.string(),
          maxTokensPerBatch: fc.oneof(
            fc.integer({ max: 0 }),  // zero or negative
            fc.double(),              // non-integer
            fc.string()               // wrong type
          ),
        }),
        (input) => {
          const result = inputSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should accept valid inputs with only filePath', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (filePath) => {
          const result = inputSchema.safeParse({ filePath });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should accept valid inputs with all optional parameters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1 }),
        fc.integer({ min: 1 }),
        (filePath, charLimit, maxTokensPerBatch) => {
          const result = inputSchema.safeParse({ filePath, charLimit, maxTokensPerBatch });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Mock the jsvmpDetector module for Property 2 and 3
vi.mock('../jsvmpDetector.js', () => ({
  findJsvmpDispatcher: vi.fn(),
}));

import { findJsvmpDispatcher } from '../jsvmpDetector.js';
const mockedFindJsvmpDispatcher = vi.mocked(findJsvmpDispatcher);

/**
 * Feature: mcp-server-integration, Property 2: Success Output Format Consistency
 * 
 * *For any* successful detection call with valid input (filePath),
 * the returned text content SHALL contain the original filePath and batch information.
 * 
 * **Validates: Requirements 2.3, 5.1**
 */
describe('Property 2: Success Output Format Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return output containing filePath and batch info on success', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),  // filePath
        fc.integer({ min: 1, max: 1000 }),            // totalLines
        fc.integer({ min: 1, max: 10 }),              // batchCount
        async (filePath, totalLines, batchCount) => {
          // Mock successful detection result
          const mockFormattedOutput = `=== JSVMP Dispatcher Detection Result ===
File: ${filePath} (${totalLines} lines, ${batchCount} batch${batchCount > 1 ? 'es' : ''})

Summary: Test summary

No JSVMP dispatcher patterns detected.`;

          mockedFindJsvmpDispatcher.mockResolvedValueOnce({
            success: true,
            filePath,
            totalLines,
            batchCount,
            result: {
              summary: 'Test summary',
              regions: [],
            },
            formattedOutput: mockFormattedOutput,
          });

          const result = await findJsvmpDispatcherTool.handler({
            filePath,
          });

          // Verify output contains filePath
          expect(result).toContain(filePath);
          // Verify output contains line count
          expect(result).toContain(`${totalLines} lines`);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: mcp-server-integration, Property 3: Error Response Format
 * 
 * *For any* failed detection call (validation error, file not found, LLM not configured,
 * LLM API error), the tool response SHALL have isError flag set to true and contain
 * a non-empty error message string.
 * 
 * Note: The handler throws errors which the MCP server catches and converts to
 * isError=true responses. We test that the handler throws with non-empty error messages.
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */
describe('Property 3: Error Response Format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Error types that can occur
  const errorTypes = [
    { name: 'LLM not configured', error: '未配置 LLM。请设置环境变量 OPENAI_API_KEY 以启用 JSVMP dispatcher 检测功能。' },
    { name: 'File not found', error: '文件不存在: /path/to/file.js' },
    { name: 'LLM API error', error: 'LLM 请求失败: Connection timeout' },
    { name: 'Invalid LLM response', error: 'LLM 响应格式无效，期望对象类型' },
  ];

  it('should throw error with non-empty message when detection fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),  // filePath
        fc.integer({ min: 0, max: errorTypes.length - 1 }),  // error type index
        async (filePath, errorIndex) => {
          const errorType = errorTypes[errorIndex];

          // Mock failed detection result
          mockedFindJsvmpDispatcher.mockResolvedValueOnce({
            success: false,
            filePath,
            totalLines: 0,
            batchCount: 0,
            error: errorType.error,
          });

          // The handler should throw an error
          await expect(findJsvmpDispatcherTool.handler({
            filePath,
          })).rejects.toThrow();

          // Verify the error message is non-empty
          try {
            await findJsvmpDispatcherTool.handler({
              filePath,
            });
          } catch (e) {
            expect(e).toBeInstanceOf(Error);
            expect((e as Error).message).toBeTruthy();
            expect((e as Error).message.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should throw error with specific message for LLM not configured', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),  // filePath
        async (filePath) => {
          // Mock LLM not configured error
          mockedFindJsvmpDispatcher.mockResolvedValueOnce({
            success: false,
            filePath,
            totalLines: 0,
            batchCount: 0,
            error: '未配置 LLM。请设置环境变量 OPENAI_API_KEY 以启用 JSVMP dispatcher 检测功能。',
          });

          // The handler should throw with the LLM configuration error
          await expect(findJsvmpDispatcherTool.handler({
            filePath,
          })).rejects.toThrow('OPENAI_API_KEY');
        }
      ),
      { numRuns: 100 }
    );
  });
});
