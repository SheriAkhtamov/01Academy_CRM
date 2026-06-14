import type { AuthSession } from "@shared/auth";
import type session from "express-session";
import { storage } from "../storage";
import { authService } from "./auth";

type SessionData = session.SessionData | null | undefined;

export type ResolvedAuthSession = {
  session: AuthSession;
  shouldDestroy: boolean;
};

const anonymousSession = (): AuthSession => ({ kind: "anonymous" });

export async function resolveAuthSession(
  sessionData: SessionData,
): Promise<ResolvedAuthSession> {
  if (!sessionData?.userId) {
    return {
      session: anonymousSession(),
      shouldDestroy: false,
    };
  }

  const user = sessionData.userId
    ? await storage.getUser(sessionData.userId)
    : undefined;

  if (sessionData.userId && (!user || !user.isActive)) {
    return {
      session: anonymousSession(),
      shouldDestroy: true,
    };
  }

  if (user) {
    return {
      session: {
        kind: "user",
        user: authService.sanitizeUser(user),
      },
      shouldDestroy: false,
    };
  }

  return {
    session: anonymousSession(),
    shouldDestroy: false,
  };
}
