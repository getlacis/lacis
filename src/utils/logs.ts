import * as cluster from 'cluster';

export function primaryLog(...args: any[]) {
  if (cluster.isPrimary) {
    console.log(...args);
  }
}