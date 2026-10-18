import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Db } from "@releaselens/db";
import type { CookieOptions } from "express";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { DB } from "../db/db.module.js";
import type { AuthUser } from "./auth.types.js";

/** Only the hash of a session token is stored, so a database leak does not leak sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  cookieOptions(maxAgeMs = this.config.sessionTtlMs): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: maxAgeMs,
    };
  }

  /** Creates a session and returns the raw token for the cookie. */
  async create(userId: string): Promise<{ token: string; sessionId: string }> {
    const token = randomBytes(32).toString("base64url");
    const session = await this.db.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.config.sessionTtlMs),
      },
    });
    return { token, sessionId: session.id };
  }

  /** Returns the user for a valid, unexpired session token, or null. */
  async validate(token: string | undefined): Promise<AuthUser | null> {
    if (token === undefined || token.length < 20 || token.length > 100) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (session === null) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.db.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }

    const { user } = session;
    return {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isDemo: user.isDemo,
      sessionId: session.id,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
  }
}
