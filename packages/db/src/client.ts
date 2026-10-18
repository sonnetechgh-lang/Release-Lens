import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = InstanceType<typeof PrismaClient>;

/** Creates a Prisma client using the node-postgres driver. */
export function createDb(databaseUrl: string | undefined = process.env.DATABASE_URL): Db {
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is not set");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
