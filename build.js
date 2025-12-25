import * as esbuild from 'esbuild';
import { execSync } from 'child_process';

// Build the MCP server entry point (server.ts)
await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/server.js',
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node'
  },
  // External packages - smart-fs and other dependencies
  packages: 'external',
  // Prefer ESM modules
  mainFields: ['module', 'main'],
});

// Generate TypeScript declaration files
try {
  execSync('npx tsc --emitDeclarationOnly --declaration --outDir dist', { stdio: 'inherit' });
} catch (e) {
  console.warn('Warning: TypeScript declaration generation had issues, but build continues.');
}

console.log('Build complete!');
