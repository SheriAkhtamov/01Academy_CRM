import type { User } from "./schema";
export type { User };

export type SanitizedUser = Omit<User, "password">;

export type AnonymousSession = {
  kind: "anonymous";
};

export type UserSession = {
  kind: "user";
  user: SanitizedUser;
};

export type AuthSession =
  | AnonymousSession
  | UserSession;

export const AUTH_SESSION_QUERY_KEY = ["/api/auth/session"] as const;

export const isAnonymousSession = (
  session: AuthSession | null | undefined,
): session is AnonymousSession => !session || session.kind === "anonymous";

export const isUserSession = (
  session: AuthSession | null | undefined,
): session is UserSession => Boolean(session && session.kind === "user");

export const getSessionUser = (
  session: AuthSession | null | undefined,
): SanitizedUser | null => {
  if (!session) {
    return null;
  }

  if (isUserSession(session)) {
    return session.user;
  }

  return null;
};
