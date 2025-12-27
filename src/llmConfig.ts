/**
 * LLM Configuration Module
 * Handles reading and validating LLM configuration from environment variables
 */

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

/**
 * Supported LLM providers
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google';

/**
 * Provider-specific default configurations
 */
export const PROVIDER_DEFAULTS: Record<LLMProvider, { model: string }> = {
  openai: { model: 'gpt-4o-mini' },
  anthropic: { model: 'claude-sonnet-4-20250514' },
  google: { model: 'gemini-2.0-flash' },
};

/**
 * Environment variable names for each provider
 */
export const PROVIDER_ENV_KEYS: Record<LLMProvider, { 
  apiKey: string; 
  model: string; 
  baseUrl: string;
}> = {
  openai: { 
    apiKey: 'OPENAI_API_KEY', 
    model: 'OPENAI_MODEL', 
    baseUrl: 'OPENAI_BASE_URL' 
  },
  anthropic: { 
    apiKey: 'ANTHROPIC_API_KEY', 
    model: 'ANTHROPIC_MODEL',
    baseUrl: 'ANTHROPIC_BASE_URL'
  },
  google: { 
    apiKey: 'GOOGLE_API_KEY', 
    model: 'GOOGLE_MODEL',
    baseUrl: 'GOOGLE_BASE_URL'
  },
};

/**
 * Extended LLM configuration with provider information
 */
export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;  // Custom base URL for all providers
}

/**
 * Validates provider string against valid values
 * @param value - The provider string to validate
 * @returns The validated LLMProvider or null if invalid
 */
export function validateProvider(value: string | undefined): LLMProvider | null {
  if (value === undefined) return null;
  if (value === 'openai' || value === 'anthropic' || value === 'google') {
    return value;
  }
  return null;
}

/**
 * 从环境变量读取 LLM 配置
 * @returns LLMConfig | null (null 表示未配置)
 */
export function getLLMConfig(): LLMConfig | null {
  // 1. Determine provider (default to 'openai')
  const providerEnv = process.env.LLM_PROVIDER?.toLowerCase();
  const provider = validateProvider(providerEnv);
  
  if (provider === null && providerEnv !== undefined) {
    // Invalid provider specified
    console.warn(`Invalid LLM_PROVIDER: ${providerEnv}. Valid values: openai, anthropic, google`);
    return null;
  }
  
  const effectiveProvider = provider ?? 'openai';
  
  // 2. Get provider-specific environment variable names
  const envKeys = PROVIDER_ENV_KEYS[effectiveProvider];
  
  // 3. Read API key (required)
  const apiKey = process.env[envKeys.apiKey];
  if (!apiKey) {
    return null;
  }
  
  // 4. Read model: LLM_MODEL > provider-specific > default
  const model = process.env.LLM_MODEL 
    || process.env[envKeys.model] 
    || PROVIDER_DEFAULTS[effectiveProvider].model;
  
  // 5. Read base URL: LLM_BASE_URL > provider-specific > undefined
  const baseUrl = process.env.LLM_BASE_URL || process.env[envKeys.baseUrl];
  
  return {
    provider: effectiveProvider,
    apiKey,
    model,
    baseUrl,
  };
}

/**
 * 检查 LLM 是否已配置
 */
export function isLLMConfigured(): boolean {
  return getLLMConfig() !== null;
}

/**
 * LLM Client Interface
 */
export interface LLMClient {
  /**
   * 发送 JSVMP 检测请求到 LLM
   * @param formattedCode 格式化后的代码
   * @returns LLM 返回的原始 JSON 字符串
   */
  analyzeJSVMP(formattedCode: string): Promise<string>;
}

/**
 * 构建 JSVMP 检测系统提示词
 */
function buildJSVMPSystemPrompt(): string {
  return `You are a Senior JavaScript Reverse Engineer and De-obfuscation Expert. Your specialty is analyzing **JSVMP (JavaScript Virtual Machine Protection)**.

**Context: What is JSVMP?**
JSVMP is a protection technique where original JavaScript code is compiled into custom **bytecode** and executed by a custom **interpreter** (virtual machine) written in JavaScript.

Key components of JSVMP code include:
1. **The Virtual Stack:** A central array used to store operands and results (e.g., \`stack[pointer++]\` or \`v[p--]\`).
2. **The Dispatcher:** A control flow structure inside a loop that decides which instruction to execute next based on the current bytecode (opcode).
   * *Common variants:* A massive \`switch\` statement, a deeply nested \`if-else\` chain (binary search style), or a function array mapping (\`handlers[opcode]()\`).
3. **The Bytecode:** A large string or array of integers representing the program logic.

**Task:**
Analyze the provided JavaScript code snippet to identify regions that match JSVMP structural patterns.

**Input Data Format:**
The code is provided in a simplified format: \`LineNo SourceLoc Code\`.
* **Example:** \`10 L234:56 var x = stack[p++];\`
* **Instruction:** Focus on the **LineNo** (1st column) and **Code** (3rd column onwards). Ignore the \`SourceLoc\` (middle column).

**Detection Rules & Confidence Levels:**
Please assign confidence based on the following criteria:

* **Ultra High:**
  * A combination of a **Main Loop** + **Dispatcher** + **Stack Operations** appears in the same block.
  * *Example:* A \`while(true)\` loop containing a huge \`if-else\` chain where branches perform \`stack[p++]\` operations.

* **High:**
  * Distinct **Dispatcher** structures found (e.g., a \`switch\` with >20 cases, or an \`if-else\` chain nested >10 levels deep checking integer values).
  * Large arrays containing only function definitions (Instruction Handlers).

* **Medium:**
  * Isolated **Stack Operations** (e.g., \`v2[p2] = v2[p2 - 1]\`) without visible dispatchers nearby.
  * Suspicious \`while\` loops iterating over a string/array.

* **Low:**
  * Generic obfuscation patterns (short variable names, comma operators) that *might* be part of a VM but lack specific structural proof.

**Output Format:**
Return **ONLY valid JSON**. No markdown wrapper, no conversational text.

**JSON Schema:**
{
  "summary": "Brief analysis of the code structure in chinese, shortly",
  "regions": [
    {
      "start": <start_line>,
      "end": <end_line>,
      "type": "<If-Else Dispatcher | Switch Dispatcher | Instruction Array | Stack Operation>",
      "confidence": "<ultra_high | high | medium | low>",
      "description": "<Why you flagged this. Mention specific variables like 'v2', 'p2' or structures. in chinese, shortly>"
    }
  ]
}`;
}

/**
 * Creates a provider-specific model instance using the AI SDK
 * @param config - The LLM configuration
 * @returns A LanguageModel instance for the configured provider
 */
export function createProviderModel(config: LLMConfig): LanguageModel {
  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return openai(config.model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return anthropic(config.model);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return google(config.model);
    }
  }
}

/**
 * 创建 LLM 客户端实例
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  const model = createProviderModel(config);
  
  return {
    async analyzeJSVMP(formattedCode: string): Promise<string> {
      const systemPrompt = buildJSVMPSystemPrompt();
      
      try {
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt: `请分析以下代码，识别 JSVMP 保护结构：\n\n${formattedCode}`,
          temperature: 0.1,
        });
        
        return result.text;
      } catch (error) {
        const providerName = config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
        if (error instanceof Error) {
          throw new Error(`${providerName} LLM 请求失败: ${error.message}`);
        }
        throw new Error(`${providerName} LLM 请求失败: ${String(error)}`);
      }
    }
  };
}
