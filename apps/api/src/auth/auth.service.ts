import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AuthConfigResponse, MeResponse } from "@releaselens/contracts";
import { DEMO_ORG_SLUG, DEMO_USER_LOGIN, type Db } from "@releaselens/db";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { DB } from "../db/db.module.js";
import type { AuthUser } from "./auth.types.js";
import type { GithubProfile } from "./github-oauth.client.js";

export class NotAllowedError extends ForbiddenException {
  constructor() {
    super("This GitHub account is not allowed to sign in");
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  authConfig(): AuthConfigResponse {
    return {
      mode: this.config.mode,
      githubEnabled: this.config.github !== null,
      demoLoginEnabled: this.config.mode === "demo",
    };
  }

  /**
   * Signs in a GitHub user. Only allowlisted logins get in. Roles come from
   * configuration and are re-applied on every sign-in, so removing someone from
   * the owner list takes effect at their next login.
   */
  async signInWithGithub(profile: GithubProfile): Promise<{ userId: string; orgId: string }> {
    const login = profile.login.toLowerCase();
    if (!this.config.allowedLogins.has(login)) throw new NotAllowedError();

    const user = await this.db.user.upsert({
      where: { githubId: BigInt(profile.id) },
      create: {
        githubId: BigInt(profile.id),
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      },
      update: { login: profile.login, name: profile.name, avatarUrl: profile.avatarUrl },
    });

    const org = await this.db.organization.upsert({
      where: { slug: this.config.primaryOrg.slug },
      create: this.config.primaryOrg,
      update: {},
    });
    const role = this.config.ownerLogins.has(login) ? "OWNER" : "VIEWER";
    await this.db.membership.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      create: { orgId: org.id, userId: user.id, role },
      update: { role },
    });

    if (this.config.mode === "demo") {
      const demoOrg = await this.db.organization.findUnique({ where: { slug: DEMO_ORG_SLUG } });
      if (demoOrg !== null) {
        await this.db.membership.upsert({
          where: { orgId_userId: { orgId: demoOrg.id, userId: user.id } },
          create: { orgId: demoOrg.id, userId: user.id, role: "VIEWER" },
          update: {},
        });
      }
    }

    return { userId: user.id, orgId: org.id };
  }

  /** The shared read-only demo account. Only exists in demo mode. */
  async demoUserId(): Promise<string> {
    if (this.config.mode !== "demo") throw new NotFoundException();
    const user = await this.db.user.findFirst({ where: { isDemo: true, login: DEMO_USER_LOGIN } });
    if (user === null) {
      throw new ServiceUnavailableException("Demo data is not loaded. Run `pnpm db:seed`.");
    }
    return user.id;
  }

  async me(auth: AuthUser): Promise<MeResponse> {
    const memberships = await this.db.membership.findMany({
      where: { userId: auth.id },
      include: { org: true },
      orderBy: { org: { name: "asc" } },
    });
    return {
      mode: this.config.mode,
      user: {
        id: auth.id,
        login: auth.login,
        name: auth.name,
        avatarUrl: auth.avatarUrl,
        isDemo: auth.isDemo,
      },
      memberships: memberships.map((m) => ({
        org: { slug: m.org.slug, name: m.org.name },
        role: m.role === "OWNER" ? "owner" : "viewer",
      })),
    };
  }
}
