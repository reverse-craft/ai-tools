/**
 * Property-Based Tests for Tokenizer Module
 * 
 * **Property 1: Token counting consistency**
 * *For any* valid text string, calling `countTokens` multiple times with the same input 
 * SHALL return the same token count.
 * **Validates: Requirements 3.1**
 * 
 * **Property 2: Batch splitting preserves all content**
 * *For any* array of code lines and any maxTokens limit, splitting into batches and 
 * concatenating all batches SHALL produce the original content (no lines lost or duplicated).
 * **Validates: Requirements 4.1, 4.2**
 * 
 * **Property 3: Batch splitting respects line boundaries**
 * *For any* batch produced by `splitByTokenLimit`, the batch content SHALL contain 
 * only complete lines (no partial lines).
 * **Validates: Requirements 4.2**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { countTokens, splitByTokenLimit } from '../tokenizer.js';

// Longer timeout for property tests using tiktoken (slow initialization)
const TEST_TIMEOUT = 60000;

describe('Tokenizer Property Tests', () => {
  /**
   * Feature: jsvmp-detector-refactor, Property 1: Token counting consistency
   * *For any* valid text string, calling `countTokens` multiple times with the same input 
   * SHALL return the same token count.
   * **Validates: Requirements 3.1**
   */
  describe('Property 1: Token counting consistency', () => {
    it('should return the same token count for identical inputs', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 200 }), (text) => {
          const count1 = countTokens(text);
          const count2 = countTokens(text);
          const count3 = countTokens(text);

          expect(count1).toBe(count2);
          expect(count2).toBe(count3);

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);

    it('should return non-negative token count for any input', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 200 }), (text) => {
          const count = countTokens(text);
          expect(count).toBeGreaterThanOrEqual(0);
          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: jsvmp-detector-refactor, Property 2: Batch splitting preserves all content
   * *For any* array of code lines and any maxTokens limit, splitting into batches and 
   * concatenating all batches SHALL produce the original content (no lines lost or duplicated).
   * **Validates: Requirements 4.1, 4.2**
   */
  describe('Property 2: Batch splitting preserves all content', () => {
    it('should preserve all lines when splitting and concatenating batches', () => {
      // Generate arrays of code-like lines
      const linesArb = fc.array(
        fc.stringMatching(/^[a-zA-Z0-9_\s=;(){}]+$/),
        { minLength: 1, maxLength: 20 }
      );
      const maxTokensArb = fc.integer({ min: 10, max: 200 });

      fc.assert(
        fc.property(linesArb, maxTokensArb, (lines, maxTokens) => {
          const batches = splitByTokenLimit(lines, maxTokens);
          
          // Flatten all batches back into a single array
          const reconstructed = batches.flat();
          
          // Should have the same number of lines
          expect(reconstructed.length).toBe(lines.length);
          
          // Each line should match exactly in order
          for (let i = 0; i < lines.length; i++) {
            expect(reconstructed[i]).toBe(lines[i]);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);

    it('should handle empty input array', () => {
      const batches = splitByTokenLimit([], 100);
      expect(batches).toEqual([]);
    });

    it('should preserve content with realistic code lines', () => {
      const codeLineArb = fc.constantFrom(
        'const x = 1;',
        'function test() { return 42; }',
        'console.log("hello world");',
        'var arr = [1, 2, 3, 4, 5];',
        'if (condition) { doSomething(); }',
        'for (let i = 0; i < 10; i++) { sum += i; }',
        'class MyClass { constructor() {} }',
        'export default function() {}',
        'import { something } from "module";',
        '// This is a comment'
      );
      
      const linesArb = fc.array(codeLineArb, { minLength: 1, maxLength: 15 });
      const maxTokensArb = fc.integer({ min: 50, max: 150 });

      fc.assert(
        fc.property(linesArb, maxTokensArb, (lines, maxTokens) => {
          const batches = splitByTokenLimit(lines, maxTokens);
          const reconstructed = batches.flat();
          
          expect(reconstructed).toEqual(lines);
          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: jsvmp-detector-refactor, Property 3: Batch splitting respects line boundaries
   * *For any* batch produced by `splitByTokenLimit`, the batch content SHALL contain 
   * only complete lines (no partial lines).
   * **Validates: Requirements 4.2**
   */
  describe('Property 3: Batch splitting respects line boundaries', () => {
    it('should produce batches where each element is a complete original line', () => {
      const linesArb = fc.array(
        fc.string({ minLength: 1, maxLength: 50 }),
        { minLength: 1, maxLength: 20 }
      );
      const maxTokensArb = fc.integer({ min: 20, max: 150 });

      fc.assert(
        fc.property(linesArb, maxTokensArb, (lines, maxTokens) => {
          const batches = splitByTokenLimit(lines, maxTokens);
          
          // Create a set of original lines for quick lookup
          const originalLinesSet = new Set(lines);
          
          // Every line in every batch should be an original line
          for (const batch of batches) {
            for (const line of batch) {
              expect(originalLinesSet.has(line)).toBe(true);
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);

    it('should maintain line order within and across batches', () => {
      const linesArb = fc.array(
        fc.string({ minLength: 1, maxLength: 30 }),
        { minLength: 2, maxLength: 15 }
      );
      const maxTokensArb = fc.integer({ min: 30, max: 150 });

      fc.assert(
        fc.property(linesArb, maxTokensArb, (lines, maxTokens) => {
          const batches = splitByTokenLimit(lines, maxTokens);
          const reconstructed = batches.flat();
          
          // Lines should appear in the same order as original
          for (let i = 0; i < lines.length; i++) {
            expect(reconstructed[i]).toBe(lines[i]);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);

    it('should not split individual lines across batches', () => {
      // Use unique lines to track them properly
      const linesArb = fc.array(
        fc.integer({ min: 0, max: 9999 }),
        { minLength: 5, maxLength: 15 }
      ).map(nums => nums.map((n, i) => `line_${i}_id_${n}_content`));
      
      const maxTokensArb = fc.integer({ min: 20, max: 100 });

      fc.assert(
        fc.property(linesArb, maxTokensArb, (lines, maxTokens) => {
          const batches = splitByTokenLimit(lines, maxTokens);
          const reconstructed = batches.flat();
          
          // Should have exact same lines in same order
          expect(reconstructed.length).toBe(lines.length);
          for (let i = 0; i < lines.length; i++) {
            expect(reconstructed[i]).toBe(lines[i]);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });
});
