import type { ServerConfig, Request, Response } from "@/types";

const timeoutMap = new WeakMap<Response, ReturnType<typeof setTimeout>>();

function createTimeoutMiddleware(config: ServerConfig) {
  const timeout = config.timeout || 300000;

  return function timeoutMiddleware(req: Request, res: Response) {
    if (timeoutMap.has(res)) {
      return;
    }

    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;

      if (!res.headersSent) {
        res.status(408).json({
          error: "Request Timeout",
          message: `The request exceeded the timeout of ${timeout}ms`,
        });
      }

      timeoutMap.delete(res);
    }, timeout);

    timeoutMap.set(res, timeoutId);

    const cleanup = () => {
      if (timeoutMap.has(res)) {
        const tid = timeoutMap.get(res);
        if (tid) {
          clearTimeout(tid);
        }
        timeoutMap.delete(res);
      }
    };

    res.once("finish", cleanup);
    res.once("close", cleanup);

    Object.defineProperty(req, "isTimedOut", {
      value: () => timedOut,
      configurable: true,
      enumerable: true,
    });
  };
}

export { createTimeoutMiddleware };
