import { MutationCache, QueryCache, QueryClient, QueryFunction } from "@tanstack/react-query";
import { AUTH_SESSION_QUERY_KEY, isAnonymousSession, type AuthSession } from "@shared/auth";
import { devLog } from "@/lib/debug";
import { i18n, translations } from "@/lib/i18n";
import { toast } from "@/hooks/use-toast";

const localizeApiErrorMessage = (message: string, status: number) => {
  if (!message) {
    return i18n.t("errorOccurred");
  }

  const normalized = message.replace(/^\d+:\s*/, "").trim();

  if (normalized === "taskAssignOtherEmployeesAdminOnly") {
    return i18n.t("taskAssignOtherEmployeesAdminOnly");
  }

  const onlinePbxErrors = {
    onlinePbxNotConfigured: i18n.t("onlinePbxNotConfigured"),
    onlinePbxAuthenticationFailed: i18n.t("onlinePbxAuthenticationFailed"),
    onlinePbxInvalidResponse: i18n.t("onlinePbxInvalidResponse"),
    onlinePbxTimeout: i18n.t("onlinePbxTimeout"),
    onlinePbxUnavailable: i18n.t("onlinePbxUnavailable"),
    onlinePbxRequestFailed: i18n.t("onlinePbxRequestFailed"),
    onlinePbxCallFailed: i18n.t("onlinePbxCallFailed"),
    onlinePbxTooManyCalls: i18n.t("onlinePbxTooManyCalls"),
    onlinePbxInvalidPhone: i18n.t("onlinePbxInvalidPhone"),
    onlinePbxCallerNumberMissing: i18n.t("onlinePbxCallerNumberMissing"),
    onlinePbxInvalidExtension: i18n.t("onlinePbxInvalidExtension"),
    onlinePbxWebRtcUnavailable: i18n.t("onlinePbxWebRtcUnavailable"),
    onlinePbxUserLicenseRequired: i18n.t("onlinePbxUserLicenseRequired"),
    onlinePbxRecordingPending: i18n.t("onlinePbxRecordingPending"),
  } as const;
  if (normalized in onlinePbxErrors) {
    return onlinePbxErrors[normalized as keyof typeof onlinePbxErrors];
  }

  const demoLessonErrors = {
    failedToLoadDemoLessons: i18n.t("failedToLoadDemoLessons"),
    failedToCheckDemoAvailability: i18n.t("failedToCheckDemoAvailability"),
    failedToCreateDemoLesson: i18n.t("failedToCreateDemoLesson"),
    failedToEnrollDemoParticipant: i18n.t("failedToEnrollDemoParticipant"),
    failedToCancelDemoLesson: i18n.t("failedToCancelDemoLesson"),
    failedToUpdateDemoAttendance: i18n.t("failedToUpdateDemoAttendance"),
    demoRoomRequired: i18n.t("demoRoomRequired"),
    demoOnlineRoomNotAllowed: i18n.t("demoOnlineRoomNotAllowed"),
    demoCapacityExceeded: i18n.t("demoCapacityExceeded"),
    duplicateDemoParticipants: i18n.t("duplicateDemoParticipants"),
  } as const;
  if (normalized in demoLessonErrors) {
    return demoLessonErrors[normalized as keyof typeof demoLessonErrors];
  }

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
    lower.includes("email") &&
    (
      lower.includes("already exists") ||
      lower.includes("already used") ||
      lower.includes("already taken") ||
      lower.includes("already occupied")
    )
  ) {
    return i18n.t("loginAlreadyExists");
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
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
  };
  let body: string | FormData | undefined;

  if (data instanceof FormData) {
    // Don't set Content-Type for FormData, let browser handle it
    body = data;
    devLog("Sending FormData to:", url);
    devLog("FormData fields:", Array.from(data.keys()));
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

const anonymousSession: AuthSession = { kind: "anonymous" };

/**
 * An expired server session used to leave the app stranded: nothing refetched
 * the session query, so the router kept rendering the authenticated shell while
 * every request failed with 401 and every save silently did nothing. The only
 * way out was for the user to work out that a reload was needed.
 *
 * Dropping the session back to anonymous makes AppRouter fall through to the
 * login screen on the next render.
 */
let signOutScheduled = false;

const handleUnauthorized = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status;
  if (status !== 401 || signOutScheduled) return;

  // A rejected sign-in is also a 401, so only react when we currently believe
  // we are signed in.
  const session = queryClient.getQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY);
  if (isAnonymousSession(session)) return;

  signOutScheduled = true;
  // Deferred because clearing the cache from inside a query's own error
  // callback would remove the query that is still settling. A page load fires
  // several requests at once, so the flag keeps the burst down to one toast.
  queueMicrotask(() => {
    queryClient.clear();
    queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, anonymousSession);
    signOutScheduled = false;
    toast({
      title: i18n.t("sessionExpiredTitle"),
      description: i18n.t("sessionExpiredDescription"),
      variant: "destructive",
    });
  });
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
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
