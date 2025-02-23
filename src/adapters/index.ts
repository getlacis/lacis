import type { Adapter } from '@/types';
import { nodeAdapter } from './node';
import { vercelAdapter } from './vercel';
import { netlifyAdapter } from './netlify';

const adapters: Record<string, Adapter> = {
  node: nodeAdapter,
  vercel: vercelAdapter,
  netlify: netlifyAdapter
};

export function getAdapter(platform: string = 'node'): Adapter {
  const adapter = adapters[platform];
  if (!adapter) {
    throw new Error(`Platform "${platform}" not supported`);
  }
  return adapter;
}