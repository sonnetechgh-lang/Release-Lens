import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { AuthConfigResponse, MeResponse } from "@releaselens/contracts";
import type { Response } from "express";
import { AuditService } from "../audit/audit.service.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { AuthService, NotAllowedError } from "./auth.service.js";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  type AuthedRequest,
  type AuthUser,
} from "./auth.types.js";
import { CurrentUser } from "./current-user.decorator.js";
import { GITHUB_OAUTH_CLIENT, type GithubOAuthClient } from "./github-oauth.client.js";
import { Public } from "./public.decorator.js";
import { SessionService } from "./session.service.js";

const OAUTH_COOKIE_PATH = "/api/auth/github";
const OAUTH_TTL_MS = 10 * 60 * 1000;
const STRICT = { default: { limit: 10, ttl: 60_000 } };

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

@ApiTags("auth")
@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GITHUB_OAUTH_CLIENT) private readonly github: GithubOAuthClient,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  private get callbackUrl(): string {
    return `${this.config.publicUrl}/api/auth/github/callback`;
  }

  @Public()
  @Get("auth/config")
  authConfig(): AuthConfigResponse {
    return this.auth.authConfig();
  }

  /** Starts GitHub sign-in: sets a short-lived state + PKCE cookie and redirects to GitHub. */
  @Public()
  @Throttle(STRICT)
  @Get("auth/github")
  startGithub(@Res() res: Response): void {
    if (this.config.github === null)
      throw new NotFoundException("GitHub sign-in is not configured");
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    res.cookie(OAUTH_STATE_COOKIE, `${state}.${verifier}`, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: "lax",
      path: OAUTH_COOKIE_PATH,
      maxAge: OAUTH_TTL_MS,
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: this.config.github.clientId,
      redirect_uri: this.callbackUrl,
      scope: "read:user",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      allow_signup: "false",
    }).toString();
    res.redirect(302, url.toString());
  }

  /**
   * GitHub redirects here. The state must match the cookie set when sign-in started.
   * The GitHub access token is used once to read the profile and then discarded.
   */
  @Public()
  @Throttle(STRICT)
  @Get("auth/github/callback")
  async githubCallback(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
  ): Promise<void> {
    const fail = (reason: string) => {
      res.redirect(302, `${this.config.publicUrl}/sign-in?error=${reason}`);
    };
    const stored = req.cookies[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_COOKIE_PATH });

    const [expectedState, verifier] = (stored ?? "").split(".");
    if (
      this.config.github === null ||
      code === undefined ||
      state === undefined ||
      expectedState === undefined ||
      verifier === undefined ||
      !sameSecret(state, expectedState)
    ) {
      fail("invalid-request");
      return;
    }

    try {
      const token = await this.github.exchangeCode(code, verifier, this.callbackUrl);
      const profile = await this.github.fetchProfile(token);
      const { userId, orgId } = await this.auth.signInWithGithub(profile);
      const session = await this.sessions.create(userId);
      await this.audit.record({
        action: "auth.login",
        actorUserId: userId,
        orgId,
        metadata: { method: "github", githubLogin: profile.login },
      });
      res.cookie(SESSION_COOKIE, session.token, this.sessions.cookieOptions());
      res.redirect(302, `${this.config.publicUrl}/projects`);
    } catch (error) {
      if (error instanceof NotAllowedError) {
        await this.audit.record({ action: "auth.login_denied", metadata: { method: "github" } });
        fail("not-allowed");
        return;
      }
      this.logger.warn({ err: error }, "GitHub sign-in failed");
      fail("github");
    }
  }

  /** Signs in as the read-only demo viewer. Demo mode only. */
  @Public()
  @Throttle(STRICT)
  @Post("auth/demo")
  @HttpCode(204)
  async demoLogin(@Res({ passthrough: true }) res: Response): Promise<void> {
    const userId = await this.auth.demoUserId();
    const session = await this.sessions.create(userId);
    await this.audit.record({
      action: "auth.login",
      actorUserId: userId,
      metadata: { method: "demo" },
    });
    res.cookie(SESSION_COOKIE, session.token, this.sessions.cookieOptions());
  }

  @Post("auth/logout")
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revoke(user.sessionId);
    await this.audit.record({ action: "auth.logout", actorUserId: user.id });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user);
  }
}
