/**
 * Tokenizer Module
 * Token counting and batch splitting utilities using tiktoken
 */

import { encoding_for_model, TiktokenModel } from 'tiktoken';

/**
 * Default model for token counting
 */
const DEFAULT_MODEL: TiktokenModel = 'gpt-4o';

/**
 * Calculate token count for text using tiktoken
 * 
 * @param text - The text to count tokens for
 * @param model - Optional model name (default: gpt-4o)
 * @returns The number of tokens in the text
 */
export function countTokens(text: string, model?: string): number {
  const enc = encoding_for_model((model as TiktokenModel) ?? DEFAULT_MODEL);
  try {
    const tokens = enc.encode(text);
    return tokens.length;
  } finally {
    enc.free();
  }
}

/**
 * Split lines into batches based on token limit
 * Splits at line boundaries to preserve code structure
 * 
 * @param lines - Array of code lines to split
 * @param maxTokens - Maximum tokens per batch
 * @param model - Optional model name (default: gpt-4o)
 * @returns Array of batches, where each batch is an array of lines
 */
export function splitByTokenLimit(
  lines: string[],
  maxTokens: number,
  model?: string
): string[][] {
  if (lines.length === 0) {
    return [];
  }

  if (maxTokens <= 0) {
    throw new Error('maxTokens must be a positive number');
  }

  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentTokenCount = 0;

  const enc = encoding_for_model((model as TiktokenModel) ?? DEFAULT_MODEL);
  
  try {
    for (const line of lines) {
      // Calculate tokens for this line (including newline)
      const lineWithNewline = line + '\n';
      const lineTokens = enc.encode(lineWithNewline).length;

      // If a single line exceeds maxTokens, it goes in its own batch
      if (lineTokens > maxTokens) {
        // Flush current batch if not empty
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentTokenCount = 0;
        }
        // Add the oversized line as its own batch
        batches.push([line]);
        continue;
      }

      // Check if adding this line would exceed the limit
      if (currentTokenCount + lineTokens > maxTokens && currentBatch.length > 0) {
        // Flush current batch
        batches.push(currentBatch);
        currentBatch = [];
        currentTokenCount = 0;
      }

      // Add line to current batch
      currentBatch.push(line);
      currentTokenCount += lineTokens;
    }

    // Don't forget the last batch
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  } finally {
    enc.free();
  }
}
