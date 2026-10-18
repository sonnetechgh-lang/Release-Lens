import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb, type Db } from "@releaselens/db";
import { APP_CONFIG, type AppConfig } from "../config/config.js";

export const DB = Symbol("DB");

@Injectable()
class DbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Db => createDb(config.databaseUrl),
    },
    DbLifecycle,
  ],
  exports: [DB],
})
export class DbModule {}
