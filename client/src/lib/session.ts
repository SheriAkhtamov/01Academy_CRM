import type { AuthSession, SavedAccountEntry } from "@shared/auth";
import { apiRequest } from "@/lib/queryClient";
import { setActivePlatformRealm } from '@/lib/platformSession';
import { platformLoginResolutionSchema, type PlatformLoginRealm } from '@shared/contracts/platform-auth';
import { i18n } from '@/lib/i18n';

export async function resolveLoginRealm(identifier: string, password: string, preferredRealm: PlatformLoginRealm): Promise<PlatformLoginRealm> {
  const result = platformLoginResolutionSchema.safeParse(await apiRequest('POST', '/api/auth/login-realm', { identifier, password, preferredRealm }));
  if (!result.success) throw new Error(i18n.t('loginFailedMessage'));
  return result.data.realm;
}

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
  const result = await apiRequest("POST", "/api/auth/logout");
  setActivePlatformRealm('signed-out');
  return result;
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
): Promise<{ id: number; savedAccountId: number; user: any; token: string }> {
  return apiRequest("POST", "/api/auth/accounts", { login, password });
}

export async function switchAccount(tokens: string[], targetAccountId: number): Promise<{ matchedTokenIndex: number }> {
  return apiRequest("POST", "/api/auth/switch-account", { tokens, targetAccountId });
}

export async function removeSavedAccount(id: number) {
  return apiRequest("DELETE", `/api/auth/accounts/${id}`);
}
