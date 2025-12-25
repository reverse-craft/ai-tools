# @reverse-craft/ai-tools

MCP server for AI-powered JSVMP detection. Provides LLM-driven code analysis tools for identifying JavaScript Virtual Machine Protection patterns.

## Features

- **MCP Server** - Model Context Protocol server for AI assistant integration
- **JSVMP Detection** - Detect VM protection patterns using LLM analysis
- **Multiple Pattern Types** - Identifies dispatchers, instruction arrays, stack operations
- **Confidence Levels** - Results include ultra_high, high, medium, low confidence ratings

## Installation

```bash
npm install @reverse-craft/ai-tools
```

## Configuration

Set environment variables for LLM access:

```bash
# Required
export OPENAI_API_KEY=your-api-key

# Optional (defaults shown)
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-4o-mini
```

## MCP Server Usage

### Running the Server

```bash
# Via npx
npx @reverse-craft/ai-tools

# Or if installed globally
ai-tools-mcp
```

### MCP Configuration

Add to your MCP client configuration (e.g., Claude Desktop, Kiro):

```json
{
  "mcpServers": {
    "ai-tools": {
      "command": "npx",
      "args": ["@reverse-craft/ai-tools"],
      "env": {
        "OPENAI_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with a local installation:

```json
{
  "mcpServers": {
    "ai-tools": {
      "command": "node",
      "args": ["/path/to/ai-tools/dist/server.js"],
      "env": {
        "OPENAI_API_KEY": "your-api-key"
      }
    }
  }
}
```

## MCP Tools

### find_jsvmp_dispatcher

Detect JSVMP (JavaScript Virtual Machine Protection) patterns in code using LLM analysis.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| filePath | string | Yes | Path to the JavaScript file to analyze |
| startLine | number | Yes | Start line number (1-based) |
| endLine | number | Yes | End line number (1-based) |
| charLimit | number | No | Character limit for string truncation (default: 300) |

**Detection Types:**

- **If-Else Dispatcher** - Nested if-else chains for instruction dispatch
- **Switch Dispatcher** - Large switch statements (>20 cases) for opcode handling
- **Instruction Array** - Arrays storing bytecode instructions
- **Stack Operation** - Virtual stack push/pop patterns

**Confidence Levels:**

- `ultra_high` - Multiple JSVMP features present (loop + dispatcher + stack)
- `high` - Clear dispatcher structure (>20 cases or >10 nesting levels)
- `medium` - Partial JSVMP features
- `low` - Possible but uncertain patterns

**Example Response:**

```
=== JSVMP Dispatcher Detection Result ===
File: ./obfuscated.js (1-500)

Summary: 检测到典型的 JSVMP 保护结构，包含主分发器和栈操作

Detected Regions:
[ultra_high] Lines 45-280: Switch Dispatcher
  大型 switch 语句包含 47 个 case，典型的 JSVMP 指令分发器

[high] Lines 12-44: Stack Operation
  虚拟栈初始化和操作，使用数组索引进行 push/pop
```

## What is JSVMP?

JSVMP (JavaScript Virtual Machine Protection) is a code protection technique that:

1. Converts JavaScript source code to custom bytecode
2. Implements a virtual machine to execute the bytecode
3. Uses dispatchers (switch/if-else) to handle different opcodes
4. Maintains a virtual stack for operand storage

This makes reverse engineering significantly harder as the original logic is hidden behind VM interpretation.

## Related Packages

- **[@reverse-craft/smart-fs](https://github.com/reverse-craft/smart-fs)** - Core library for code processing
- **[@reverse-craft/smart-fs-mcp](https://github.com/reverse-craft/smart-fs-mcp)** - MCP server for smart-fs

## License

MIT
