import * as http from 'http';
import * as net from 'net';
import cluster from 'cluster';
import { primaryLog } from './logs';

interface ShutdownOptions {
  timeout?: number;
  signals?: NodeJS.Signals[];
  beforeShutdown?: () => Promise<void> | void;
  onShutdown?: () => Promise<void> | void;
}

function setupGracefulShutdown(server: http.Server, options: ShutdownOptions = {}) {
  const {
    timeout = 30000,
    signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'],
    beforeShutdown = async () => {},
    onShutdown = async () => {},
  } = options;

  let isShuttingDown = false;
  const connections = new Set<net.Socket>();

  // Track all connections
  server.on('connection', (connection: net.Socket) => {
    connections.add(connection);
    connection.on('close', () => {
      connections.delete(connection);
    });
  });

  // Function to perform the actual shutdown
  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    primaryLog(`\n🛑 ${signal} received. Graceful shutdown initiated...`);
    
    try {
      // Execute pre-shutdown tasks
      await beforeShutdown();
      
      // Set a timeout to force shutdown if it takes too long
      const forceShutdownTimeout = setTimeout(() => {
        primaryLog('⚠️ Graceful shutdown timeout reached, forcing exit');
        process.exit(1);
      }, timeout);
      
      // Close the server to stop accepting new connections
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      
      primaryLog('✅ Server closed, no longer accepting connections');
      
      // Close existing connections
      if (connections.size > 0) {
        primaryLog(`Waiting for ${connections.size} active connections to finish...`);
        
        // Set keep-alive to false to prevent new requests on existing connections
        for (const socket of connections) {
          socket.setKeepAlive(false);
          
          // For HTTP/1.1 connections, we can use the destroy method after some time
          // to give them a chance to finish their current request
          if (!socket.destroyed) {
            socket.end();
          }
        }
        
        // Wait for all connections to close or force-close them after a timeout
        const connectionCloseTimeout = setTimeout(() => {
          if (connections.size > 0) {
            primaryLog(`Forcing close of ${connections.size} connections`);
            for (const socket of connections) {
              socket.destroy();
            }
          }
        }, timeout / 2);
        
        // Clear timeout if all connections close naturally
        const checkInterval = setInterval(() => {
          if (connections.size === 0) {
            clearInterval(checkInterval);
            clearTimeout(connectionCloseTimeout);
            primaryLog('✅ All connections closed successfully');
          }
        }, 1000);
      }
      
      // Execute post-shutdown tasks
      await onShutdown();
      
      // Clear the force shutdown timeout
      clearTimeout(forceShutdownTimeout);
      
      primaryLog('✅ Graceful shutdown completed');
      
      // If we're a worker, exit the process
      if (cluster.isWorker) {
        process.exit(0);
      }
    } catch (error) {
      primaryLog('⚠️ Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  // Register signal handlers for graceful shutdown
  for (const signal of signals) {
    process.on(signal, () => {
      shutdown(signal).catch((error) => {
        primaryLog('Critical error during shutdown:', error);
        process.exit(1);
      });
    });
  }

  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    primaryLog('⚠️ Uncaught exception:', error);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    primaryLog('⚠️ Unhandled rejection:', reason);
    shutdown('unhandledRejection').catch(() => process.exit(1));
  });

  return {
    shutdown: (signal = 'MANUAL') => shutdown(signal),
  };
}

export { setupGracefulShutdown };