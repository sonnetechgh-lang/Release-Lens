import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "releaselens:isPublic";

/** Marks a route as reachable without a session. Everything else requires one. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SKIP_ORIGIN_CHECK = "releaselens:skipOriginCheck";

/**
 * Exempts a route from the dashboard-origin check. Only for server-to-server
 * endpoints that authenticate another way (e.g. GitHub webhook signatures).
 */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);
