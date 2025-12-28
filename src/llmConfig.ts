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
  openai: { model: 'gpt-4.1-mini' },
  anthropic: { model: 'claude-haiku-4-5-20241022' },
  google: { model: 'gemini-2.5-flash-lite' },
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
 * 
 * 增强版提示词，支持：
 * - 多个独立 JSVMP 实例识别
 * - VM 组件变量识别（IP、SP、Stack、Bytecode）
 * - 调试入口点定位
 */
function buildJSVMPSystemPrompt(): string {
  return `You are a Senior JavaScript Reverse Engineer and De-obfuscation Expert. Your specialty is analyzing **JSVMP (JavaScript Virtual Machine Protection)**.

**Context: What is JSVMP?**
JSVMP is a protection technique where original JavaScript code is compiled into custom **bytecode** and executed by a custom **interpreter** (virtual machine) written in JavaScript. A single JavaScript file may contain **multiple, independent JSVMP instances**.

Key components of each JSVMP instance include:
1. **The Bytecode Array:** A large array of integers representing the program logic for that specific VM.
2. **The Virtual Stack:** A central array used to store operands and results for that VM.
3. **The Dispatcher:** A control flow structure (e.g., a \`while\` loop with a \`switch\` or \`if-else\` chain) that reads an opcode and executes the corresponding logic for that VM.
4. **Key State Variables:** The "registers" of a specific VM, such as its **Instruction Pointer (IP/PC)** and **Stack Pointer (SP)**.
5. **Debugging Entry Point:** The single most critical line number within a specific dispatcher loop to set a breakpoint for observing that VM's state.

**Task:**
Your primary task is to analyze the provided JavaScript code snippet to identify **all independent JSVMP instances** and produce a comprehensive report for each one. You are NOT creating or analyzing any Intermediate Representation (IR). Your goal is to provide the necessary information for a subsequent tool to analyze each VM instance separately and create its IR and mappings.

Specifically, for **EACH** JSVMP instance you identify, you must:
1. Define its location (**region**) and dispatcher type.
2. Identify the specific **variables** that function as its core **Key State Variables** (Instruction Pointer, Stack Pointer, Virtual Stack, and Bytecode Array).
3. Pinpoint the exact source code **line number** that serves as its optimal **Debugging Entry Point**.
4. Summarize all findings in a single, structured JSON output.

**Input Data Format:**
The code is provided in a simplified format: \`LineNo SourceLoc Code\`.
* **Example:** \`10 L234:56 var x = stack[p++];\`
* **Instruction:** Focus on the **LineNo** (1st column) and **Code** (3rd column onwards).

**Detection Rules:**
* **Region Identification:** An individual JSVMP instance is often characterized by a self-contained block containing a **Main Loop** + **Dispatcher** + **Stack Operations**.
* **Instruction Pointer (IP) Identification:**
  * It is used as the **index for the Bytecode Array of its VM instance**.
  * It is **predictably incremented** in almost every loop iteration.
  * In some branches (jumps), it is **overwritten** with a new value.
* **Stack Pointer (SP) Identification:**
  * It is used as the **index for the Virtual Stack array of its VM instance**.
  * Its value consistently **increments after a write** (push) and **decrements before a read** (pop).
* **Debugging Entry Point Identification:**
  * This is the line **inside a specific dispatcher loop** but **before its \`switch\` or \`if-else\` chain begins**. It is typically located right after the \`opcode\` is read from the bytecode array.

**Output Format:**
Return **ONLY valid JSON**. No markdown wrapper, no conversational text.

**JSON Schema:**
{
  "summary": {
    "overall_description": "对在文件中发现的JSVMP实例数量和类型的简要中文总结。",
    "debugging_recommendation": "为下一步分析提供的总体中文建议。例如：'已识别出 N 个独立的JSVMP实例。建议对每个实例分别在指定的"调试入口点"设置条件断点，并监控其各自的组件变量。'"
  },
  "regions": [
    {
      "start_line": "<start_line_integer>",
      "end_line": "<end_line_integer>",
      "type": "<If-Else Dispatcher | Switch Dispatcher | Instruction Array>",
      "confidence": "<ultra_high | high | medium | low>",
      "description": "对这个特定JSVMP实例的简要中文描述。",
      "vm_components": {
        "instruction_pointer": {
          "variable_name": "<identified_variable_name | null>",
          "confidence": "<high | medium | low>",
          "reasoning": "Why this variable is the IP for THIS VM instance. E.g., 'Used as index for bytecode array _0x123 within this region.'"
        },
        "stack_pointer": {
          "variable_name": "<identified_variable_name | null>",
          "confidence": "<high | medium | low>",
          "reasoning": "Why this variable is the SP for THIS VM instance. E.g., 'Used as index for stack array _0x456.'"
        },
        "virtual_stack": {
          "variable_name": "<identified_array_name | null>",
          "confidence": "<high | medium | low>",
          "reasoning": "Why this array is the stack for THIS VM instance. E.g., 'Frequently accessed using its stack_pointer _0x789.'"
        },
        "bytecode_array": {
          "variable_name": "<identified_array_name | null>",
          "confidence": "<high | medium | low>",
          "reasoning": "Why this array is the bytecode for THIS VM instance. E.g., 'A large, static array indexed by its instruction_pointer _0x123.'"
        }
      },
      "debugging_entry_point": {
        "line_number": "<line_number_integer>",
        "description": "The optimal breakpoint line for THIS VM instance. E.g., 'This line is after the opcode is fetched and before this region's switch statement.'"
      }
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
