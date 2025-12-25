/**
 * AI Tools - AI-powered code analysis tools
 * 
 * This package provides LLM-driven functionality for code analysis,
 * including JSVMP (JavaScript Virtual Machine Protection) detection.
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
