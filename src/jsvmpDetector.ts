/**
 * JSVMP Detector Module
 * AI-powered detection of JSVMP (JavaScript Virtual Machine Protection) patterns
 */

import { SourceMapConsumer } from 'source-map-js';
import { ensureBeautified, truncateCodeHighPerf } from '@reverse-craft/smart-fs';
import { existsSync } from 'fs';
import { getLLMConfig, createLLMClient } from './llmConfig.js';

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
  charLimit?: number;
}

/**
 * Result from findJsvmpDispatcher function
 */
export interface JsvmpDetectionResult {
  success: boolean;
  filePath: string;
  startLine: number;
  endLine: number;
  result?: DetectionResult;
  formattedOutput?: string;
  error?: string;
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
  startLine: number,
  endLine: number
): string {
  const lines: string[] = [];
  
  lines.push('=== JSVMP Dispatcher Detection Result ===');
  lines.push(`File: ${filePath} (${startLine}-${endLine})`);
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
 * Find JSVMP dispatcher patterns in JavaScript code using LLM analysis
 * 
 * @param filePath - Path to the JavaScript file to analyze
 * @param startLine - Start line number (1-based)
 * @param endLine - End line number (1-based)
 * @param options - Optional configuration
 * @returns JsvmpDetectionResult with detection results or error
 */
export async function findJsvmpDispatcher(
  filePath: string,
  startLine: number,
  endLine: number,
  options?: JsvmpDetectionOptions
): Promise<JsvmpDetectionResult> {
  const charLimit = options?.charLimit ?? 300;
  
  // Check LLM configuration
  const config = getLLMConfig();
  if (!config) {
    return {
      success: false,
      filePath,
      startLine,
      endLine,
      error: '未配置 LLM。请设置环境变量 OPENAI_API_KEY 以启用 JSVMP dispatcher 检测功能。'
    };
  }
  
  // Check file exists
  if (!existsSync(filePath)) {
    return {
      success: false,
      filePath,
      startLine,
      endLine,
      error: `文件不存在: ${filePath}`
    };
  }
  
  try {
    // Format code for analysis
    const formattedCode = await formatCodeForAnalysis(
      filePath,
      startLine,
      endLine,
      charLimit
    );
    
    // Create LLM client and analyze
    const client = createLLMClient(config);
    const llmResponse = await client.analyzeJSVMP(formattedCode.content);
    
    // Parse detection result
    const result = parseDetectionResult(llmResponse);
    
    // Format output
    const formattedOutput = formatDetectionResultOutput(result, filePath, startLine, endLine);
    
    return {
      success: true,
      filePath,
      startLine: formattedCode.startLine,
      endLine: formattedCode.endLine,
      result,
      formattedOutput
    };
    
  } catch (error) {
    return {
      success: false,
      filePath,
      startLine,
      endLine,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
