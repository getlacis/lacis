import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'dist',
    platform: 'node',
    sourcemap: false,
    treeshake: true,
  },
  {
    entry: { index: 'src/adapters/index.ts' },
    format: ['esm'],
    dts: true,
    outDir: 'dist/adapters',
    platform: 'node',
    sourcemap: false,
    treeshake: true,
  },
  {
    entry: { index: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    outDir: 'dist/cli',
    platform: 'node',
    sourcemap: false,
    treeshake: true,
    banner: { js: '#!/usr/bin/env node' },
    onSuccess: 'cp -r src/cli/templates dist/cli/templates',
  },
]);
