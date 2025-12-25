import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { tools } from './tools/index.js';

// Create MCP Server instance
const server = new McpServer({
  name: 'ai-tools-mcp',
  version: '1.0.0',
});

/**
 * Register a tool with the MCP server.
 */
function registerTool(tool: {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (params: Record<string, unknown>) => Promise<string>;
}): void {
  const zodSchema = z.object(tool.schema);

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (params, _extra) => {
      try {
        const validatedParams = zodSchema.parse(params);
        const result = await tool.handler(validatedParams as Record<string, unknown>);

        return {
          content: [{ type: 'text' as const, text: result }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// Register all tools
for (const tool of tools) {
  registerTool(tool as unknown as {
    name: string;
    description: string;
    schema: z.ZodRawShape;
    handler: (params: Record<string, unknown>) => Promise<string>;
  });
}

// Main entry point
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AI Tools MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
