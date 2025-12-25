/**
 * AI Tools - MCP server for AI-powered JSVMP detection
 * 
 * This package provides an MCP server with LLM-driven functionality for code analysis,
 * including JSVMP (JavaScript Virtual Machine Protection) detection.
 * 
 * Run as MCP server: npx @reverse-craft/ai-tools
 * 
 * @packageDocumentation
 */

// LLM Configuration
export {
  type LLMConfig,
  type LLMClient,
  getLLMConfig,
  isLLMConfigured,
  createLLMClient,
} from './llmConfig.js';

// JSVMP Detector
export {
  type FormattedCode,
  type DetectionType,
  type ConfidenceLevel,
  type DetectionRegion,
  type DetectionResult,
  type JsvmpDetectionOptions,
  type JsvmpDetectionResult,
  formatCodeForAnalysis,
  parseDetectionResult,
  findJsvmpDispatcher,
} from './jsvmpDetector.js';

// MCP Tool Definitions
export { tools } from './tools/index.js';
export { findJsvmpDispatcherTool, FindJsvmpDispatcherInputSchema } from './tools/findJsvmpDispatcherTool.js';
export { ToolDefinition, defineTool } from './tools/ToolDefinition.js';
