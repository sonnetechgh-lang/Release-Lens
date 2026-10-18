import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "releaselens:isPublic";

/** Marks a route as reachable without a session. Everything else requires one. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
