import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Db } from "@releaselens/db";
import { Public } from "../auth/public.decorator.js";
import { DB } from "../db/db.module.js";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Public()
  @Get("healthz")
  @HttpCode(200)
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness: the database answers within a short timeout. */
  @Public()
  @Get("readyz")
  async ready(): Promise<{ status: "ok" }> {
    try {
      await Promise.race([
        this.db.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => {
            reject(new Error("timeout"));
          }, 2000),
        ),
      ]);
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException("Database is not reachable");
    }
  }
}
