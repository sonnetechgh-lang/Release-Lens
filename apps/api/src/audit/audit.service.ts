import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type Db } from "@releaselens/db";
import { redact } from "@releaselens/redact";
import { DB } from "../db/db.module.js";

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  orgId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/** Records security-relevant actions. Metadata is always redacted before storage. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId ?? null,
        orgId: entry.orgId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata:
          entry.metadata === undefined
            ? Prisma.DbNull
            : (redact(entry.metadata) as Prisma.InputJsonValue),
      },
    });
  }
}
