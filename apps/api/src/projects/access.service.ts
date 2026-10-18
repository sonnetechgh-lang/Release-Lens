import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@releaselens/contracts";
import type { Db } from "@releaselens/db";
import { DB } from "../db/db.module.js";

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ProjectAccess {
  projectId: string;
  orgId: string;
  role: Role;
}

/**
 * The single place that decides whether a user may see a project.
 * A project the user cannot access is reported exactly like one that does not
 * exist, so the API never reveals other organizations' projects.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async project(userId: string, orgSlug: string, projectSlug: string): Promise<ProjectAccess> {
    if (!SLUG.test(orgSlug) || !SLUG.test(projectSlug))
      throw new NotFoundException("Project not found");

    const project = await this.db.project.findFirst({
      where: {
        slug: projectSlug,
        org: { slug: orgSlug, memberships: { some: { userId } } },
      },
      select: {
        id: true,
        orgId: true,
        org: { select: { memberships: { where: { userId }, select: { role: true } } } },
      },
    });
    const membership = project?.org.memberships[0];
    if (project === null || membership === undefined) {
      throw new NotFoundException("Project not found");
    }
    return {
      projectId: project.id,
      orgId: project.orgId,
      role: membership.role === "OWNER" ? "owner" : "viewer",
    };
  }
}
