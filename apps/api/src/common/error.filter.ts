import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { ApiError } from "@releaselens/contracts";
import type { Request, Response } from "express";

function isExposedClientError(error: unknown): error is { status: number; message: string } {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { status?: unknown; expose?: unknown; message?: unknown };
  return (
    e.expose === true &&
    typeof e.status === "number" &&
    e.status >= 400 &&
    e.status < 500 &&
    typeof e.message === "string"
  );
}

/**
 * Every error leaves the API as `{ statusCode, message, requestId }`.
 * Unexpected errors are logged (redacted) and returned as a generic 500,
 * so stack traces and internal details never reach the client.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: unknown }>();
    const requestId = typeof req.id === "string" ? req.id : undefined;

    let body: ApiError;
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === "string"
          ? response
          : typeof (response as { message?: unknown }).message === "string"
            ? (response as { message: string }).message
            : exception.message;
      body = { statusCode: exception.getStatus(), message };
    } else if (isExposedClientError(exception)) {
      // Errors from Express middleware (body too large, malformed JSON) follow the
      // http-errors convention; client errors marked `expose` are safe to return.
      body = { statusCode: exception.status, message: exception.message };
    } else {
      this.logger.error({ err: exception }, "Unhandled error");
      body = { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: "Internal server error" };
    }
    res.status(body.statusCode).json(requestId === undefined ? body : { ...body, requestId });
  }
}
