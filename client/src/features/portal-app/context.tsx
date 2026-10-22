import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  PortalAccountDto,
  PortalPermission,
  PortalSessionDto,
  PortalSubjectDto,
} from "@shared/contracts/portal-identity";
import {
  portalIdentityApi,
  setPortalCsrf,
  subscribePortalAccessErrors,
  PortalApiError,
} from "./api";
import { ConfirmAction } from "./ui";
import {
  allowNavigation,
  registerNavigationGuard,
} from "@/lib/navigationGuard";
import { i18n } from "@/lib/i18n";
import { setUploadCsrf } from "./resources-api";
import { usePortalRealtime } from "./realtime";
import { useLocation } from "wouter";
import {
  learningModuleFromPath,
  type LearningModule,
} from "@shared/platform-routes";

export function portalGrantFingerprint(subjects: PortalSubjectDto[]) {
  return [...subjects]
    .sort((a, b) => a.linkId - b.linkId)
    .map((link) =>
      [
        link.linkId,
        link.studentId,
        link.kind,
        link.studentClassification,
        [...link.permissions].sort().join(","),
      ].join(":"),
    )
    .join("|");
}
export const portalSessionKey = ["portal-session"] as const;
export function portalSubjectKey(
  account: PortalAccountDto,
  subject: PortalSubjectDto,
  area: string,
  ...parts: unknown[]
) {
  return [
    "portal-subject",
    account.id,
    subject.linkId,
    subject.studentId,
    subject.kind,
    [...subject.permissions].sort().join(","),
    area,
    ...parts,
  ] as const;
}
type PortalContextValue = {
  session: PortalSessionDto | undefined;
  loading: boolean;
  error: unknown;
  refresh: () => void;
  account: PortalAccountDto | null;
  learningModule: LearningModule | null;
  allSubjects: PortalSubjectDto[];
  subjects: PortalSubjectDto[];
  subject: PortalSubjectDto | null;
  selectSubject: (
    id: number | null,
    options?: { preserveEntityQuery?: boolean },
  ) => void;
  acceptSession: (session: PortalSessionDto) => void;
  allowed: (permission: PortalPermission, studentOnly?: boolean) => boolean;
  guarded: (action: () => void) => void;
  guardScope: (scope: string, action: () => void) => void;
  registerUnsaved: (
    id: string,
    unsaved: boolean,
    scopes: readonly string[],
  ) => void;
};
const PortalContext = createContext<PortalContextValue | null>(null);
const PortalFormScopeContext = createContext<readonly string[]>([]);

/** React portals keep this ancestry, so nested dialogs remain in their parent form scope. */
export function PortalFormScope({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const parents = useContext(PortalFormScopeContext);
  const scopes = useMemo(() => [...parents, id], [parents, id]);
  return (
    <PortalFormScopeContext.Provider value={scopes}>
      {children}
    </PortalFormScopeContext.Provider>
  );
}

export function usePortalFormScope() {
  const value = useContext(PortalContext);
  const id = useId();
  const guardScope = value?.guardScope;
  const guarded = useCallback(
    (action: () => void) => guardScope?.(id, action),
    [guardScope, id],
  );
  if (!value) throw new Error("Portal context required");
  return { id, guarded };
}

export function usePortal() {
  const value = useContext(PortalContext);
  const id = useId();
  const scopes = useContext(PortalFormScopeContext);
  const register = value?.registerUnsaved;
  const setUnsaved = useCallback(
    (unsaved: boolean) => register?.(id, unsaved, scopes),
    [register, id, scopes],
  );
  useEffect(() => () => register?.(id, false, scopes), [register, id, scopes]);
  if (!value) throw new Error("Portal context required");
  return { ...value, setUnsaved };
}
export function PortalSessionProvider({ children }: { children: ReactNode }) {
  const [path, navigate] = useLocation();
  const learningModule = learningModuleFromPath(path);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: portalSessionKey,
    queryFn: ({ signal }) => portalIdentityApi.session(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    let scheduled = false;
    return subscribePortalAccessErrors(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        void client.invalidateQueries({ queryKey: portalSessionKey });
      });
    });
  }, [client]);
  const [selection, setSelection] = useState<{
    accountId: number;
    linkId: number | null;
  } | null>(null);
  const [unsavedForms, setUnsavedForms] = useState<
    Record<string, { scopes: readonly string[] }>
  >({});
  const unsaved = Object.keys(unsavedForms).length > 0;
  const registerUnsaved = useCallback(
    (id: string, value: boolean, scopes: readonly string[]) =>
      setUnsavedForms((previous) => {
        if (value ? previous[id]?.scopes === scopes : !previous[id])
          return previous;
        const next = { ...previous };
        if (value) next[id] = { scopes };
        else delete next[id];
        return next;
      }),
    [],
  );
  const [pending, setPending] = useState<(() => void) | null>(null);
  const approvedActionDepth = useRef(0);
  const account = query.data?.account ?? null;
  const languageAccount = useRef<number | null>(null);
  useEffect(() => {
    if (account && languageAccount.current !== account.id) {
      languageAccount.current = account.id;
      i18n.setLanguage(account.locale);
    }
  }, [account]);
  const allSubjects = useMemo(() => query.data?.subjects ?? [], [query.data]);
  const subjects = useMemo(
    () =>
      learningModule
        ? allSubjects.filter((item) =>
            learningModule === "student"
              ? item.kind === "self"
              : item.kind === "representative",
          )
        : allSubjects,
    [allSubjects, learningModule],
  );
  const subject = useMemo(() => {
    if (!account) return null;
    if (selection?.accountId === account.id) {
      if (
        selection.linkId === null &&
        subjects.filter((item) => item.kind === "representative").length > 1
      )
        return null;
      const selected = subjects.find(
        (item) => item.linkId === selection.linkId,
      );
      if (selected) return selected;
    }
    const stored =
      sessionStorage.getItem(
        `portal-context-${account.id}${learningModule ? `:${learningModule}` : ""}`,
      ) ?? sessionStorage.getItem(`portal-context-${account.id}`);
    if (stored !== null) {
      const previous = subjects.find((item) => item.linkId === Number(stored));
      if (previous) return previous;
    }
    const own = subjects.find((item) => item.kind === "self");
    if (own) return own;
    return subjects.length > 1 ? null : (subjects[0] ?? null);
  }, [account, subjects, selection, learningModule]);
  usePortalRealtime({
    accountId: account?.id ?? null,
    csrfToken: query.data?.csrfToken,
    linkId: subject?.linkId ?? null,
    subjectKey:
      account && subject
        ? portalSubjectKey(account, subject, "").slice(0, 6)
        : null,
  });
  useEffect(() => {
    if (query.data) {
      setPortalCsrf(query.data.csrfToken);
      setUploadCsrf(query.data.csrfToken);
    }
  }, [query.data]);
  useEffect(() => {
    const obsolete = (item: { queryKey: readonly unknown[] }) => {
      if (item.queryKey[0] === "portal-account") {
        if (item.queryKey[1] !== account?.id) return true;
        return (
          [
            "notifications",
            "day-notifications",
            "notifications-badge",
          ].includes(String(item.queryKey[2])) &&
          item.queryKey[3] !== portalGrantFingerprint(allSubjects)
        );
      }
      if (item.queryKey[0] !== "portal-subject") return false;
      const link = subjects.find(
        (candidate) => candidate.linkId === item.queryKey[2],
      );
      return (
        item.queryKey[1] !== account?.id ||
        !link ||
        item.queryKey[3] !== link.studentId ||
        item.queryKey[4] !== link.kind ||
        item.queryKey[5] !== [...link.permissions].sort().join(",")
      );
    };
    void client.cancelQueries({ predicate: obsolete });
    client.removeQueries({ predicate: obsolete });
  }, [account?.id, subjects, allSubjects, client]);
  useEffect(() => {
    if (!unsaved) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);
  useEffect(() => {
    if (!unsaved) return;
    return registerNavigationGuard((proceed) => setPending(() => proceed));
  }, [unsaved]);
  const guarded = useCallback(
    (action: () => void) => {
      if (unsaved && approvedActionDepth.current === 0)
        setPending(() => action);
      else action();
    },
    [unsaved],
  );
  const guardScope = useCallback(
    (scope: string, action: () => void) => {
      if (
        approvedActionDepth.current === 0 &&
        Object.values(unsavedForms).some((form) => form.scopes.includes(scope))
      )
        setPending(() => action);
      else action();
    },
    [unsavedForms],
  );
  const selectSubject = useCallback(
    (linkId: number | null, options?: { preserveEntityQuery?: boolean }) =>
      guarded(() => {
        if (!account) return;
        if (linkId !== null && !subjects.some((item) => item.linkId === linkId))
          return;
        if (linkId === null && learningModule === "student")
          return;
        void client.cancelQueries({ queryKey: ["portal-subject"] });
        client.removeQueries({ queryKey: ["portal-subject"] });
        setSelection({ accountId: account.id, linkId });
        sessionStorage.setItem(
          `portal-context-${account.id}${learningModule ? `:${learningModule}` : ""}`,
          String(linkId ?? "family"),
        );
        const params = new URLSearchParams(window.location.search);
        const entityKeys = ["review", "thread", "question", "submission", "enrollmentId"];
        const clearEntity =
          subject?.linkId !== linkId &&
          !options?.preserveEntityQuery &&
          entityKeys.some((key) => params.has(key));
        if (clearEntity) entityKeys.forEach((key) => params.delete(key));
        if (params.has("linkId") || clearEntity) {
          if (params.has("linkId")) {
            if (linkId === null) params.delete("linkId");
            else params.set("linkId", String(linkId));
          }
          const search = params.toString();
          const destination = `${window.location.pathname}${search ? `?${search}` : ""}${clearEntity ? "" : window.location.hash}`;
          if (
            destination !==
            `${window.location.pathname}${window.location.search}${window.location.hash}`
          )
            allowNavigation(() => navigate(destination, { replace: true }));
        }
      }),
    [
      account,
      client,
      guarded,
      subjects,
      subject?.linkId,
      learningModule,
      navigate,
    ],
  );
  const acceptSession = useCallback(
    (session: PortalSessionDto) => {
      setPortalCsrf(session.csrfToken);
      setUploadCsrf(session.csrfToken);
      void client.cancelQueries({ queryKey: ["portal-subject"] });
      client.removeQueries({ queryKey: ["portal-subject"] });
      client.setQueryData(portalSessionKey, session);
    },
    [client],
  );
  const allowed = useCallback(
    (permission: PortalPermission, studentOnly = false) =>
      Boolean(
        subject &&
          (!studentOnly || subject.kind === "self") &&
          subject.permissions.includes(permission),
      ),
    [subject],
  );
  return (
    <PortalContext.Provider
      value={{
        session: query.data,
        loading: query.isPending,
        error:
          query.data?.account &&
          (!(query.error instanceof PortalApiError) ||
            ![401, 403, 404].includes(query.error.status))
            ? null
            : query.error,
        refresh: () => {
          void query.refetch();
        },
        account,
        learningModule,
        allSubjects,
        subjects,
        subject,
        selectSubject,
        acceptSession,
        allowed,
        guarded,
        guardScope,
        registerUnsaved,
      }}
    >
      {children}
      <ConfirmAction
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        titleKey="portalUnsavedTitle"
        description="portalUnsavedDescription"
        action="portalLeave"
        onConfirm={() => {
          const action = pending;
          setPending(null);
          if (!action) return;
          // A confirmed action may synchronously select a subject and then
          // navigate. Its nested guards share this approval; later work does not.
          approvedActionDepth.current += 1;
          try {
            allowNavigation(action);
          } finally {
            approvedActionDepth.current -= 1;
          }
        }}
      />
    </PortalContext.Provider>
  );
}
export function useSubjectQuery<T>(
  area: string,
  load: (linkId: number, signal: AbortSignal) => Promise<T>,
  parts: unknown[] = [],
  permission: PortalPermission = "learning.read",
  enabled = true,
) {
  const { account, subject, allowed } = usePortal();
  return useQuery({
    queryKey:
      account && subject
        ? portalSubjectKey(account, subject, area, ...parts)
        : ["portal-subject-unavailable", area, ...parts],
    queryFn: ({ signal }) => {
      if (!subject) throw new Error("Subject required");
      return load(subject.linkId, signal);
    },
    enabled: Boolean(enabled && account && subject && allowed(permission)),
    staleTime: 20_000,
  });
}
export function useInvalidateSubject() {
  const client = useQueryClient();
  const { account, subject } = usePortal();
  return () => {
    if (account && subject)
      return client.invalidateQueries({
        queryKey: portalSubjectKey(account, subject, "").slice(0, 6),
      });
    return Promise.resolve();
  };
}

export function useSubjectInfiniteQuery<
  TPage extends { items: unknown[]; nextCursor: number | null },
>(
  area: string,
  load: (
    linkId: number,
    signal: AbortSignal,
    cursor?: number,
  ) => Promise<TPage>,
  parts: unknown[] = [],
  permission: PortalPermission = "learning.read",
  enabled = true,
) {
  const { account, subject, allowed } = usePortal();
  return useInfiniteQuery({
    queryKey:
      account && subject
        ? portalSubjectKey(account, subject, area, ...parts)
        : ["portal-subject-unavailable", area, ...parts],
    queryFn: ({ signal, pageParam }) =>
      load(subject!.linkId, signal, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(enabled && account && subject && allowed(permission)),
    staleTime: 20_000,
  });
}
