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
  | "Instruction Array";

/**
 * Confidence level for detection results
 */
export type ConfidenceLevel = "ultra_high" | "high" | "medium" | "low";

/**
 * VM Component variable identification with source coordinates
 */
export interface VMComponentVariable {
  variable_name: string | null;
  line_number: number | null;
  source_line: number | null;
  source_column: number | null;
  confidence: ConfidenceLevel;
  reasoning: string;
}

/**
 * Loop entry injection point for bytecode offset calculation
 * This is INSIDE the dispatcher loop, BEFORE the opcode read
 */
export interface LoopEntryInjection {
  line_number: number;
  source_line: number | null;
  source_column: number | null;
  description: string;
}

/**
 * Breakpoint injection point inside dispatcher loop
 */
export interface BreakpointInjection {
  line_number: number;
  source_line: number | null;
  source_column: number | null;
  opcode_read_pattern: string | null;
  description: string;
}

/**
 * VM Components for a JSVMP instance (includes injection points)
 */
export interface VMComponents {
  instruction_pointer: VMComponentVariable;
  stack_pointer: VMComponentVariable;
  virtual_stack: VMComponentVariable;
  bytecode_array: VMComponentVariable;
  loop_entry?: LoopEntryInjection;
  breakpoint?: BreakpointInjection;
}

/**
 * Global bytecode information
 */
export interface GlobalBytecodeInfo {
  variable_name: string | null;
  definition_line: number | null;
  source_line: number | null;
  source_column: number | null;
  pattern_type?: '2d_array' | '1d_slice' | 'unknown';
  local_bytecode_var?: string | null;
  transform_expression?: string | null;
  structure_description?: string | null;
  description: string;
}

/**
 * Debugging entry point information (legacy, kept for compatibility)
 */
export interface DebuggingEntryPoint {
  line_number: number;
  description: string;
}

/**
 * A detected region in the code (enhanced with VM components)
 */
export interface DetectionRegion {
  start: number;           // 起始行号 (start_line)
  end: number;             // 结束行号 (end_line)
  type: DetectionType;     // 检测类型
  confidence: ConfidenceLevel;  // 置信度
  description: string;     // 描述（中文）
  vm_components?: VMComponents;  // VM 组件变量识别 (包含注入点)
  debugging_entry_point?: DebuggingEntryPoint;  // 调试入口点 (legacy)
}

/**
 * Summary information for detection result
 */
export interface DetectionSummary {
  overall_description: string;      // 总体描述
  debugging_recommendation: string; // 调试建议
}

/**
 * Complete detection result from LLM analysis (enhanced)
 */
export interface DetectionResult {
  summary: string | DetectionSummary;  // 分析摘要（支持新旧格式）
  global_bytecode?: GlobalBytecodeInfo;  // 全局字节码信息
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
  "Instruction Array"
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
 * Parse VM component variable from LLM response
 */
function parseVMComponentVariable(obj: Record<string, unknown>, fieldName: string): VMComponentVariable | null {
  const component = obj[fieldName] as Record<string, unknown> | undefined;
  if (!component || typeof component !== 'object') {
    return null;
  }
  
  const variableName = component.variable_name;
  const lineNumber = component.line_number;
  const sourceLine = component.source_line;
  const sourceColumn = component.source_column;
  const confidence = component.confidence;
  const reasoning = component.reasoning;
  
  if (typeof confidence !== 'string' || !isValidConfidenceLevel(confidence)) {
    return null;
  }
  
  return {
    variable_name: typeof variableName === 'string' ? variableName : null,
    line_number: typeof lineNumber === 'number' ? lineNumber : null,
    source_line: typeof sourceLine === 'number' ? sourceLine : null,
    source_column: typeof sourceColumn === 'number' ? sourceColumn : null,
    confidence,
    reasoning: typeof reasoning === 'string' ? reasoning : '',
  };
}

/**
 * Parse VM components from LLM response (includes injection points)
 */
function parseVMComponents(obj: Record<string, unknown>): VMComponents | undefined {
  const vmComponents = obj.vm_components as Record<string, unknown> | undefined;
  if (!vmComponents || typeof vmComponents !== 'object') {
    return undefined;
  }
  
  const ip = parseVMComponentVariable(vmComponents, 'instruction_pointer');
  const sp = parseVMComponentVariable(vmComponents, 'stack_pointer');
  const stack = parseVMComponentVariable(vmComponents, 'virtual_stack');
  const bytecode = parseVMComponentVariable(vmComponents, 'bytecode_array');
  
  // Parse loop_entry (now inside vm_components)
  let loopEntry: LoopEntryInjection | undefined;
  const le = vmComponents.loop_entry as Record<string, unknown> | undefined;
  if (le && typeof le === 'object') {
    const lineNumber = le.line_number;
    if (typeof lineNumber === 'number') {
      loopEntry = {
        line_number: lineNumber,
        source_line: typeof le.source_line === 'number' ? le.source_line : null,
        source_column: typeof le.source_column === 'number' ? le.source_column : null,
        description: typeof le.description === 'string' ? le.description : '',
      };
    }
  }
  
  // Parse breakpoint (now inside vm_components)
  let breakpointInjection: BreakpointInjection | undefined;
  const bp = vmComponents.breakpoint as Record<string, unknown> | undefined;
  if (bp && typeof bp === 'object') {
    const lineNumber = bp.line_number;
    if (typeof lineNumber === 'number') {
      breakpointInjection = {
        line_number: lineNumber,
        source_line: typeof bp.source_line === 'number' ? bp.source_line : null,
        source_column: typeof bp.source_column === 'number' ? bp.source_column : null,
        opcode_read_pattern: typeof bp.opcode_read_pattern === 'string' ? bp.opcode_read_pattern : null,
        description: typeof bp.description === 'string' ? bp.description : '',
      };
    }
  }
  
  // Only return if at least one component is identified
  if (!ip && !sp && !stack && !bytecode) {
    return undefined;
  }
  
  return {
    instruction_pointer: ip ?? { variable_name: null, line_number: null, source_line: null, source_column: null, confidence: 'low', reasoning: '' },
    stack_pointer: sp ?? { variable_name: null, line_number: null, source_line: null, source_column: null, confidence: 'low', reasoning: '' },
    virtual_stack: stack ?? { variable_name: null, line_number: null, source_line: null, source_column: null, confidence: 'low', reasoning: '' },
    bytecode_array: bytecode ?? { variable_name: null, line_number: null, source_line: null, source_column: null, confidence: 'low', reasoning: '' },
    ...(loopEntry && { loop_entry: loopEntry }),
    ...(breakpointInjection && { breakpoint: breakpointInjection }),
  };
}

/**
 * Parse debugging entry point from LLM response
 */
function parseDebuggingEntryPoint(obj: Record<string, unknown>): DebuggingEntryPoint | undefined {
  const entryPoint = obj.debugging_entry_point as Record<string, unknown> | undefined;
  if (!entryPoint || typeof entryPoint !== 'object') {
    return undefined;
  }
  
  const lineNumber = entryPoint.line_number;
  const description = entryPoint.description;
  
  if (typeof lineNumber !== 'number') {
    return undefined;
  }
  
  return {
    line_number: lineNumber,
    description: typeof description === 'string' ? description : '',
  };
}

/**
 * Parse global bytecode info from LLM response
 */
function parseGlobalBytecode(obj: Record<string, unknown>): GlobalBytecodeInfo | undefined {
  const globalBytecode = obj.global_bytecode as Record<string, unknown> | undefined;
  if (!globalBytecode || typeof globalBytecode !== 'object') {
    return undefined;
  }
  
  return {
    variable_name: typeof globalBytecode.variable_name === 'string' ? globalBytecode.variable_name : null,
    definition_line: typeof globalBytecode.definition_line === 'number' ? globalBytecode.definition_line : null,
    source_line: typeof globalBytecode.source_line === 'number' ? globalBytecode.source_line : null,
    source_column: typeof globalBytecode.source_column === 'number' ? globalBytecode.source_column : null,
    description: typeof globalBytecode.description === 'string' ? globalBytecode.description : '',
  };
}

/**
 * Parse and validate LLM detection result from JSON string
 * 
 * Validates:
 * - JSON is parseable
 * - Required fields exist: summary, regions
 * - Each region has required fields: start/start_line, end/end_line, type, confidence, description
 * - Enum values are valid
 * - Supports both old and new JSON formats
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

  // Parse summary (support both old string format and new object format)
  let summary: string | DetectionSummary;
  if (typeof obj.summary === 'string') {
    summary = obj.summary;
  } else if (typeof obj.summary === 'object' && obj.summary !== null) {
    const summaryObj = obj.summary as Record<string, unknown>;
    if (typeof summaryObj.overall_description !== 'string' || typeof summaryObj.debugging_recommendation !== 'string') {
      throw new Error('LLM 响应格式无效，summary 对象缺少必需字段');
    }
    summary = {
      overall_description: summaryObj.overall_description,
      debugging_recommendation: summaryObj.debugging_recommendation,
    };
  } else {
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

    // Support both old (start/end) and new (start_line/end_line) field names
    const startLine = region.start_line ?? region.start;
    const endLine = region.end_line ?? region.end;

    // Validate required fields exist and have correct types
    if (typeof startLine !== 'number') {
      throw new Error(`LLM 响应格式无效，regions[${i}] 缺少必需字段: start_line 或 start`);
    }

    if (typeof endLine !== 'number') {
      throw new Error(`LLM 响应格式无效，regions[${i}] 缺少必需字段: end_line 或 end`);
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

    // Parse optional VM components (now includes injection points) and debugging entry point
    const vmComponents = parseVMComponents(region);
    const debuggingEntryPoint = parseDebuggingEntryPoint(region);

    validatedRegions.push({
      start: startLine,
      end: endLine,
      type: region.type,
      confidence: region.confidence,
      description: region.description,
      ...(vmComponents && { vm_components: vmComponents }),
      ...(debuggingEntryPoint && { debugging_entry_point: debuggingEntryPoint }),
    });
  }

  // Parse global bytecode info
  const globalBytecode = parseGlobalBytecode(obj);

  return {
    summary,
    ...(globalBytecode && { global_bytecode: globalBytecode }),
    regions: validatedRegions,
  };
}

/**
 * Format source location as "L{line}:{column}" or empty string
 */
function formatSourceLoc(sourceLine: number | null, sourceColumn: number | null): string {
  if (sourceLine !== null && sourceColumn !== null) {
    return ` [Src L${sourceLine}:${sourceColumn}]`;
  }
  return '';
}

/**
 * Format detection result for display (enhanced with injection points and source coordinates)
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
  
  // Format summary (support both old string format and new object format)
  if (typeof result.summary === 'string') {
    lines.push(`Summary: ${result.summary}`);
  } else {
    lines.push(`Summary: ${result.summary.overall_description}`);
    lines.push(`Recommendation: ${result.summary.debugging_recommendation}`);
  }
  lines.push('');
  
  // Format global bytecode info if available
  if (result.global_bytecode) {
    const gb = result.global_bytecode;
    lines.push('Global Bytecode:');
    if (gb.variable_name) {
      const srcLoc = formatSourceLoc(gb.source_line, gb.source_column);
      lines.push(`  Variable: ${gb.variable_name} (line ${gb.definition_line})${srcLoc}`);
    }
    if (gb.pattern_type) {
      lines.push(`  Pattern: ${gb.pattern_type}`);
    }
    if (gb.local_bytecode_var) {
      lines.push(`  Local Bytecode Var: ${gb.local_bytecode_var}`);
    }
    if (gb.transform_expression) {
      lines.push(`  Transform: ${gb.transform_expression}`);
    }
    if (gb.structure_description) {
      lines.push(`  Structure: ${gb.structure_description}`);
    }
    if (gb.description) {
      lines.push(`  ${gb.description}`);
    }
    lines.push('');
  }
  
  if (result.regions.length > 0) {
    lines.push(`Detected Regions (${result.regions.length} JSVMP instance${result.regions.length > 1 ? 's' : ''}):`);
    lines.push('');
    
    for (let i = 0; i < result.regions.length; i++) {
      const region = result.regions[i];
      lines.push(`--- Instance ${i + 1} ---`);
      lines.push(`[${region.confidence}] Lines ${region.start}-${region.end}: ${region.type}`);
      lines.push(`  ${region.description}`);
      
      // Format VM components if available
      if (region.vm_components) {
        lines.push('  VM Components:');
        const { instruction_pointer, stack_pointer, virtual_stack, bytecode_array } = region.vm_components;
        
        if (instruction_pointer.variable_name) {
          const srcLoc = formatSourceLoc(instruction_pointer.source_line, instruction_pointer.source_column);
          lines.push(`    - Instruction Pointer: ${instruction_pointer.variable_name} [${instruction_pointer.confidence}]${srcLoc}`);
          lines.push(`      ${instruction_pointer.reasoning}`);
        }
        if (stack_pointer.variable_name) {
          const srcLoc = formatSourceLoc(stack_pointer.source_line, stack_pointer.source_column);
          lines.push(`    - Stack Pointer: ${stack_pointer.variable_name} [${stack_pointer.confidence}]${srcLoc}`);
          lines.push(`      ${stack_pointer.reasoning}`);
        }
        if (virtual_stack.variable_name) {
          const srcLoc = formatSourceLoc(virtual_stack.source_line, virtual_stack.source_column);
          lines.push(`    - Virtual Stack: ${virtual_stack.variable_name} [${virtual_stack.confidence}]${srcLoc}`);
          lines.push(`      ${virtual_stack.reasoning}`);
        }
        if (bytecode_array.variable_name) {
          const srcLoc = formatSourceLoc(bytecode_array.source_line, bytecode_array.source_column);
          lines.push(`    - Bytecode Array: ${bytecode_array.variable_name} [${bytecode_array.confidence}]${srcLoc}`);
          lines.push(`      ${bytecode_array.reasoning}`);
        }
        
        // Format loop_entry (now inside vm_components)
        if (region.vm_components.loop_entry) {
          const le = region.vm_components.loop_entry;
          const srcLoc = formatSourceLoc(le.source_line, le.source_column);
          lines.push(`    - Loop Entry: Line ${le.line_number}${srcLoc}`);
          if (le.description) {
            lines.push(`      ${le.description}`);
          }
        }
        
        // Format breakpoint (now inside vm_components)
        if (region.vm_components.breakpoint) {
          const bp = region.vm_components.breakpoint;
          const srcLoc = formatSourceLoc(bp.source_line, bp.source_column);
          lines.push(`    - Breakpoint: Line ${bp.line_number}${srcLoc}`);
          if (bp.opcode_read_pattern) {
            lines.push(`      Opcode Read: ${bp.opcode_read_pattern}`);
          }
          if (bp.description) {
            lines.push(`      ${bp.description}`);
          }
        }
      }
      
      // Format debugging entry point if available (legacy)
      if (region.debugging_entry_point && !region.vm_components?.breakpoint) {
        lines.push(`  Debugging Entry Point: Line ${region.debugging_entry_point.line_number}`);
        lines.push(`    ${region.debugging_entry_point.description}`);
      }
      
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
 * - Merges global_bytecode info (keeps first non-null)
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
    return { 
      summary: results[0].summary, 
      global_bytecode: results[0].global_bytecode,
      regions: sortedRegions 
    };
  }
  
  // Combine summaries (handle both string and object formats)
  const summaryParts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const summary = results[i].summary;
    if (typeof summary === 'string') {
      summaryParts.push(`[Batch ${i + 1}] ${summary}`);
    } else {
      summaryParts.push(`[Batch ${i + 1}] ${summary.overall_description}`);
    }
  }
  
  // For merged results, create a combined summary object
  const lastSummary = results[results.length - 1].summary;
  const combinedSummary: DetectionSummary = {
    overall_description: summaryParts.join('\n'),
    debugging_recommendation: typeof lastSummary === 'string' 
      ? '请参考各批次的分析结果进行调试。'
      : lastSummary.debugging_recommendation,
  };
  
  // Merge global_bytecode (keep first non-null)
  let mergedGlobalBytecode: GlobalBytecodeInfo | undefined;
  for (const result of results) {
    if (result.global_bytecode && result.global_bytecode.variable_name) {
      mergedGlobalBytecode = result.global_bytecode;
      break;
    }
  }
  
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
    ...(mergedGlobalBytecode && { global_bytecode: mergedGlobalBytecode }),
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
