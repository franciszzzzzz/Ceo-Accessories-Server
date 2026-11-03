import { pinoHttp } from "pino-http";
import { logger } from "../config/logger.js";

export const requestLogger = pinoHttp({
  logger,
  quietReqLogger: true,
  customProps: (_request, response) => ({ requestId: response.getHeader("X-Request-Id") }),
  serializers: {
    req(request) {
      return { method: request.method, url: request.url?.split("?")[0] };
    },
    res(response) {
      return { statusCode: response.statusCode };
    },
  },
});
