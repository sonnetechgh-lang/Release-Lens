import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { SESSION_COOKIE, type AuthedRequest } from "./auth.types.js";
import { IS_PUBLIC, SKIP_ORIGIN_CHECK } from "./public.decorator.js";
import { SessionService } from "./session.service.js";

/** Every route needs a valid session unless it is marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.sessions.validate(req.cookies[SESSION_COOKIE]);
    if (user === null) throw new UnauthorizedException("Sign in required");
    req.auth = user;
    return true;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for cookie-authenticated requests: anything that changes state
 * must come from the dashboard's own origin. Browsers always send Origin on
 * cross-site POSTs, so a missing or foreign Origin is rejected.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_ORIGIN_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip === true) return true;
    if (req.headers.origin !== this.config.publicOrigin) {
      throw new ForbiddenException("Request origin not allowed");
    }
    return true;
  }
}
