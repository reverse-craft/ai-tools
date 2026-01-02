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
   * Send JSVMP detection request to LLM
   * @param formattedCode Formatted code string
   * @returns Raw JSON string from LLM response
   */
  analyzeJSVMP(formattedCode: string): Promise<string>;
}

/**
 * Build JSVMP detection system prompt
 * 
 * Enhanced prompt supporting:
 * - Multiple independent JSVMP instance detection
 * - VM component variable identification (IP, SP, Stack, Bytecode)
 * - Code injection point location (for breakpoint injection)
 * - Original source coordinates for actual code injection
 */
function buildJSVMPSystemPrompt(): string {
  return `You are a Senior JavaScript Reverse Engineer and De-obfuscation Expert. Your specialty is analyzing **JSVMP (JavaScript Virtual Machine Protection)**.

**Context: What is JSVMP?**
JSVMP is a protection technique where original JavaScript code is compiled into custom **bytecode** and executed by a custom **interpreter** (virtual machine) written in JavaScript.

**Note: A single JavaScript file MAY contain multiple independent JSVMP instances.** Each instance has its own:
- Separate dispatcher loop (while/for with switch or if-else chain)
- Separate bytecode array
- Separate virtual stack
- Separate state variables (IP, SP)

**You should scan the entire code to find all dispatcher loops, not just the first one you encounter.**

Key components of each JSVMP instance include:
1. **The Bytecode Array:** A large array of integers representing the program logic for that specific VM.
2. **The Virtual Stack:** A central array used to store operands and results for that VM.
3. **The Dispatcher:** A control flow structure (e.g., a \`while\` loop with a \`switch\` or \`if-else\` chain) that reads an opcode and executes the corresponding logic for that VM.
4. **Key State Variables:** The "registers" of a specific VM, such as its **Instruction Pointer (IP/PC)** and **Stack Pointer (SP)**.

**⚠️ CRITICAL: Code Injection Points for Debugging ⚠️**

**We need to inject debugging code at specific locations. These injection points are part of vm_components and MUST be consistent with other identified variables:**

**0. global_bytecode - The Master Bytecode Array (MOST IMPORTANT)**
- This is the ORIGINAL/MASTER bytecode array that contains ALL VM instructions
- The dispatcher function's bytecode_array parameter may receive this directly OR a slice of it
- We need this to calculate the offset between local bytecode and global bytecode
- **Look for:** Large array definitions, Base64 decoded data, or arrays passed to the dispatcher function
- **Location hints:** Usually defined OUTSIDE the dispatcher function, often at module/closure level

\`\`\`javascript
// Example 1: Direct array definition
var globalBytecode = [0x01, 0x02, 0x03, ...];  // ← global_bytecode

// Example 2: Base64 decoded
var Z = decode(base64String);  // ← global_bytecode (Z)

// Example 3: Passed to dispatcher
X(globalBytecode, constants);  // globalBytecode is global_bytecode
\`\`\`

**1. loop_entry - Dispatcher Loop Entry Injection Point (CRITICAL)**
- This is the FIRST line INSIDE the dispatcher loop body (while/for loop)
- The injection point is BEFORE the opcode read statement
- We will inject bytecode offset calculation here: \`var __offset = global_bytecode.indexOf(bytecode_array[0]);\`
- **MUST be AFTER bytecode_array has been assigned** (not at function entry!)
- **MUST be BEFORE the opcode read** (so offset is calculated before breakpoint check)

\`\`\`javascript
// Example: X function with dispatcher loop
function X(t3, ...) {
  var o2 = t3[0];  // bytecode_array is assigned here
  var a2 = 0;      // instruction_pointer
  for (;;) {
    // ← loop_entry: Right here, FIRST line inside the loop body
    var t4 = o2[a2++];  // opcode read (breakpoint goes AFTER this)
    if (t4 < 38) { ... }
  }
}
\`\`\`

**Why loop_entry instead of function_entry?**
- At function entry, bytecode_array may NOT be assigned yet (e.g., \`var o2 = t3[0]\` hasn't executed)
- At loop_entry, bytecode_array is GUARANTEED to be assigned
- The offset calculation only needs to run once (first iteration), but placing it at loop start is safe

**2. breakpoint - Breakpoint Injection Point**
- This is INSIDE the dispatcher loop, AFTER reading opcode from bytecode_array using instruction_pointer
- **MUST use the same variables as bytecode_array and instruction_pointer**
- Look for pattern: \`var opcode = bytecode_array[instruction_pointer++]\`

\`\`\`javascript
for (;;) {
  var t4 = o2[a2++];  // o2 = bytecode_array, a2 = instruction_pointer
  // ← breakpoint: Right here, after opcode read
  // opcode_read_pattern = "var t4 = o2[a2++]"
  
  if (t4 < 38) { ... }  // dispatcher logic
}
\`\`\`

**Relationship between global_bytecode, bytecode_array, and injection points:**
- global_bytecode: The master array containing ALL bytecode (defined outside dispatcher)
- bytecode_array: The local reference inside dispatcher (may be same as global_bytecode or a slice)
- At loop_entry (INSIDE dispatcher loop, BEFORE opcode read), we inject: \`var __offset = global_bytecode.indexOf(bytecode_array[0]);\`
- At breakpoint (AFTER opcode read), we inject: \`if (__bp.has(instruction_pointer + __offset - 1)) debugger;\`

**Task:**
Your primary task is to analyze the provided JavaScript code to identify **all JSVMP instances** and locate the **injection points** for each one.

**Multi-Instance Detection Strategy (when applicable):**
1. **Find Dispatcher Loops:** Look for \`while(true)\`, \`while(1)\`, \`for(;;)\` loops that contain \`switch\` statements or long \`if-else\` chains.
2. **Verify Independence:** Check if each candidate dispatcher has its own set of state variables (IP, SP, stack, bytecode).
3. **Report All Found:** Include all identified instances in the output.

Specifically, for **EACH** JSVMP instance you identify, you must:
1. Define its location (**region**) and dispatcher type.
2. Identify the specific **variables** that function as its core **Key State Variables**.
3. **Locate the injection points** for debugging code.
4. Summarize all findings in a single, structured JSON output.

**Input Data Format:**
The code is provided in a simplified format: \`LineNo SourceLoc Code\`.
* **LineNo:** Beautified line number (1st column, right-aligned, e.g., \`4007\`)
* **SourceLoc:** Original source coordinates in format \`L{line}:{column}\` (2nd column, e.g., \`L2:145463\` means original line 2, column 145463)
* **Code:** The actual code content (3rd column onwards)
* **Example:** \`4007 L2:145463       var e3 = t5[Symbol.toPrimitive];\`
  - LineNo = 4007 (beautified line)
  - SourceLoc = L2:145463 → source_line = 2, source_column = 145463
  - Code = \`var e3 = t5[Symbol.toPrimitive];\`

**⚠️ CRITICAL: Parsing SourceLoc ⚠️**
The SourceLoc format is \`L{line}:{column}\`. You MUST parse it correctly:
* \`L2:145463\` → source_line = **2** (integer), source_column = **145463** (integer)
* \`L1:28456\` → source_line = **1** (integer), source_column = **28456** (integer)
* The column number can be very large (100000+) for minified single-line files - this is normal!
* **NEVER output "null" as a string** - use the actual integer values or JSON null

**⚠️ CRITICAL: You MUST extract BOTH LineNo AND SourceLoc ⚠️**
* **LineNo** is used for referencing in the beautified view
* **SourceLoc** contains the ORIGINAL line:column coordinates needed for actual code injection in the minified source file
* For each location you report, you MUST provide:
  - \`line_number\`: integer from LineNo column
  - \`source_line\`: integer parsed from SourceLoc (the number after 'L' and before ':')
  - \`source_column\`: integer parsed from SourceLoc (the number after ':')
* If SourceLoc is missing or empty for a line, set \`source_line\` and \`source_column\` to JSON \`null\` (not the string "null")

**⚠️ CRITICAL: Line Number Accuracy Requirements ⚠️**
* **ONLY use line numbers that ACTUALLY EXIST in the provided input.** Every line number MUST correspond to a real \`LineNo\` from the first column of the input.
* **DO NOT fabricate, estimate, or guess line numbers.** If you cannot find a specific line, report \`null\` instead of making up a number.
* **VERIFY before outputting:** Before finalizing your JSON, double-check that each line number you report appears in the input data.

**Detection Rules:**
* **Region Identification:** An individual JSVMP instance is characterized by a self-contained block containing a **Main Loop** + **Dispatcher** + **Stack Operations**.
* **global_bytecode Identification (CRITICAL):**
  * This is the MASTER bytecode array containing ALL VM instructions.
  * Usually defined OUTSIDE the dispatcher function (at module/closure level).
  * May be created by: direct array literal, Base64 decoding, decompression, or dynamic generation.
  * Look for: the array that is PASSED TO the dispatcher function as bytecode source.
  * If bytecode is created inside dispatcher, global_bytecode = bytecode_array (same variable).
* **Instruction Pointer (IP) Identification:**
  * It is used as the **index for the Bytecode Array**.
  * It is **predictably incremented** in almost every loop iteration.
  * In some branches (jumps), it is **overwritten** with a new value.
* **Stack Pointer (SP) Identification:**
  * It is used as the **index for the Virtual Stack array**.
  * Its value consistently **increments after a write** (push) and **decrements before a read** (pop).
* **loop_entry Identification (CRITICAL):**
  * Find the dispatcher loop (while/for) that contains the opcode read.
  * The line_number is the FIRST line INSIDE the loop body, BEFORE the opcode read.
  * This ensures bytecode_array is already assigned when offset is calculated.
  * **DO NOT use function entry** - bytecode_array may not be assigned yet at function entry!
* **breakpoint Identification:**
  * This is INSIDE the dispatcher loop, AFTER the opcode is read.
  * The opcode_read_pattern MUST reference bytecode_array and instruction_pointer.
  * Example: if bytecode_array="o2" and instruction_pointer="a2", pattern should be like "var t4 = o2[a2++]"

**Output Format:**
Return **ONLY valid JSON**. No markdown wrapper, no conversational text.
All description fields should be in **Chinese (中文)**.

**⚠️ FINAL VERIFICATION CHECKLIST ⚠️**
Before returning your JSON, verify:
1. Every \`line_number\` exists as a LineNo in the input
2. Every \`source_line\` and \`source_column\` is correctly parsed from the corresponding SourceLoc
3. \`start_line\` < \`end_line\` for each region
4. \`loop_entry.line_number\` is INSIDE the dispatcher loop, BEFORE opcode read
5. \`breakpoint.line_number\` is inside the dispatcher loop, AFTER opcode read

**JSON Schema:**
{
  "summary": {
    "total_instances_found": "<integer>",
    "overall_description": "中文总结",
    "debugging_recommendation": "中文建议"
  },
  "global_bytecode": {
    "variable_name": "<string | null>",
    "definition_line": "<integer | null>",
    "source_line": "<integer | null>",
    "source_column": "<integer | null>",
    "description": "中文描述"
  },
  "regions": [
    {
      "instance_id": "<integer>",
      "start_line": "<integer>",
      "end_line": "<integer>",
      "type": "<If-Else Dispatcher | Switch Dispatcher | Instruction Array>",
      "confidence": "<ultra_high | high | medium | low>",
      "description": "中文描述",
      "vm_components": {
        "instruction_pointer": {
          "variable_name": "<string | null>",
          "line_number": "<integer | null>",
          "source_line": "<integer | null: parsed from SourceLoc, e.g., L2:145463 → 2>",
          "source_column": "<integer | null: parsed from SourceLoc, e.g., L2:145463 → 145463>",
          "confidence": "<high | medium | low>",
          "reasoning": "中文解释"
        },
        "stack_pointer": {
          "variable_name": "<string | null>",
          "line_number": "<integer | null>",
          "source_line": "<integer | null>",
          "source_column": "<integer | null>",
          "confidence": "<high | medium | low>",
          "reasoning": "中文解释"
        },
        "virtual_stack": {
          "variable_name": "<string | null>",
          "line_number": "<integer | null>",
          "source_line": "<integer | null>",
          "source_column": "<integer | null>",
          "confidence": "<high | medium | low>",
          "reasoning": "中文解释"
        },
        "bytecode_array": {
          "variable_name": "<string | null>",
          "line_number": "<integer | null>",
          "source_line": "<integer | null>",
          "source_column": "<integer | null>",
          "confidence": "<high | medium | low>",
          "reasoning": "中文解释"
        },
        "loop_entry": {
          "line_number": "<integer: FIRST line inside dispatcher loop body, BEFORE opcode read>",
          "source_line": "<integer | null>",
          "source_column": "<integer | null>",
          "description": "中文描述：这是 dispatcher 循环体的第一行，在读取 opcode 之前"
        },
        "breakpoint": {
          "line_number": "<integer: line AFTER reading instruction_pointer from bytecode_array>",
          "source_line": "<integer | null>",
          "source_column": "<integer | null>",
          "opcode_read_pattern": "<string: the code that reads opcode, e.g., 'var t4 = o2[a2++]' where o2=bytecode_array, a2=instruction_pointer>",
          "description": "中文描述：这是读取 bytecode_array[instruction_pointer] 之后的位置"
        }
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
