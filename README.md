# @reverse-craft/ai-tools

AI-powered code analysis tools for smart-fs. Provides LLM-driven functionality including JSVMP (JavaScript Virtual Machine Protection) dispatcher detection.

## Features

- **JSVMP Detection** - Detect VM protection patterns using LLM analysis
- **LLM Configuration** - Flexible OpenAI-compatible API configuration
- **Code Formatting** - Format code for LLM analysis with source map coordinates

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
export OPENAI_MODEL=gpt-4
```

## Usage

### JSVMP Dispatcher Detection

```typescript
import { findJsvmpDispatcher } from '@reverse-craft/ai-tools';

const result = await findJsvmpDispatcher(
  './obfuscated.js',
  1,      // startLine
  500,    // endLine
  { charLimit: 300 }
);

if (result.success) {
  console.log(result.formattedOutput);
  // Detected regions with confidence levels
  for (const region of result.result.regions) {
    console.log(`[${region.confidence}] Lines ${region.start}-${region.end}: ${region.type}`);
  }
}
```

### LLM Configuration

```typescript
import { getLLMConfig, isLLMConfigured, createLLMClient } from '@reverse-craft/ai-tools';

// Check if LLM is configured
if (isLLMConfigured()) {
  const config = getLLMConfig();
  const client = createLLMClient(config);
}
```

### Code Formatting for Analysis

```typescript
import { formatCodeForAnalysis } from '@reverse-craft/ai-tools';

const formatted = await formatCodeForAnalysis(
  './app.min.js',
  1,      // startLine
  100,    // endLine
  300     // charLimit
);

console.log(formatted.content);
// Output: "LineNo SourceLoc Code" format
```

## API

### Types

```typescript
// Detection types
type DetectionType = 
  | "If-Else Dispatcher" 
  | "Switch Dispatcher" 
  | "Instruction Array" 
  | "Stack Operation";

type ConfidenceLevel = "ultra_high" | "high" | "medium" | "low";

interface DetectionRegion {
  start: number;
  end: number;
  type: DetectionType;
  confidence: ConfidenceLevel;
  description: string;
}

interface JsvmpDetectionResult {
  success: boolean;
  filePath: string;
  startLine: number;
  endLine: number;
  result?: DetectionResult;
  formattedOutput?: string;
  error?: string;
}
```

### Functions

- `findJsvmpDispatcher(filePath, startLine, endLine, options?)` - Detect JSVMP patterns
- `formatCodeForAnalysis(filePath, startLine, endLine, charLimit?)` - Format code for LLM
- `parseDetectionResult(jsonString)` - Parse LLM response
- `getLLMConfig()` - Get LLM configuration from environment
- `isLLMConfigured()` - Check if LLM is configured
- `createLLMClient(config)` - Create LLM client instance

## Related Packages

- **[@reverse-craft/smart-fs](https://github.com/reverse-craft/smart-fs)** - Core library
- **[@reverse-craft/smart-fs-mcp](https://github.com/reverse-craft/smart-fs-mcp)** - MCP server

## License

MIT
