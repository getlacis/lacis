import { defineConfig } from 'tsup';

const openApiExternals = ['zod', 'zod-to-json-schema', '@valibot/to-json-schema']

export default defineConfig([
  {
    entry: {
      'index': 'src/index.ts',
      'adapters/index': 'src/adapters/index.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'dist',
    splitting: true,
    platform: 'node',
    sourcemap: false,
    treeshake: true,
    minify: true,
    external: openApiExternals,
  },
  {
    entry: { index: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    outDir: 'dist/cli',
    platform: 'node',
    sourcemap: false,
    treeshake: true,
    minify: true,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
