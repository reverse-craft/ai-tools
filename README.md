# @reverse-craft/ai-tools

MCP server for AI-powered JSVMP detection. Provides LLM-driven code analysis tools for identifying JavaScript Virtual Machine Protection patterns.

## Features

- **MCP Server** - Model Context Protocol server for AI assistant integration
- **JSVMP Detection** - Detect VM protection patterns using LLM analysis
- **Multiple LLM Providers** - Support for OpenAI, Anthropic Claude, and Google Gemini
- **Multiple Pattern Types** - Identifies dispatchers, instruction arrays, stack operations
- **Confidence Levels** - Results include ultra_high, high, medium, low confidence ratings

## Installation

```bash
npm install @reverse-craft/ai-tools
```

## Configuration

### LLM Provider Selection

Set `LLM_PROVIDER` to choose your AI provider (defaults to `openai`):

```bash
export LLM_PROVIDER=openai    # or anthropic, google
```

### Universal Configuration (applies to any provider)

```bash
export LLM_PROVIDER=openai           # Provider selection
export LLM_MODEL=gpt-4o              # Override model for any provider
export LLM_BASE_URL=https://custom.api.com  # Override base URL for any provider
```

### OpenAI Configuration

```bash
export LLM_PROVIDER=openai
export OPENAI_API_KEY=your-api-key
export OPENAI_MODEL=gpt-4.1-mini          # Optional, default: gpt-4.1-mini
export OPENAI_BASE_URL=https://api.openai.com/v1  # Optional, for custom endpoints
```

### Anthropic Claude Configuration

```bash
export LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=your-api-key
export ANTHROPIC_MODEL=claude-haiku-4-5-20241022  # Optional, default: claude-haiku-4-5-20241022
export ANTHROPIC_BASE_URL=https://api.anthropic.com  # Optional, for custom endpoints
```

### Google Gemini Configuration

```bash
export LLM_PROVIDER=google
export GOOGLE_API_KEY=your-api-key
export GOOGLE_MODEL=gemini-2.5-flash-lite     # Optional, default: gemini-2.5-flash-lite
export GOOGLE_BASE_URL=https://generativelanguage.googleapis.com  # Optional, for custom endpoints
```

### Environment Variables Summary

| Variable | Provider | Required | Default | Description |
|----------|----------|----------|---------|-------------|
| `LLM_PROVIDER` | All | No | `openai` | LLM provider selection |
| `LLM_MODEL` | All | No | - | Universal model override (highest priority) |
| `LLM_BASE_URL` | All | No | - | Universal base URL override (highest priority) |
| `OPENAI_API_KEY` | OpenAI | Yes* | - | OpenAI API key |
| `OPENAI_MODEL` | OpenAI | No | `gpt-4.1-mini` | Model to use |
| `OPENAI_BASE_URL` | OpenAI | No | SDK default | Custom API endpoint |
| `ANTHROPIC_API_KEY` | Anthropic | Yes* | - | Anthropic API key |
| `ANTHROPIC_MODEL` | Anthropic | No | `claude-haiku-4-5-20241022` | Model to use |
| `ANTHROPIC_BASE_URL` | Anthropic | No | SDK default | Custom API endpoint |
| `GOOGLE_API_KEY` | Google | Yes* | - | Google API key |
| `GOOGLE_MODEL` | Google | No | `gemini-2.5-flash-lite` | Model to use |
| `GOOGLE_BASE_URL` | Google | No | SDK default | Custom API endpoint |

*Required only when using the corresponding provider

**Priority Order:**
- Model: `LLM_MODEL` > `{PROVIDER}_MODEL` > default
- Base URL: `LLM_BASE_URL` > `{PROVIDER}_BASE_URL` > SDK default

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

**Using OpenAI:**

```json
{
  "mcpServers": {
    "ai-tools": {
      "command": "npx",
      "args": ["@reverse-craft/ai-tools"],
      "env": {
        "OPENAI_API_KEY": "your-api-key",
        "OPENAI_MODEL": "gpt-4.1-mini",
        "OPENAI_BASE_URL": "https://api.openai.com/v1"
      }
    }
  }
}
```

**Using Anthropic Claude:**

```json
{
  "mcpServers": {
    "ai-tools": {
      "command": "npx",
      "args": ["@reverse-craft/ai-tools"],
      "env": {
        "LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "your-api-key",
        "ANTHROPIC_MODEL": "claude-haiku-4-5-20241022",
        "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
      }
    }
  }
}
```

**Using Google Gemini:**

```json
{
  "mcpServers": {
    "ai-tools": {
      "command": "npx",
      "args": ["@reverse-craft/ai-tools"],
      "env": {
        "LLM_PROVIDER": "google",
        "GOOGLE_API_KEY": "your-api-key",
        "GOOGLE_MODEL": "gemini-2.5-flash-lite",
        "GOOGLE_BASE_URL": "https://generativelanguage.googleapis.com"
      }
    }
  }
}
```

**Using Universal Configuration (works with any provider):**

```json
{
  "mcpServers": {
    "ai-tools": {
      "command": "npx",
      "args": ["@reverse-craft/ai-tools"],
      "env": {
        "LLM_PROVIDER": "openai",
        "OPENAI_API_KEY": "your-api-key",
        "LLM_MODEL": "gpt-4o",
        "LLM_BASE_URL": "https://your-custom-endpoint.com/v1"
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
| charLimit | number | No | Character limit for string truncation (default: 300) |
| maxTokensPerBatch | number | No | Maximum tokens per batch for LLM analysis (default: 150000) |

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
