// Single source of truth for the default maximum request body size (10 MB).
// Override per-server with ServerConfig.maxBodySize; adapters set the resolved
// limit on each request as `_maxBodySize`.
export const DEFAULT_MAX_BODY_SIZE = 10_485_760;
