import type { AuthSession, SavedAccountEntry } from "@shared/auth";
import { apiRequest } from "@/lib/queryClient";

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

// ── Multi-account switching ──────────────────────────────────────────

export async function fetchSavedAccounts(): Promise<SavedAccountEntry[]> {
  const response = await fetch("/api/auth/accounts", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch saved accounts");
  }

  return response.json();
}

export async function addSavedAccount(
  login: string,
  password: string,
): Promise<{ id: number; user: any; token: string }> {
  return apiRequest("POST", "/api/auth/accounts", { login, password });
}

export async function switchAccount(token: string) {
  return apiRequest("POST", "/api/auth/switch-account", { token });
}

export async function removeSavedAccount(id: number) {
  return apiRequest("DELETE", `/api/auth/accounts/${id}`);
}
