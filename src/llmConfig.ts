/**
 * LLM Configuration Module
 * Handles reading and validating LLM configuration from environment variables
 */

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 从环境变量读取 LLM 配置
 * @returns LLMConfig | null (null 表示未配置)
 */
export function getLLMConfig(): LLMConfig | null {
  const apiKey = process.env.OPENAI_API_KEY;
  
  // API Key is required
  if (!apiKey) {
    return null;
  }
  
  // Use defaults for optional configuration
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  
  return {
    apiKey,
    baseUrl,
    model
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
 * 创建 LLM 客户端实例
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  return {
    async analyzeJSVMP(formattedCode: string): Promise<string> {
      const systemPrompt = buildJSVMPSystemPrompt();
      
      const requestBody = {
        model: config.model,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `请分析以下代码，识别 JSVMP 保护结构：\n\n${formattedCode}`
          }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      };
      
      try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.apiKey}`
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API 请求失败 (${response.status}): ${errorText}`);
        }
        
        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
          throw new Error("API 响应格式无效：缺少 choices 或 message 字段");
        }
        
        const content = data.choices[0].message.content;
        
        if (typeof content !== "string") {
          throw new Error("API 响应格式无效：message.content 不是字符串");
        }
        
        return content;
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`LLM 请求失败: ${error.message}`);
        }
        throw new Error(`LLM 请求失败: ${String(error)}`);
      }
    }
  };
}
