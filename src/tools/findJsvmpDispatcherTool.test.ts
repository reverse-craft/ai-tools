/**
 * Property-based tests for findJsvmpDispatcherTool
 * 
 * Tests the MCP tool's input validation and response format properties.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { z } from 'zod';
import { FindJsvmpDispatcherInputSchema, findJsvmpDispatcherTool } from './findJsvmpDispatcherTool.js';

// Create Zod schema object for validation
const inputSchema = z.object(FindJsvmpDispatcherInputSchema);

/**
 * Feature: mcp-server-integration, Property 1: Input Validation Completeness
 * 
 * *For any* input object where any required field (filePath, startLine, endLine) is missing,
 * has wrong type (non-string filePath, non-positive-integer startLine/endLine), or where
 * optional charLimit is provided but not a positive integer, the tool SHALL return a
 * validation error before attempting detection.
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.5**
 */
describe('Property 1: Input Validation Completeness', () => {
  it('should reject inputs with missing filePath', () => {
    fc.assert(
      fc.property(
        fc.record({
          startLine: fc.integer({ min: 1 }),
          endLine: fc.integer({ min: 1 }),
          charLimit: fc.option(fc.integer({ min: 1 }), { nil: undefined }),
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
          startLine: fc.integer({ min: 1 }),
          endLine: fc.integer({ min: 1 }),
        }),
        (input) => {
          const result = inputSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject inputs with missing startLine', () => {
    fc.assert(
      fc.property(
        fc.record({
          filePath: fc.string(),
          endLine: fc.integer({ min: 1 }),
        }),
        (input) => {
          const result = inputSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject inputs with non-positive-integer startLine', () => {
    fc.assert(
      fc.property(
        fc.record({
          filePath: fc.string(),
          startLine: fc.oneof(
            fc.integer({ max: 0 }),  // zero or negative
            fc.double(),              // non-integer
            fc.string(),              // wrong type
            fc.constant(null)
          ),
          endLine: fc.integer({ min: 1 }),
        }),
        (input) => {
          const result = inputSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject inputs with missing endLine', () => {
    fc.assert(
      fc.property(
        fc.record({
          filePath: fc.string(),
          startLine: fc.integer({ min: 1 }),
        }),
        (input) => {
          const result = inputSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject inputs with non-positive-integer endLine', () => {
    fc.assert(
      fc.property(
        fc.record({
          filePath: fc.string(),
          startLine: fc.integer({ min: 1 }),
          endLine: fc.oneof(
            fc.integer({ max: 0 }),  // zero or negative
            fc.double(),              // non-integer
            fc.string(),              // wrong type
            fc.constant(null)
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
          startLine: fc.integer({ min: 1 }),
          endLine: fc.integer({ min: 1 }),
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
});


/**
 * Feature: mcp-server-integration, Property 2: Line Range Validation
 * 
 * *For any* input where endLine < startLine (both being valid positive integers),
 * the tool SHALL return a validation error indicating invalid line range.
 * 
 * **Validates: Requirements 3.4**
 */
describe('Property 2: Line Range Validation', () => {
  it('should throw error when endLine < startLine', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10000 }),  // startLine (at least 2 so endLine can be less)
        fc.string({ minLength: 1 }),          // filePath
        fc.option(fc.integer({ min: 1 }), { nil: undefined }),  // charLimit
        async (startLine, filePath, charLimit) => {
          // Generate endLine that is less than startLine
          const endLine = fc.sample(fc.integer({ min: 1, max: startLine - 1 }), 1)[0];
          
          const params = { filePath, startLine, endLine, charLimit };
          
          // The handler should throw an error for invalid line range
          await expect(findJsvmpDispatcherTool.handler(params)).rejects.toThrow('endLine must be >= startLine');
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Mock the jsvmpDetector module for Property 3 and 4
vi.mock('../jsvmpDetector.js', () => ({
  findJsvmpDispatcher: vi.fn(),
}));

import { findJsvmpDispatcher } from '../jsvmpDetector.js';
const mockedFindJsvmpDispatcher = vi.mocked(findJsvmpDispatcher);

/**
 * Feature: mcp-server-integration, Property 3: Success Output Format Consistency
 * 
 * *For any* successful detection call with valid input (filePath, startLine, endLine),
 * the returned text content SHALL contain the original filePath and the line range
 * (startLine-endLine) from the input.
 * 
 * **Validates: Requirements 2.6**
 */
describe('Property 3: Success Output Format Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return output containing filePath and line range on success', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),  // filePath
        fc.integer({ min: 1, max: 10000 }),           // startLine
        fc.integer({ min: 1, max: 10000 }),           // endLine offset (will be added to startLine)
        async (filePath, startLine, endLineOffset) => {
          const endLine = startLine + endLineOffset;
          
          // Mock successful detection result
          const mockFormattedOutput = `=== JSVMP Dispatcher Detection Result ===
File: ${filePath} (${startLine}-${endLine})

Summary: Test summary

No JSVMP dispatcher patterns detected.`;

          mockedFindJsvmpDispatcher.mockResolvedValueOnce({
            success: true,
            filePath,
            startLine,
            endLine,
            result: {
              summary: 'Test summary',
              regions: [],
            },
            formattedOutput: mockFormattedOutput,
          });

          const result = await findJsvmpDispatcherTool.handler({
            filePath,
            startLine,
            endLine,
          });

          // Verify output contains filePath and line range
          expect(result).toContain(filePath);
          expect(result).toContain(`${startLine}-${endLine}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: mcp-server-integration, Property 4: Error Response Format
 * 
 * *For any* failed detection call (validation error, file not found, LLM not configured,
 * LLM API error), the tool response SHALL have isError flag set to true and contain
 * a non-empty error message string.
 * 
 * Note: The handler throws errors which the MCP server catches and converts to
 * isError=true responses. We test that the handler throws with non-empty error messages.
 * 
 * **Validates: Requirements 2.7, 4.1, 4.2, 4.3**
 */
describe('Property 4: Error Response Format', () => {
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
        fc.integer({ min: 1, max: 10000 }),           // startLine
        fc.integer({ min: 0, max: 10000 }),           // endLine offset
        fc.integer({ min: 0, max: errorTypes.length - 1 }),  // error type index
        async (filePath, startLine, endLineOffset, errorIndex) => {
          const endLine = startLine + endLineOffset;
          const errorType = errorTypes[errorIndex];

          // Mock failed detection result
          mockedFindJsvmpDispatcher.mockResolvedValueOnce({
            success: false,
            filePath,
            startLine,
            endLine,
            error: errorType.error,
          });

          // The handler should throw an error
          await expect(findJsvmpDispatcherTool.handler({
            filePath,
            startLine,
            endLine,
          })).rejects.toThrow();

          // Verify the error message is non-empty
          try {
            await findJsvmpDispatcherTool.handler({
              filePath,
              startLine,
              endLine,
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
        fc.integer({ min: 1, max: 10000 }),           // startLine
        fc.integer({ min: 0, max: 10000 }),           // endLine offset
        async (filePath, startLine, endLineOffset) => {
          const endLine = startLine + endLineOffset;

          // Mock LLM not configured error
          mockedFindJsvmpDispatcher.mockResolvedValueOnce({
            success: false,
            filePath,
            startLine,
            endLine,
            error: '未配置 LLM。请设置环境变量 OPENAI_API_KEY 以启用 JSVMP dispatcher 检测功能。',
          });

          // The handler should throw with the LLM configuration error
          await expect(findJsvmpDispatcherTool.handler({
            filePath,
            startLine,
            endLine,
          })).rejects.toThrow('OPENAI_API_KEY');
        }
      ),
      { numRuns: 100 }
    );
  });
});
