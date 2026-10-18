import type { Request } from "express";

export const SESSION_COOKIE = "rl_session";
export const OAUTH_STATE_COOKIE = "rl_oauth";

export interface AuthUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  isDemo: boolean;
  sessionId: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthUser;
  cookies: Record<string, string | undefined>;
}
