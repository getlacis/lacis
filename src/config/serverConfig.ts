import type { ServerConfig } from "@/types";


const defaultConfig: ServerConfig = {
  port: 3000,
  isDev: process.env.NODE_ENV === "development",
  timeout: 300000,
  platform: "node",
  defaultHeaders: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  },
};

function getConfig(customConfig: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...defaultConfig,
    ...customConfig,
  };
}

export { getConfig, type ServerConfig, defaultConfig };
