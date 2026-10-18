import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditService } from "./audit/audit.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { GITHUB_OAUTH_CLIENT, HttpGithubOAuthClient } from "./auth/github-oauth.client.js";
import { OriginGuard, SessionGuard } from "./auth/guards.js";
import { SessionService } from "./auth/session.service.js";
import { ErrorFilter } from "./common/error.filter.js";
import type { AppConfig } from "./config/config.js";
import { ConfigModule } from "./config/config.module.js";
import { DbModule } from "./db/db.module.js";
import { HealthController } from "./health/health.controller.js";
import { LoggingModule } from "./logging/logging.module.js";
import { AccessService } from "./projects/access.service.js";
import { ProjectsController } from "./projects/projects.controller.js";
import { ProjectsService } from "./projects/projects.service.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggingModule.forRoot(config),
        DbModule,
        // 120 requests per minute per client by default; auth routes are stricter.
        ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
      ],
      controllers: [HealthController, AuthController, ProjectsController],
      providers: [
        AuditService,
        AuthService,
        SessionService,
        AccessService,
        ProjectsService,
        { provide: GITHUB_OAUTH_CLIENT, useClass: HttpGithubOAuthClient },
        // Guards run in this order: rate limit, origin check, session.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: OriginGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
