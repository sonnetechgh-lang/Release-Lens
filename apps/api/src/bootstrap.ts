import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import type { AppConfig } from "./config/config.js";

/** Applies the HTTP settings shared by the real server and the integration tests. */
export function configureApp(app: NestExpressApplication): void {
  app.disable("x-powered-by");
  // The dashboard proxies /api to this server, so trust the local proxy for client IPs.
  app.set("trust proxy", "loopback");
  app.useBodyParser("json", { limit: "100kb" });
  app.use(cookieParser());
  app.use(
    (_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  app.setGlobalPrefix("api", { exclude: ["healthz", "readyz"] });
  app.enableShutdownHooks();
}

export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const docs = new DocumentBuilder()
    .setTitle("ReleaseLens API")
    .setDescription("Read-only deployment diagnostics API.")
    .setVersion("0.1.0")
    .addCookieAuth("rl_session")
    .build();
  SwaggerModule.setup("api/docs", app, () => SwaggerModule.createDocument(app, docs));
  return app;
}
