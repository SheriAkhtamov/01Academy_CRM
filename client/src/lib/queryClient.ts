import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { devLog } from "@/lib/debug";
import { i18n, translations } from "@/lib/i18n";

const localizeApiErrorMessage = (message: string, status: number) => {
  if (!message) {
    return i18n.t("errorOccurred");
  }

  const normalized = message.replace(/^\d+:\s*/, "").trim();

  if (normalized in translations) {
    return i18n.t(normalized as keyof typeof translations);
  }

  const lower = normalized.toLowerCase();

  if (status === 401 || lower === "unauthorized") {
    return i18n.t("unauthorized");
  }
  if (lower.includes("authentication required")) {
    return i18n.t("authenticationRequired");
  }
  if (lower.includes("admin access required")) {
    return i18n.t("adminAccessRequired");
  }
  if (lower.includes("sales access required")) {
    return i18n.t("salesAccessRequired");
  }
  if (lower.includes("report access required")) {
    return i18n.t("reportAccessRequired");
  }
  if (lower.includes("access denied") || lower.includes("forbidden")) {
    return i18n.t("accessDenied");
  }
  if (lower.includes("invalid credentials")) {
    return i18n.t("invalidCredentialsMessage");
  }
  if (lower.includes("session save failed")) {
    return i18n.t("sessionSaveFailed");
  }
  if (
    lower.includes("required") ||
    lower.includes("missing required")
  ) {
    return i18n.t("fillRequiredFields");
  }
  if (lower.startsWith("invalid ")) {
    return i18n.t("invalidData");
  }
  if (lower.includes("not found")) {
    return i18n.t("resourceNotFound");
  }
  if (lower.startsWith("failed to fetch") || lower.startsWith("failed to resolve")) {
    return i18n.t("failedToLoadData");
  }
  if (lower.startsWith("failed to create")) {
    return i18n.t("failedToCreateResource");
  }
  if (lower.startsWith("failed to update")) {
    return i18n.t("failedToUpdateResource");
  }
  if (lower.startsWith("failed to delete")) {
    return i18n.t("failedToDeleteResource");
  }
  return normalized;
};

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const rawText = (await res.text()) || res.statusText;
    let message = rawText;
    let parsedBody: any;

    try {
      parsedBody = JSON.parse(rawText);
      if (typeof parsedBody?.error === "string") {
        message = parsedBody.error;
      } else if (typeof parsedBody?.message === "string") {
        message = parsedBody.message;
      }
    } catch {
      // Fall back to the raw text body.
    }

    const error = new Error(localizeApiErrorMessage(message, res.status)) as Error & {
      status?: number;
      rawMessage?: string;
      data?: unknown;
    };
    error.status = res.status;
    error.rawMessage = message;
    error.data = parsedBody;
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<any> {
  let headers: Record<string, string> = {};
  let body: string | FormData | undefined;

  if (data instanceof FormData) {
    // Don't set Content-Type for FormData, let browser handle it
    body = data;
    devLog("Sending FormData to:", url);
    for (let [key, value] of data.entries()) {
      devLog(`FormData: ${key} = ${value}`);
    }
  } else if (data) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(data);
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    credentials: "include",
  });

  await throwIfResNotOk(res);

  // Return JSON data instead of Response object
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await res.json();
  }
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      if (queryKey.length !== 1 || typeof queryKey[0] !== 'string') {
        throw new Error('Parameterized queryKey requires an explicit queryFn.');
      }

      const url = queryKey[0] as string;
      const res = await fetch(url, {
        credentials: "include",
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
