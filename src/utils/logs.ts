import cluster from 'cluster';

function primaryLog(...args: any[]) {
  if (cluster.isPrimary) {
    console.log(...args);
  }
}
export { primaryLog };