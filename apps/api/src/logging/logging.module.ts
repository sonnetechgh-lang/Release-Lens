import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Module, type DynamicModule } from "@nestjs/common";
import { redact, redactString } from "@releaselens/redact";
import { LoggerModule } from "nestjs-pino";
import type { AppConfig } from "../config/config.js";

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses a well-formed incoming X-Request-Id, otherwise generates one. */
export function requestIdFor(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers["x-request-id"];
  const id = typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", id);
  return id;
}

/**
 * Structured JSON logs with a request ID on every line. Request logs include
 * only method, path, and status: no headers, cookies, query strings, or bodies.
 * Anything logged as an object or error goes through the redaction helper.
 */
@Module({})
export class LoggingModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            genReqId: requestIdFor,
            customProps: () => ({ service: "releaselens-api" }),
            customLogLevel: (_req, res, err) =>
              err !== undefined || res.statusCode >= 500
                ? "error"
                : res.statusCode >= 400
                  ? "warn"
                  : "info",
            autoLogging: { ignore: (req) => req.url === "/healthz" || req.url === "/readyz" },
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                path: redactString(req.url.split("?")[0] ?? ""),
              }),
              // pino-http wraps the response; the live status code is on `raw`.
              res: (res: { statusCode?: number | null; raw?: { statusCode?: number } }) => ({
                statusCode: res.raw?.statusCode ?? res.statusCode ?? null,
              }),
              err: (err: unknown) => redact(err),
            },
            formatters: {
              log: (object: Record<string, unknown>) => redact(object),
            },
            ...(config.env === "development"
              ? { transport: { target: "pino-pretty", options: { singleLine: true } } }
              : {}),
          },
        }),
      ],
    };
  }
}
