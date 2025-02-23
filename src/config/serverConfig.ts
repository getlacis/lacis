import type { ServerConfig } from "@/types";


const defaultConfig: ServerConfig = {
  port: 3000,
  isDev: process.env.NODE_ENV === "development",
};

function getConfig(customConfig: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...defaultConfig,
    ...customConfig,
  };
}

export { getConfig, type ServerConfig, defaultConfig };
