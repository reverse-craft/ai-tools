/**
 * Property-based tests for result merging logic
 * 
 * Tests the mergeDetectionResults function.
 * 
 * **Property 5: Merge preserves all detection regions**
 * **Property 6: Merged regions are sorted by start line**
 * **Property 7: Overlapping regions deduplicated by confidence**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  mergeDetectionResults, 
  type DetectionResult, 
  type DetectionRegion,
  type DetectionType,
  type ConfidenceLevel,
  type DetectionSummary
} from '../jsvmpDetector.js';

/**
 * Valid detection types
 */
const DETECTION_TYPES: DetectionType[] = [
  "If-Else Dispatcher",
  "Switch Dispatcher",
  "Instruction Array"
];

/**
 * Valid confidence levels in order from lowest to highest
 */
const CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  "low",
  "medium",
  "high",
  "ultra_high"
];

/**
 * Confidence level ordering for comparison
 */
const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = {
  'low': 1,
  'medium': 2,
  'high': 3,
  'ultra_high': 4,
};

/**
 * Arbitrary for generating a DetectionRegion
 */
const detectionRegionArb = fc.record({
  start: fc.integer({ min: 1, max: 1000 }),
  end: fc.integer({ min: 1, max: 1000 }),
  type: fc.constantFrom(...DETECTION_TYPES),
  confidence: fc.constantFrom(...CONFIDENCE_LEVELS),
  description: fc.string({ minLength: 1, maxLength: 50 }),
}).map(r => ({
  ...r,
  end: Math.max(r.start, r.end), // Ensure end >= start
}));

/**
 * Arbitrary for generating a DetectionResult with string summary
 */
const detectionResultArb: fc.Arbitrary<DetectionResult> = fc.record({
  summary: fc.string({ minLength: 1, maxLength: 100 }),
  regions: fc.array(detectionRegionArb, { minLength: 0, maxLength: 5 }),
});

/**
 * Helper to extract summary text from string or object format
 */
function getSummaryText(summary: string | DetectionSummary): string {
  if (typeof summary === 'string') {
    return summary;
  }
  return summary.overall_description;
}

/**
 * Check if two regions overlap
 */
function regionsOverlap(a: DetectionRegion, b: DetectionRegion): boolean {
  return a.start <= b.end && a.end >= b.start;
}

/**
 * Feature: jsvmp-detector-refactor, Property 5: Merge preserves all detection regions
 * 
 * *For any* list of DetectionResults from multiple batches, the merged result
 * SHALL contain all regions from all inputs (before deduplication).
 * 
 * **Validates: Requirements 5.1, 5.2**
 */
describe('Property 5: Merge preserves all detection regions', () => {
  it('should preserve all regions when no overlaps exist', () => {
    fc.assert(
      fc.property(
        fc.array(detectionResultArb, { minLength: 1, maxLength: 5 }),
        (results) => {
          // Generate non-overlapping regions by spacing them out
          let currentLine = 1;
          const spacedResults: DetectionResult[] = results.map(r => ({
            summary: r.summary,
            regions: r.regions.map(region => {
              const start = currentLine;
              const end = start + (region.end - region.start);
              currentLine = end + 10; // Gap to prevent overlap
              return { ...region, start, end };
            }),
          }));

          const merged = mergeDetectionResults(spacedResults);

          // Count total regions from all inputs
          const totalInputRegions = spacedResults.reduce(
            (sum, r) => sum + r.regions.length, 
            0
          );

          // Merged should have same count when no overlaps
          expect(merged.regions.length).toBe(totalInputRegions);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should combine summaries from all batches', () => {
    fc.assert(
      fc.property(
        fc.array(detectionResultArb, { minLength: 2, maxLength: 5 }),
        (results) => {
          const merged = mergeDetectionResults(results);
          const summaryText = getSummaryText(merged.summary);

          // Each batch summary should appear in the combined summary
          for (let i = 0; i < results.length; i++) {
            const summary = results[i].summary;
            const inputSummary = typeof summary === 'string' 
              ? summary 
              : summary.overall_description;
            expect(summaryText).toContain(inputSummary);
            expect(summaryText).toContain(`[Batch ${i + 1}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle empty results array', () => {
    const merged = mergeDetectionResults([]);
    expect(merged.summary).toBe('');
    expect(merged.regions).toEqual([]);
  });

  it('should return single result with sorted regions', () => {
    fc.assert(
      fc.property(
        detectionResultArb,
        (result) => {
          const merged = mergeDetectionResults([result]);
          // Summary should be unchanged
          expect(merged.summary).toEqual(result.summary);
          // Regions should be sorted by start line
          for (let i = 1; i < merged.regions.length; i++) {
            expect(merged.regions[i].start).toBeGreaterThanOrEqual(
              merged.regions[i - 1].start
            );
          }
          // Should have same number of regions
          expect(merged.regions.length).toEqual(result.regions.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: jsvmp-detector-refactor, Property 6: Merged regions are sorted by start line
 * 
 * *For any* merged DetectionResult, the regions array SHALL be sorted
 * in ascending order by the `start` field.
 * 
 * **Validates: Requirements 5.3**
 */
describe('Property 6: Merged regions are sorted by start line', () => {
  it('should sort regions by start line in ascending order', () => {
    fc.assert(
      fc.property(
        fc.array(detectionResultArb, { minLength: 1, maxLength: 5 }),
        (results) => {
          const merged = mergeDetectionResults(results);

          // Verify regions are sorted by start line
          for (let i = 1; i < merged.regions.length; i++) {
            expect(merged.regions[i].start).toBeGreaterThanOrEqual(
              merged.regions[i - 1].start
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should sort unsorted input regions', () => {
    // Create results with regions in reverse order
    const results: DetectionResult[] = [
      {
        summary: 'Batch 1',
        regions: [
          { start: 100, end: 110, type: 'Instruction Array', confidence: 'high', description: 'Region 1' },
        ],
      },
      {
        summary: 'Batch 2',
        regions: [
          { start: 50, end: 60, type: 'Switch Dispatcher', confidence: 'medium', description: 'Region 2' },
        ],
      },
      {
        summary: 'Batch 3',
        regions: [
          { start: 10, end: 20, type: 'If-Else Dispatcher', confidence: 'low', description: 'Region 3' },
        ],
      },
    ];

    const merged = mergeDetectionResults(results);

    // Should be sorted: 10, 50, 100
    expect(merged.regions[0].start).toBe(10);
    expect(merged.regions[1].start).toBe(50);
    expect(merged.regions[2].start).toBe(100);
  });
});

/**
 * Feature: jsvmp-detector-refactor, Property 7: Overlapping regions deduplicated by confidence
 * 
 * *For any* two regions with overlapping line ranges, only the region with
 * higher confidence SHALL remain in the merged result. If confidence is equal,
 * keep the first one.
 * 
 * **Validates: Requirements 5.4**
 */
describe('Property 7: Overlapping regions deduplicated by confidence', () => {
  it('should keep higher confidence region when overlapping', () => {
    // Create overlapping regions with different confidence levels
    const results: DetectionResult[] = [
      {
        summary: 'Batch 1',
        regions: [
          { start: 10, end: 30, type: 'Instruction Array', confidence: 'low', description: 'Low confidence' },
        ],
      },
      {
        summary: 'Batch 2',
        regions: [
          { start: 20, end: 40, type: 'Switch Dispatcher', confidence: 'high', description: 'High confidence' },
        ],
      },
    ];

    const merged = mergeDetectionResults(results);

    // Should only have one region (the high confidence one)
    expect(merged.regions.length).toBe(1);
    expect(merged.regions[0].confidence).toBe('high');
    expect(merged.regions[0].description).toBe('High confidence');
  });

  it('should keep first region when confidence is equal', () => {
    // Create overlapping regions with same confidence
    const results: DetectionResult[] = [
      {
        summary: 'Batch 1',
        regions: [
          { start: 10, end: 30, type: 'Instruction Array', confidence: 'medium', description: 'First region' },
        ],
      },
      {
        summary: 'Batch 2',
        regions: [
          { start: 20, end: 40, type: 'Switch Dispatcher', confidence: 'medium', description: 'Second region' },
        ],
      },
    ];

    const merged = mergeDetectionResults(results);

    // Should only have one region (the first one)
    expect(merged.regions.length).toBe(1);
    expect(merged.regions[0].description).toBe('First region');
  });

  it('should handle multiple overlapping regions correctly', () => {
    fc.assert(
      fc.property(
        // Generate overlapping regions with different confidence levels
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 10, max: 50 }),
        (baseStart, rangeSize) => {
          // Create 4 overlapping regions with different confidence levels
          const results: DetectionResult[] = CONFIDENCE_LEVELS.map((conf, i) => ({
            summary: `Batch ${i + 1}`,
            regions: [{
              start: baseStart + i * 5, // Slight offset but still overlapping
              end: baseStart + rangeSize + i * 5,
              type: DETECTION_TYPES[i % DETECTION_TYPES.length],
              confidence: conf,
              description: `Region with ${conf} confidence`,
            }],
          }));

          const merged = mergeDetectionResults(results);

          // All regions overlap, so only one should remain
          expect(merged.regions.length).toBe(1);
          
          // The remaining region should have the highest confidence
          expect(merged.regions[0].confidence).toBe('ultra_high');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not deduplicate non-overlapping regions', () => {
    // Create non-overlapping regions
    const results: DetectionResult[] = [
      {
        summary: 'Batch 1',
        regions: [
          { start: 10, end: 20, type: 'Instruction Array', confidence: 'low', description: 'Region 1' },
        ],
      },
      {
        summary: 'Batch 2',
        regions: [
          { start: 30, end: 40, type: 'Switch Dispatcher', confidence: 'high', description: 'Region 2' },
        ],
      },
    ];

    const merged = mergeDetectionResults(results);

    // Both regions should remain
    expect(merged.regions.length).toBe(2);
  });

  it('should handle edge case: adjacent but non-overlapping regions', () => {
    // Regions that are adjacent (end of one = start of next - 1)
    const results: DetectionResult[] = [
      {
        summary: 'Batch 1',
        regions: [
          { start: 10, end: 20, type: 'Instruction Array', confidence: 'low', description: 'Region 1' },
        ],
      },
      {
        summary: 'Batch 2',
        regions: [
          { start: 21, end: 30, type: 'Switch Dispatcher', confidence: 'high', description: 'Region 2' },
        ],
      },
    ];

    const merged = mergeDetectionResults(results);

    // Both regions should remain (they don't overlap)
    expect(merged.regions.length).toBe(2);
  });

  it('should handle exact overlap (same start and end)', () => {
    const results: DetectionResult[] = [
      {
        summary: 'Batch 1',
        regions: [
          { start: 10, end: 20, type: 'Instruction Array', confidence: 'medium', description: 'First' },
        ],
      },
      {
        summary: 'Batch 2',
        regions: [
          { start: 10, end: 20, type: 'Switch Dispatcher', confidence: 'high', description: 'Second' },
        ],
      },
    ];

    const merged = mergeDetectionResults(results);

    // Should keep the higher confidence one
    expect(merged.regions.length).toBe(1);
    expect(merged.regions[0].confidence).toBe('high');
    expect(merged.regions[0].description).toBe('Second');
  });
});
