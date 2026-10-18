import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { AuthedRequest, AuthUser } from "./auth.types.js";

/** The signed-in user. Only usable on routes protected by the session guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (req.auth === undefined) throw new UnauthorizedException("Sign in required");
    return req.auth;
  },
);
