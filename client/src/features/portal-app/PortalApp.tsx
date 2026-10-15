import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { Redirect, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import { PortalSessionProvider, portalSessionKey, usePortal } from "./context";
import { PortalApiError, portalIdentityApi } from "./api";
import { PortalShell } from "./PortalShell";
import { PortalRecoveryHelp, PortalAuth } from "../portal-identity/PortalAuth";
import { PortalProfile } from "../portal-identity/PortalProfile";
import {
  PortalDay,
  FamilyOverview,
  PortalLimitedOverview,
} from "../lms/overview";
import { PortalCourses, PortalCourse, PortalMaterial } from "../lms/courses";
import { PortalAssignments } from "../lms/assignments";
import { PortalSchedule } from "../lms/schedule";
import { PortalProgress } from "../lms/progress";
import { PortalQuizzes } from "../lms/quizzes";
import { PortalFeedback } from "../lms/feedback";
import { PortalMakeup } from "../lms/makeup";
import { PortalAttendance } from "../lms/attendance";
import { PortalHelp } from "../lms/communication";
import { PortalPortfolio, PublicPortfolio } from "./portfolio";
import { PortalPayments } from "./payments";
import { PortalNotifications } from "./notifications";
import { PortalLoading, PortalError, PortalEmpty, PortalTitle } from "./ui";
import "./portal.css";

export function createPortalQueryClient() {
  const handleAccess = (error: unknown) => {
    if (!(error instanceof PortalApiError)) return;
    if (
      error.status === 403 ||
      (error.status === 401 &&
        !["portalInvalidCredentials", "portalPasswordIncorrect"].includes(
          error.code,
        ))
    )
      queueMicrotask(() => {
        void client.invalidateQueries({ queryKey: portalSessionKey });
      });
  };
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: handleAccess }),
    mutationCache: new MutationCache({ onError: handleAccess }),
    defaultOptions: {
      queries: { retry: false, staleTime: 20_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return client;
}
export function PortalApp() {
  const [client] = useState(createPortalQueryClient);
  return (
    <QueryClientProvider client={client}>
      <PortalSessionProvider>
        <PortalRoutes />
      </PortalSessionProvider>
    </QueryClientProvider>
  );
}
export function PublicPortfolioApp({ token }: { token: string }) {
  const [client] = useState(createPortalQueryClient);
  return (
    <QueryClientProvider client={client}>
      <PublicPortfolio token={token} />
    </QueryClientProvider>
  );
}
function Gate({
  permissions,
  children,
}: {
  permissions: PortalPermission[];
  children: ReactNode;
}) {
  const { subject } = usePortal();
  return subject &&
    permissions.some((permission) =>
      subject.permissions.includes(permission),
    ) ? (
    <>{children}</>
  ) : (
    <PortalEmpty labelKey="portalUnavailable" />
  );
}
function PortalRoutes() {
  const [path] = useLocation();
  const search = useSearch();
  const { loading, error, refresh, account, subject, subjects, selectSubject } =
    usePortal();
  const requestedRaw = new URLSearchParams(search).get("linkId");
  const requested = requestedRaw ? Number(requestedRaw) : null;
  const requestedSubject = subjects.find((item) => item.linkId === requested);
  const requestKey = requestedRaw === null ? null : `${path}:${search}`;
  const [appliedRequest, setAppliedRequest] = useState<string | null>(null);
  useEffect(() => {
    if (!account || !requestedSubject || appliedRequest === requestKey) return;
    if (subject?.linkId === requestedSubject.linkId)
      setAppliedRequest(requestKey);
    else selectSubject(requestedSubject.linkId);
  }, [
    account,
    requestedSubject,
    subject?.linkId,
    selectSubject,
    appliedRequest,
    requestKey,
  ]);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token =
    fragment.get("token") ??
    new URLSearchParams(search).get("token") ??
    undefined;
  if (loading)
    return (
      <div className="mx-auto max-w-xl p-8">
        <PortalLoading />
      </div>
    );
  if (error)
    return (
      <div className="mx-auto max-w-xl p-8">
        <PortalError error={error} retry={refresh} />
      </div>
    );
  if (path === "/learn/invite" || path === "/learn/activate")
    return <PortalAuth mode="invite" token={token} />;
  if (path === "/learn/recover" || path === "/learn/reset") return <PortalRecoveryHelp />;
  if (!account) {
    const destination = token ? `/learn/invite#token=${encodeURIComponent(token)}` : `${path === '/learn/login' ? '/learn' : path}${search ? `?${search}` : ''}`;
    return <Redirect to={`/login?next=${encodeURIComponent(destination)}`} />;
  }
  if (path === '/learn/login') return <Redirect to='/learn' />;
  if (requestedRaw !== null && !requestedSubject)
    return (
      <PortalShell>
        <PortalEmpty labelKey="portalUnavailable" />
      </PortalShell>
    );
  if (
    appliedRequest !== requestKey &&
    requestedSubject &&
    subject?.linkId !== requestedSubject.linkId
  )
    return (
      <PortalShell>
        <PortalLoading />
      </PortalShell>
    );
  let page: ReactNode;
  const assignment = path.match(/^\/learn\/assignments\/(\d+)$/);
  const material = path.match(/^\/learn\/courses\/(\d+)\/materials\/(\d+)$/);
  const course = path.match(/^\/learn\/courses\/(\d+)$/);
  if (path === "/learn/profile") page = <PortalProfile />;
  else if (path === "/learn/notifications") page = <PortalNotifications />;
  else if (!subjects.length) page = <NoPortalAccess />;
  else if (!subject) page = <FamilyOverview />;
  else if (path === "/learn" || path === "/learn/login")
    page = subject.permissions.includes("learning.read") ? (
      <PortalDay />
    ) : (
      <PortalLimitedOverview />
    );
  else if (path === "/learn/courses")
    page = (
      <Gate permissions={["learning.read"]}>
        <PortalCourses />
      </Gate>
    );
  else if (material)
    page = (
      <Gate permissions={["learning.read"]}>
        <PortalMaterial
          courseId={Number(material[1])}
          id={Number(material[2])}
        />
      </Gate>
    );
  else if (course)
    page = (
      <Gate permissions={["learning.read"]}>
        <PortalCourse id={Number(course[1])} />
      </Gate>
    );
  else if (assignment)
    page = (
      <Gate permissions={["learning.read"]}>
        <PortalAssignments initialId={Number(assignment[1])} />
      </Gate>
    );
  else if (path === "/learn/assignments")
    page = (
      <Gate permissions={["learning.read"]}>
        <PortalAssignments />
      </Gate>
    );
  else if (path === "/learn/schedule")
    page = (
      <Gate permissions={["learning.read", "attendance.read"]}>
        <PortalSchedule />
      </Gate>
    );
  else if (path === "/learn/feedback")
    page = (
      <Gate permissions={["feedback.read"]}>
        <PortalTitle labelKey="portalFeedback" />
        <PortalFeedback
          initialId={
            Number(new URLSearchParams(search).get("review")) || undefined
          }
        />
      </Gate>
    );
  else if (path === "/learn/attendance")
    page = (
      <Gate permissions={["attendance.read"]}>
        <PortalAttendance />
      </Gate>
    );
  else if (path === "/learn/progress")
    page = (
      <Gate permissions={["learning.read", "feedback.read"]}>
        <PortalProgress />
      </Gate>
    );
  else if (path === "/learn/quizzes")
    page = (
      <Gate permissions={["learning.read", "feedback.read"]}>
        <PortalQuizzes />
      </Gate>
    );
  else if (path === "/learn/portfolio")
    page = (
      <Gate permissions={["learning.read", "portfolio.approve"]}>
        <PortalPortfolio />
      </Gate>
    );
  else if (path === "/learn/payments")
    page = (
      <Gate permissions={["finance.read"]}>
        <PortalPayments />
      </Gate>
    );
  else if (path === "/learn/makeup")
    page = (
      <Gate permissions={["learning.read", "attendance.read"]}>
        <PortalMakeup />
      </Gate>
    );
  else if (path === "/learn/help")
    page = (
      <Gate permissions={["communication.create"]}>
        <PortalHelp
          initialId={
            Number(new URLSearchParams(search).get("thread")) || undefined
          }
        />
      </Gate>
    );
  else page = <PortalEmpty labelKey="portalNotFound" />;
  return (
    <PortalShell>
      <div
        key={`${account.id}:${subject?.linkId ?? "family"}:${subject?.permissions.join(",")}:${path}:${search}`}
        className="space-y-6"
      >
        {page}
      </div>
    </PortalShell>
  );
}

function NoPortalAccess() {
  const { account } = usePortal();
  const query = useQuery({
    queryKey: ["portal-account", account?.id, "support"],
    queryFn: ({ signal }) => portalIdentityApi.support(signal),
  });
  return (
    <div className="space-y-4">
      <PortalTitle labelKey="portalTitle" />
      <PortalEmpty labelKey="portalNoAccess" />
      {query.data && (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base">{query.data.schoolName}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 p-4 pt-0">
            {query.data.phone && (
              <Button asChild variant="outline">
                <a href={`tel:${query.data.phone}`}>{query.data.phone}</a>
              </Button>
            )}
            {query.data.email && (
              <Button asChild variant="outline">
                <a href={`mailto:${query.data.email}`}>{query.data.email}</a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {query.error && (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
    </div>
  );
}
