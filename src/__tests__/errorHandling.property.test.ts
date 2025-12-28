/**
 * Property-based tests for error handling logic
 * 
 * Tests the processBatchesWithErrorHandling function.
 * 
 * **Property 8: Partial failure continues processing**
 * **Property 9: Total failure reports all errors**
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  processBatchesWithErrorHandling, 
  type BatchInfo,
  type DetectionResult,
  type DetectionType,
  type ConfidenceLevel 
} from '../jsvmpDetector.js';
import type { LLMClient } from '../llmConfig.js';

/**
 * Valid detection types
 */
const DETECTION_TYPES: DetectionType[] = [
  "If-Else Dispatcher",
  "Switch Dispatcher",
  "Instruction Array"
];

/**
 * Valid confidence levels
 */
const CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  "low",
  "medium",
  "high",
  "ultra_high"
];

/**
 * Generate a valid DetectionResult JSON string (using new format with start_line/end_line)
 */
function generateValidResultJson(batchIndex: number): string {
  const result = {
    summary: {
      overall_description: `Analysis of batch ${batchIndex}`,
      debugging_recommendation: `Debug batch ${batchIndex} at the entry point`
    },
    regions: [{
      start_line: batchIndex * 100 + 1,
      end_line: batchIndex * 100 + 50,
      type: DETECTION_TYPES[batchIndex % DETECTION_TYPES.length],
      confidence: CONFIDENCE_LEVELS[batchIndex % CONFIDENCE_LEVELS.length],
      description: `Region found in batch ${batchIndex}`,
    }],
  };
  return JSON.stringify(result);
}

/**
 * Create a mock LLM client that succeeds for specified batch indices
 */
function createMockClient(
  successIndices: Set<number>,
  errorMessage: string = 'LLM request failed'
): LLMClient {
  let callIndex = 0;
  return {
    async analyzeJSVMP(_formattedCode: string): Promise<string> {
      const currentIndex = callIndex++;
      if (successIndices.has(currentIndex)) {
        return generateValidResultJson(currentIndex);
      }
      throw new Error(`${errorMessage} for batch ${currentIndex}`);
    }
  };
}

/**
 * Generate a BatchInfo for testing
 */
function generateBatchInfo(index: number): BatchInfo {
  return {
    startLine: index * 100 + 1,
    endLine: index * 100 + 100,
    content: `    ${index * 100 + 1} L1:0       var x${index} = ${index};`,
    tokenCount: 50,
  };
}

/**
 * Feature: jsvmp-detector-refactor, Property 8: Partial failure continues processing
 * 
 * *For any* batch processing where some batches fail, the result SHALL contain
 * regions from successful batches AND error information from failed batches.
 * 
 * **Validates: Requirements 6.1, 6.2**
 */
describe('Property 8: Partial failure continues processing', () => {
  it('should continue processing when some batches fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate number of batches (2-5)
        fc.integer({ min: 2, max: 5 }),
        // Generate a subset of indices that should succeed
        fc.array(fc.boolean(), { minLength: 2, maxLength: 5 }),
        async (numBatches, successFlags) => {
          // Trim or extend successFlags to match numBatches
          const flags = successFlags.slice(0, numBatches);
          while (flags.length < numBatches) {
            flags.push(false);
          }
          
          // Build success indices set
          const successIndices = new Set<number>();
          for (let i = 0; i < numBatches; i++) {
            if (flags[i]) {
              successIndices.add(i);
            }
          }
          
          // Ensure we have at least one failure
          if (successIndices.size === numBatches) {
            successIndices.delete(0);
          }
          // Ensure we have at least one success
          if (successIndices.size === 0) {
            successIndices.add(0);
          }

          const batches = Array.from({ length: numBatches }, (_, i) => generateBatchInfo(i));
          const client = createMockClient(successIndices);

          const { results, errors } = await processBatchesWithErrorHandling(client, batches);

          // Should have results from successful batches
          expect(results.length).toBe(successIndices.size);

          // Should have errors from failed batches
          expect(errors.length).toBe(numBatches - successIndices.size);

          // Each error should mention the batch that failed
          for (const error of errors) {
            expect(error).toContain('failed');
            expect(error).toContain('Batch');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should collect partial results when first batch fails', async () => {
    const batches = [generateBatchInfo(0), generateBatchInfo(1), generateBatchInfo(2)];
    // Only batch 1 and 2 succeed (indices 1 and 2)
    const client = createMockClient(new Set([1, 2]));

    const { results, errors } = await processBatchesWithErrorHandling(client, batches);

    expect(results.length).toBe(2);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('Batch 1');
  });

  it('should collect partial results when middle batch fails', async () => {
    const batches = [generateBatchInfo(0), generateBatchInfo(1), generateBatchInfo(2)];
    // Only batch 0 and 2 succeed (indices 0 and 2)
    const client = createMockClient(new Set([0, 2]));

    const { results, errors } = await processBatchesWithErrorHandling(client, batches);

    expect(results.length).toBe(2);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('Batch 2');
  });

  it('should collect partial results when last batch fails', async () => {
    const batches = [generateBatchInfo(0), generateBatchInfo(1), generateBatchInfo(2)];
    // Only batch 0 and 1 succeed (indices 0 and 1)
    const client = createMockClient(new Set([0, 1]));

    const { results, errors } = await processBatchesWithErrorHandling(client, batches);

    expect(results.length).toBe(2);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('Batch 3');
  });

  it('should include line range information in error messages', async () => {
    const batches = [generateBatchInfo(0), generateBatchInfo(1)];
    // Only batch 1 succeeds
    const client = createMockClient(new Set([1]));

    const { errors } = await processBatchesWithErrorHandling(client, batches);

    expect(errors.length).toBe(1);
    // Error should contain line range info
    expect(errors[0]).toContain('lines');
    expect(errors[0]).toContain(String(batches[0].startLine));
    expect(errors[0]).toContain(String(batches[0].endLine));
  });
});

/**
 * Feature: jsvmp-detector-refactor, Property 9: Total failure reports all errors
 * 
 * *For any* batch processing where all batches fail, the error message
 * SHALL contain details from all failed batches.
 * 
 * **Validates: Requirements 6.3**
 */
describe('Property 9: Total failure reports all errors', () => {
  it('should report all errors when all batches fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate number of batches (1-5)
        fc.integer({ min: 1, max: 5 }),
        async (numBatches) => {
          const batches = Array.from({ length: numBatches }, (_, i) => generateBatchInfo(i));
          // No batches succeed
          const client = createMockClient(new Set());

          const { results, errors } = await processBatchesWithErrorHandling(client, batches);

          // Should have no results
          expect(results.length).toBe(0);

          // Should have errors for all batches
          expect(errors.length).toBe(numBatches);

          // Each batch should have a corresponding error
          for (let i = 0; i < numBatches; i++) {
            const batchError = errors.find(e => e.includes(`Batch ${i + 1}`));
            expect(batchError).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve error details from each failed batch', async () => {
    const batches = [generateBatchInfo(0), generateBatchInfo(1), generateBatchInfo(2)];
    const client = createMockClient(new Set(), 'Custom error message');

    const { errors } = await processBatchesWithErrorHandling(client, batches);

    expect(errors.length).toBe(3);
    // Each error should contain the custom error message
    for (const error of errors) {
      expect(error).toContain('Custom error message');
    }
  });

  it('should handle single batch failure', async () => {
    const batches = [generateBatchInfo(0)];
    const client = createMockClient(new Set());

    const { results, errors } = await processBatchesWithErrorHandling(client, batches);

    expect(results.length).toBe(0);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('Batch 1');
  });

  it('should handle empty batches array', async () => {
    const client = createMockClient(new Set());

    const { results, errors } = await processBatchesWithErrorHandling(client, []);

    expect(results.length).toBe(0);
    expect(errors.length).toBe(0);
  });

  it('should return all successful results when no failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (numBatches) => {
          const batches = Array.from({ length: numBatches }, (_, i) => generateBatchInfo(i));
          // All batches succeed
          const successIndices = new Set(Array.from({ length: numBatches }, (_, i) => i));
          const client = createMockClient(successIndices);

          const { results, errors } = await processBatchesWithErrorHandling(client, batches);

          expect(results.length).toBe(numBatches);
          expect(errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
