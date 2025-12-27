/**
 * Property-based tests for batch processing logic
 * 
 * Tests the createBatches function and line number preservation.
 * 
 * **Property 4: Original line numbers preserved in batches**
 * **Validates: Requirements 4.4**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createBatches, type BatchInfo } from '../jsvmpDetector.js';

/**
 * Generate a formatted code line in the format: "LineNo SourceLoc Code"
 * Format: "    N L1:0       code content"
 */
function generateFormattedLine(lineNum: number, code: string): string {
  const lineNumStr = String(lineNum).padStart(5, ' ');
  const srcPosPadded = `L${lineNum}:0`.padEnd(10, ' ');
  return `${lineNumStr} ${srcPosPadded} ${code}`;
}

/**
 * Extract line number from a formatted code line
 */
function extractLineNumber(formattedLine: string): number {
  const lineNumStr = formattedLine.substring(0, 5).trim();
  return parseInt(lineNumStr, 10);
}

/**
 * Feature: jsvmp-detector-refactor, Property 4: Original line numbers preserved in batches
 * 
 * *For any* batch with startLine N, the formatted code lines in that batch
 * SHALL have line numbers starting from N and incrementing sequentially.
 * 
 * **Validates: Requirements 4.4**
 */
describe('Property 4: Original line numbers preserved in batches', () => {
  it('should preserve original line numbers in each batch', () => {
    fc.assert(
      fc.property(
        // Generate number of lines (1-50)
        fc.integer({ min: 1, max: 50 }),
        // Generate max tokens per batch (100-1000)
        fc.integer({ min: 100, max: 1000 }),
        (numLines, maxTokens) => {
          // Generate formatted lines with sequential line numbers
          const formattedLines: string[] = [];
          for (let i = 1; i <= numLines; i++) {
            formattedLines.push(generateFormattedLine(i, `var x${i} = ${i};`));
          }

          // Create batches
          const batches = createBatches(formattedLines, maxTokens);

          // Verify each batch preserves line numbers
          for (const batch of batches) {
            // Extract line numbers from batch content
            const batchLines = batch.content.split('\n');
            const lineNumbers = batchLines.map(extractLineNumber);

            // Verify startLine matches first line number in content
            expect(lineNumbers[0]).toBe(batch.startLine);

            // Verify endLine matches last line number in content
            expect(lineNumbers[lineNumbers.length - 1]).toBe(batch.endLine);

            // Verify line numbers are sequential within batch
            for (let i = 1; i < lineNumbers.length; i++) {
              expect(lineNumbers[i]).toBe(lineNumbers[i - 1] + 1);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  }, 30000);

  it('should have consecutive line numbers across batches', () => {
    fc.assert(
      fc.property(
        // Generate number of lines (10-30)
        fc.integer({ min: 10, max: 30 }),
        // Generate max tokens per batch (small to force multiple batches)
        fc.integer({ min: 100, max: 300 }),
        (numLines, maxTokens) => {
          // Generate formatted lines with sequential line numbers
          const formattedLines: string[] = [];
          for (let i = 1; i <= numLines; i++) {
            formattedLines.push(generateFormattedLine(i, `var x${i} = ${i};`));
          }

          // Create batches
          const batches = createBatches(formattedLines, maxTokens);

          if (batches.length === 0) return;

          // Verify first batch starts at line 1
          expect(batches[0].startLine).toBe(1);

          // Verify consecutive batches have consecutive line numbers
          for (let i = 1; i < batches.length; i++) {
            const prevBatch = batches[i - 1];
            const currBatch = batches[i];
            expect(currBatch.startLine).toBe(prevBatch.endLine + 1);
          }

          // Verify last batch ends at the last line
          expect(batches[batches.length - 1].endLine).toBe(numLines);
        }
      ),
      { numRuns: 10 }
    );
  }, 30000);

  it('should cover all original lines without gaps or duplicates', () => {
    fc.assert(
      fc.property(
        // Generate number of lines (1-30)
        fc.integer({ min: 1, max: 30 }),
        // Generate max tokens per batch
        fc.integer({ min: 50, max: 500 }),
        (numLines, maxTokens) => {
          // Generate formatted lines with sequential line numbers
          const formattedLines: string[] = [];
          for (let i = 1; i <= numLines; i++) {
            formattedLines.push(generateFormattedLine(i, `line ${i}`));
          }

          // Create batches
          const batches = createBatches(formattedLines, maxTokens);

          // Collect all line numbers from all batches
          const allLineNumbers: number[] = [];
          for (const batch of batches) {
            const batchLines = batch.content.split('\n');
            for (const line of batchLines) {
              allLineNumbers.push(extractLineNumber(line));
            }
          }

          // Sort and verify no gaps or duplicates
          allLineNumbers.sort((a, b) => a - b);
          
          // Should have exactly numLines line numbers
          expect(allLineNumbers.length).toBe(numLines);

          // Should be sequential from 1 to numLines
          for (let i = 0; i < numLines; i++) {
            expect(allLineNumbers[i]).toBe(i + 1);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle empty input', () => {
    const batches = createBatches([], 1000);
    expect(batches).toEqual([]);
  });

  it('should handle single line input', () => {
    const formattedLines = [generateFormattedLine(1, 'var x = 1;')];
    const batches = createBatches(formattedLines, 1000);
    
    expect(batches.length).toBe(1);
    expect(batches[0].startLine).toBe(1);
    expect(batches[0].endLine).toBe(1);
  });
});
