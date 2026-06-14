import {
  AUTH_SESSION_QUERY_KEY,
  type AuthSession,
} from "@shared/auth";
import { apiRequest } from "@/lib/queryClient";

export { AUTH_SESSION_QUERY_KEY };

export async function fetchAuthSession(): Promise<AuthSession> {
  const response = await fetch("/api/auth/session", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to resolve auth session");
  }

  return response.json();
}

export async function loginUserSession(
  login: string,
  password: string,
) {
  return apiRequest("POST", "/api/auth/login", { login, password });
}

export async function logoutSession() {
  return apiRequest("POST", "/api/auth/logout");
}
