/**
 * JSVMP Detector Module
 * AI-powered detection of JSVMP (JavaScript Virtual Machine Protection) patterns
 */

import { SourceMapConsumer } from 'source-map-js';
import { ensureBeautified, truncateCodeHighPerf } from '@reverse-craft/smart-fs';
import { existsSync } from 'fs';
import { getLLMConfig, createLLMClient, LLMClient } from './llmConfig.js';
import { countTokens, splitByTokenLimit } from './tokenizer.js';

/**
 * Formatted code result interface
 */
export interface FormattedCode {
  content: string;      // 格式化后的代码字符串
  totalLines: number;   // 总行数
  startLine: number;    // 实际起始行
  endLine: number;      // 实际结束行
}

/**
 * Detection type for JSVMP patterns
 */
export type DetectionType = 
  | "If-Else Dispatcher" 
  | "Switch Dispatcher" 
  | "Instruction Array" 
  | "Stack Operation";

/**
 * Confidence level for detection results
 */
export type ConfidenceLevel = "ultra_high" | "high" | "medium" | "low";

/**
 * A detected region in the code
 */
export interface DetectionRegion {
  start: number;           // 起始行号
  end: number;             // 结束行号
  type: DetectionType;     // 检测类型
  confidence: ConfidenceLevel;  // 置信度
  description: string;     // 描述（中文）
}

/**
 * Complete detection result from LLM analysis
 */
export interface DetectionResult {
  summary: string;         // 分析摘要（中文）
  regions: DetectionRegion[];
}

/**
 * Options for JSVMP detection
 */
export interface JsvmpDetectionOptions {
  charLimit?: number;           // Default: 300
  maxTokensPerBatch?: number;   // Default: 8000
}

/**
 * Result from findJsvmpDispatcher function
 */
export interface JsvmpDetectionResult {
  success: boolean;
  filePath: string;
  totalLines: number;
  batchCount: number;
  result?: DetectionResult;
  formattedOutput?: string;
  error?: string;
  partialErrors?: string[];     // Errors from failed batches
}

/**
 * Batch information for processing
 */
export interface BatchInfo {
  startLine: number;    // 批次起始行号 (1-based)
  endLine: number;      // 批次结束行号 (1-based)
  content: string;      // 格式化后的代码内容
  tokenCount: number;   // 该批次的 token 数量
}

/**
 * Result from formatEntireFile function
 */
export interface FormattedFileResult {
  lines: string[];      // 格式化后的代码行数组
  totalLines: number;   // 总行数
}

/**
 * Format source position as "L{line}:{column}" or empty placeholder
 */
function formatSourcePosition(line: number | null, column: number | null): string {
  if (line !== null && column !== null) {
    return `L${line}:${column}`;
  }
  return '';
}

/**
 * Format a single code line with line number, source coordinates, and content
 * Format: "LineNo SourceLoc Code"
 */
function formatCodeLine(lineNumber: number, sourcePos: string, code: string): string {
  const lineNumStr = String(lineNumber).padStart(5, ' ');
  const srcPosPadded = sourcePos ? sourcePos.padEnd(10, ' ') : '          ';
  return `${lineNumStr} ${srcPosPadded} ${code}`;
}

/**
 * 格式化代码为 LLM 分析格式
 * 格式: "LineNo SourceLoc Code"
 * 
 * 处理流程：
 * 1. 调用 ensureBeautified 美化代码
 * 2. 调用 truncateCodeHighPerf 截断长字符串
 * 3. 使用 SourceMapConsumer 获取原始坐标
 * 4. 格式化为 "LineNo SourceLoc Code" 格式
 * 
 * @param filePath - Path to the JavaScript file
 * @param startLine - Start line number (1-based)
 * @param endLine - End line number (1-based)
 * @param charLimit - Character limit for string truncation (default 300)
 * @returns FormattedCode object with formatted content and metadata
 */
export async function formatCodeForAnalysis(
  filePath: string,
  startLine: number,
  endLine: number,
  charLimit: number = 300
): Promise<FormattedCode> {
  // Step 1: Beautify the file and get source map
  const beautifyResult = await ensureBeautified(filePath);
  const { code, rawMap } = beautifyResult;

  // Step 2: Truncate long strings
  const truncatedCode = truncateCodeHighPerf(code, charLimit);

  // Split into lines
  const lines = truncatedCode.split('\n');
  const totalLines = lines.length;

  // Step 3: Adjust line range boundaries
  const effectiveStartLine = Math.max(1, Math.min(totalLines, startLine));
  const effectiveEndLine = Math.max(effectiveStartLine, Math.min(totalLines, endLine));

  // Step 4: Format each line with "LineNo SourceLoc Code" format
  const formattedLines: string[] = [];

  // Create source map consumer if available
  let consumer: SourceMapConsumer | null = null;
  if (rawMap && rawMap.sources && rawMap.names && rawMap.mappings) {
    consumer = new SourceMapConsumer({
      version: String(rawMap.version),
      sources: rawMap.sources,
      names: rawMap.names,
      mappings: rawMap.mappings,
      file: rawMap.file,
      sourceRoot: rawMap.sourceRoot,
    });
  }

  for (let lineNum = effectiveStartLine; lineNum <= effectiveEndLine; lineNum++) {
    const lineIndex = lineNum - 1;
    const lineContent = lines[lineIndex] ?? '';

    // Get original position from source map if available
    let sourcePos = '';
    if (consumer) {
      const originalPos = consumer.originalPositionFor({
        line: lineNum,
        column: 0,
      });
      sourcePos = formatSourcePosition(originalPos.line, originalPos.column);
    }
    
    formattedLines.push(formatCodeLine(lineNum, sourcePos, lineContent));
  }

  return {
    content: formattedLines.join('\n'),
    totalLines,
    startLine: effectiveStartLine,
    endLine: effectiveEndLine,
  };
}

/**
 * 格式化整个文件为 LLM 分析格式
 * 格式: "LineNo SourceLoc Code"
 * 
 * 处理流程：
 * 1. 调用 ensureBeautified 美化代码
 * 2. 调用 truncateCodeHighPerf 截断长字符串
 * 3. 使用 SourceMapConsumer 获取原始坐标
 * 4. 返回格式化后的行数组（保留原始行号）
 * 
 * @param filePath - Path to the JavaScript file
 * @param charLimit - Character limit for string truncation (default 300)
 * @returns FormattedFileResult with formatted lines array and metadata
 */
export async function formatEntireFile(
  filePath: string,
  charLimit: number = 300
): Promise<FormattedFileResult> {
  // Step 1: Beautify the file and get source map
  const beautifyResult = await ensureBeautified(filePath);
  const { code, rawMap } = beautifyResult;

  // Step 2: Truncate long strings
  const truncatedCode = truncateCodeHighPerf(code, charLimit);

  // Split into lines
  const codeLines = truncatedCode.split('\n');
  const totalLines = codeLines.length;

  // Step 3: Format each line with "LineNo SourceLoc Code" format
  const formattedLines: string[] = [];

  // Create source map consumer if available
  let consumer: SourceMapConsumer | null = null;
  if (rawMap && rawMap.sources && rawMap.names && rawMap.mappings) {
    consumer = new SourceMapConsumer({
      version: String(rawMap.version),
      sources: rawMap.sources,
      names: rawMap.names,
      mappings: rawMap.mappings,
      file: rawMap.file,
      sourceRoot: rawMap.sourceRoot,
    });
  }

  for (let lineNum = 1; lineNum <= totalLines; lineNum++) {
    const lineIndex = lineNum - 1;
    const lineContent = codeLines[lineIndex] ?? '';

    // Get original position from source map if available
    let sourcePos = '';
    if (consumer) {
      const originalPos = consumer.originalPositionFor({
        line: lineNum,
        column: 0,
      });
      sourcePos = formatSourcePosition(originalPos.line, originalPos.column);
    }
    
    formattedLines.push(formatCodeLine(lineNum, sourcePos, lineContent));
  }

  return {
    lines: formattedLines,
    totalLines,
  };
}

/**
 * Extract line number from a formatted code line
 * Format: "LineNo SourceLoc Code"
 * 
 * @param formattedLine - A formatted code line
 * @returns The line number (1-based)
 */
function extractLineNumber(formattedLine: string): number {
  const lineNumStr = formattedLine.substring(0, 5).trim();
  return parseInt(lineNumStr, 10);
}

/**
 * 创建批次用于分批处理
 * 使用 tokenizer 分割代码，记录每个批次的 startLine/endLine
 * 
 * @param formattedLines - 格式化后的代码行数组
 * @param maxTokensPerBatch - 每批次最大 token 数量
 * @returns BatchInfo 数组
 */
export function createBatches(
  formattedLines: string[],
  maxTokensPerBatch: number
): BatchInfo[] {
  if (formattedLines.length === 0) {
    return [];
  }

  // Split lines into batches based on token limit
  const lineBatches = splitByTokenLimit(formattedLines, maxTokensPerBatch);
  
  const batches: BatchInfo[] = [];
  
  for (const batchLines of lineBatches) {
    if (batchLines.length === 0) continue;
    
    // Extract start and end line numbers from formatted lines
    const startLine = extractLineNumber(batchLines[0]);
    const endLine = extractLineNumber(batchLines[batchLines.length - 1]);
    
    // Join lines to create batch content
    const content = batchLines.join('\n');
    
    // Calculate token count for this batch
    const tokenCount = countTokens(content);
    
    batches.push({
      startLine,
      endLine,
      content,
      tokenCount,
    });
  }
  
  return batches;
}

/**
 * Valid detection types for validation
 */
const VALID_DETECTION_TYPES: DetectionType[] = [
  "If-Else Dispatcher",
  "Switch Dispatcher",
  "Instruction Array",
  "Stack Operation"
];

/**
 * Valid confidence levels for validation
 */
const VALID_CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  "ultra_high",
  "high",
  "medium",
  "low"
];

/**
 * Check if a value is a valid DetectionType
 */
function isValidDetectionType(value: unknown): value is DetectionType {
  return VALID_DETECTION_TYPES.includes(value as DetectionType);
}

/**
 * Check if a value is a valid ConfidenceLevel
 */
function isValidConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return VALID_CONFIDENCE_LEVELS.includes(value as ConfidenceLevel);
}

/**
 * Parse and validate LLM detection result from JSON string
 * 
 * Validates:
 * - JSON is parseable
 * - Required fields exist: summary, regions
 * - Each region has required fields: start, end, type, confidence, description
 * - Enum values are valid
 * 
 * @param jsonString - JSON string from LLM response
 * @returns Parsed and validated DetectionResult
 * @throws Error if JSON is invalid or structure doesn't match expected format
 */
export function parseDetectionResult(jsonString: string): DetectionResult {
  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`无法解析 LLM 响应: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Validate required top-level fields
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM 响应格式无效，期望对象类型');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.summary !== 'string') {
    throw new Error('LLM 响应格式无效，缺少必需字段: summary');
  }

  if (!Array.isArray(obj.regions)) {
    throw new Error('LLM 响应格式无效，缺少必需字段: regions');
  }

  // Validate each region
  const validatedRegions: DetectionRegion[] = [];

  for (let i = 0; i < obj.regions.length; i++) {
    const region = obj.regions[i] as Record<string, unknown>;

    // Check region is an object
    if (typeof region !== 'object' || region === null) {
      throw new Error(`LLM 响应格式无效，regions[${i}] 不是对象`);
    }

    // Validate required fields exist and have correct types
    if (typeof region.start !== 'number') {
      throw new Error(`LLM 响应格式无效，regions[${i}] 缺少必需字段: start`);
    }

    if (typeof region.end !== 'number') {
      throw new Error(`LLM 响应格式无效，regions[${i}] 缺少必需字段: end`);
    }

    if (typeof region.type !== 'string') {
      throw new Error(`LLM 响应格式无效，regions[${i}] 缺少必需字段: type`);
    }

    if (typeof region.confidence !== 'string') {
      throw new Error(`LLM 响应格式无效，regions[${i}] 缺少必需字段: confidence`);
    }

    if (typeof region.description !== 'string') {
      throw new Error(`LLM 响应格式无效，regions[${i}] 缺少必需字段: description`);
    }

    // Validate enum values
    if (!isValidDetectionType(region.type)) {
      throw new Error(
        `LLM 响应格式无效，regions[${i}].type 值无效: "${region.type}". ` +
        `有效值: ${VALID_DETECTION_TYPES.join(', ')}`
      );
    }

    if (!isValidConfidenceLevel(region.confidence)) {
      throw new Error(
        `LLM 响应格式无效，regions[${i}].confidence 值无效: "${region.confidence}". ` +
        `有效值: ${VALID_CONFIDENCE_LEVELS.join(', ')}`
      );
    }

    validatedRegions.push({
      start: region.start,
      end: region.end,
      type: region.type,
      confidence: region.confidence,
      description: region.description,
    });
  }

  return {
    summary: obj.summary,
    regions: validatedRegions,
  };
}

/**
 * Format detection result for display
 */
function formatDetectionResultOutput(
  result: DetectionResult,
  filePath: string,
  totalLines: number,
  batchCount: number
): string {
  const lines: string[] = [];
  
  lines.push('=== JSVMP Dispatcher Detection Result ===');
  lines.push(`File: ${filePath} (${totalLines} lines, ${batchCount} batch${batchCount > 1 ? 'es' : ''})`);
  lines.push('');
  lines.push(`Summary: ${result.summary}`);
  lines.push('');
  
  if (result.regions.length > 0) {
    lines.push('Detected Regions:');
    for (const region of result.regions) {
      lines.push(`[${region.confidence}] Lines ${region.start}-${region.end}: ${region.type}`);
      lines.push(`  ${region.description}`);
      lines.push('');
    }
  } else {
    lines.push('No JSVMP dispatcher patterns detected.');
  }
  
  return lines.join('\n');
}

/**
 * Merge detection results from multiple batches
 * - Combines all regions from all batches
 * - Combines summaries from all batches
 * - Sorts regions by start line
 * - Deduplicates overlapping regions (keeps higher confidence)
 * 
 * @param results - Array of DetectionResult from each batch
 * @returns Merged DetectionResult
 */
export function mergeDetectionResults(results: DetectionResult[]): DetectionResult {
  if (results.length === 0) {
    return { summary: '', regions: [] };
  }
  
  if (results.length === 1) {
    // Still need to sort and deduplicate regions for single result
    const sortedRegions = [...results[0].regions].sort((a, b) => a.start - b.start);
    return { summary: results[0].summary, regions: sortedRegions };
  }
  
  // Combine summaries
  const summaries = results.map((r, i) => `[Batch ${i + 1}] ${r.summary}`);
  const combinedSummary = summaries.join('\n');
  
  // Collect all regions
  const allRegions: DetectionRegion[] = [];
  for (const result of results) {
    allRegions.push(...result.regions);
  }
  
  // Sort by start line
  allRegions.sort((a, b) => a.start - b.start);
  
  // Deduplicate overlapping regions (keep higher confidence)
  const confidenceOrder: Record<ConfidenceLevel, number> = {
    'ultra_high': 4,
    'high': 3,
    'medium': 2,
    'low': 1,
  };
  
  const deduplicatedRegions: DetectionRegion[] = [];
  for (const region of allRegions) {
    // Check if this region overlaps with any existing region
    let overlappingIndex = -1;
    for (let i = 0; i < deduplicatedRegions.length; i++) {
      const existing = deduplicatedRegions[i];
      // Check for overlap: regions overlap if one starts before the other ends
      if (region.start <= existing.end && region.end >= existing.start) {
        overlappingIndex = i;
        break;
      }
    }
    
    if (overlappingIndex === -1) {
      // No overlap, add the region
      deduplicatedRegions.push(region);
    } else {
      // Overlap found, keep the one with higher confidence
      const existing = deduplicatedRegions[overlappingIndex];
      if (confidenceOrder[region.confidence] > confidenceOrder[existing.confidence]) {
        deduplicatedRegions[overlappingIndex] = region;
      }
      // If equal confidence, keep the first one (existing)
    }
  }
  
  return {
    summary: combinedSummary,
    regions: deduplicatedRegions,
  };
}

/**
 * Process a single batch through LLM
 * 
 * @param client - LLM client
 * @param batch - Batch information
 * @returns DetectionResult from LLM analysis
 */
async function processBatch(
  client: LLMClient,
  batch: BatchInfo
): Promise<DetectionResult> {
  const llmResponse = await client.analyzeJSVMP(batch.content);
  return parseDetectionResult(llmResponse);
}

/**
 * Process batches with error handling
 * - Continues processing if some batches fail
 * - Collects partial results and error information
 * 
 * @param client - LLM client
 * @param batches - Array of BatchInfo
 * @returns Object with successful results and error messages
 */
export async function processBatchesWithErrorHandling(
  client: LLMClient,
  batches: BatchInfo[]
): Promise<{ results: DetectionResult[]; errors: string[] }> {
  const results: DetectionResult[] = [];
  const errors: string[] = [];
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const result = await processBatch(client, batch);
      results.push(result);
    } catch (error) {
      const errorMsg = `Batch ${i + 1} (lines ${batch.startLine}-${batch.endLine}) failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      errors.push(errorMsg);
    }
  }
  
  return { results, errors };
}

/**
 * Find JSVMP dispatcher patterns in JavaScript code using LLM analysis
 * 
 * @param filePath - Path to the JavaScript file to analyze
 * @param options - Optional configuration
 * @returns JsvmpDetectionResult with detection results or error
 */
export async function findJsvmpDispatcher(
  filePath: string,
  options?: JsvmpDetectionOptions
): Promise<JsvmpDetectionResult> {
  const charLimit = options?.charLimit ?? 300;
  const maxTokensPerBatch = options?.maxTokensPerBatch ?? 8000;
  
  // Check LLM configuration
  const config = getLLMConfig();
  if (!config) {
    return {
      success: false,
      filePath,
      totalLines: 0,
      batchCount: 0,
      error: '未配置 LLM。请设置环境变量 OPENAI_API_KEY 以启用 JSVMP dispatcher 检测功能。'
    };
  }
  
  // Check file exists
  if (!existsSync(filePath)) {
    return {
      success: false,
      filePath,
      totalLines: 0,
      batchCount: 0,
      error: `文件不存在: ${filePath}`
    };
  }
  
  try {
    // Format entire file for analysis
    const formattedCode = await formatEntireFile(filePath, charLimit);
    const totalLines = formattedCode.totalLines;
    
    // Create batches based on token limit
    const batches = createBatches(formattedCode.lines, maxTokensPerBatch);
    const batchCount = batches.length;
    
    // Create LLM client
    const client = createLLMClient(config);
    
    // Process batches with error handling
    const { results, errors } = await processBatchesWithErrorHandling(client, batches);
    
    // If all batches failed, return error
    if (results.length === 0) {
      return {
        success: false,
        filePath,
        totalLines,
        batchCount,
        error: `所有批次处理失败: ${errors.join('; ')}`,
        partialErrors: errors
      };
    }
    
    // Merge results from all successful batches
    const mergedResult = mergeDetectionResults(results);
    
    // Format output
    const formattedOutput = formatDetectionResultOutput(mergedResult, filePath, totalLines, batchCount);
    
    return {
      success: true,
      filePath,
      totalLines,
      batchCount,
      result: mergedResult,
      formattedOutput,
      partialErrors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    return {
      success: false,
      filePath,
      totalLines: 0,
      batchCount: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
