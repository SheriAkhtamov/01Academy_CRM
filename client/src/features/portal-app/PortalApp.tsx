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
import {
  isLegacyLearningPath,
  isLearningModulePath,
  learningModuleForSubject,
  learningSectionPath,
  toLearningModuleHref,
} from "@shared/platform-routes";
import { setActivePlatformRealm } from "@/lib/platformSession";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PortalSessionProvider, portalSessionKey, usePortal } from "./context";
import { PortalApiError, portalIdentityApi } from "./api";
import { PortalShell } from "./PortalShell";
import { PortalRecoveryHelp, PortalAuth } from "../portal-identity/PortalAuth";
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
import {
  canAccessPortalSection,
  portalSectionForPath,
} from "./module-navigation";
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
function PortalRoutes() {
  const [rawPath] = useLocation();
  const actualPath = rawPath.replace(/\/+$/, "") || "/";
  const path = learningSectionPath(actualPath);
  const search = useSearch();
  const {
    loading,
    error,
    refresh,
    account,
    subject,
    subjects,
    allSubjects,
    learningModule,
    selectSubject,
  } = usePortal();
  useEffect(() => {
    if (account && isLearningModulePath(actualPath))
      setActivePlatformRealm("portal");
  }, [account, actualPath]);
  const requestedRaw = new URLSearchParams(search).get("linkId");
  const requested = requestedRaw ? Number(requestedRaw) : null;
  const requestedSubject = subjects.find((item) => item.linkId === requested);
  const requestKey = requestedRaw === null ? null : `${actualPath}:${search}`;
  const [appliedRequest, setAppliedRequest] = useState<string | null>(null);
  useEffect(() => {
    if (!account || !requestedSubject) {
      setAppliedRequest(null);
      return;
    }
    if (appliedRequest === requestKey) return;
    if (subject?.linkId === requestedSubject.linkId)
      setAppliedRequest(requestKey);
    else selectSubject(requestedSubject.linkId, { preserveEntityQuery: true });
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
  if (isLegacyLearningPath(actualPath) || actualPath === "/") {
    const requestedLink = allSubjects.find((item) => item.linkId === requested);
    const module = learningModuleForSubject(
      requestedLink ?? subject ?? allSubjects[0],
    );
    const destination = actualPath === "/" ? "/learn" : actualPath;
    return (
      <Redirect
        replace
        to={toLearningModuleHref(
          `${destination}${search ? `?${search}` : ""}${window.location.hash}`,
          module,
        )}
      />
    );
  }
  if (actualPath === "/activate")
    return <PortalAuth mode="invite" token={token} />;
  if (actualPath === "/recover")
    return <PortalRecoveryHelp />;
  if (!account) {
    const destination = token
      ? `/activate#token=${encodeURIComponent(token)}`
      : `${actualPath}${search ? `?${search}` : ""}${window.location.hash}`;
    return <Redirect to={`/login?next=${encodeURIComponent(destination)}`} />;
  }
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
  // Legacy profile links open the same dialog over the learner home screen.
  const pagePath = path === "/learn/profile" ? "/learn" : path;
  const assignment = pagePath.match(/^\/learn\/assignments\/(\d+)$/);
  const material = pagePath.match(
    /^\/learn\/courses\/(\d+)\/materials\/(\d+)$/,
  );
  const course = pagePath.match(/^\/learn\/courses\/(\d+)$/);
  if (pagePath === "/learn/notifications") page = <PortalNotifications />;
  else if (!subjects.length) page = <NoPortalAccess />;
  else if (
    portalSectionForPath(pagePath) &&
    !canAccessPortalSection(
      `${actualPath}${search ? `?${search}` : ""}`,
      learningModule ?? learningModuleForSubject(subject),
      subject ? [subject] : subjects,
    )
  ) page = <PortalEmpty labelKey="portalUnavailable" />;
  else if (!subject) page = <FamilyOverview />;
  else if (pagePath === "/learn" || pagePath === "/learn/login")
    page = subject.permissions.includes("learning.read") ? (
      <PortalDay />
    ) : (
      <PortalLimitedOverview />
    );
  else if (pagePath === "/learn/courses") page = <PortalCourses />;
  else if (material)
    page = (
      <PortalMaterial courseId={Number(material[1])} id={Number(material[2])} />
    );
  else if (course) page = <PortalCourse id={Number(course[1])} />;
  else if (assignment)
    page = <PortalAssignments initialId={Number(assignment[1])} />;
  else if (pagePath === "/learn/assignments") page = <PortalAssignments />;
  else if (pagePath === "/learn/schedule") page = <PortalSchedule />;
  else if (pagePath === "/learn/feedback")
    page = (
      <>
        <PortalTitle labelKey="portalFeedback" />
        <PortalFeedback
          initialId={
            Number(new URLSearchParams(search).get("review")) || undefined
          }
        />
      </>
    );
  else if (pagePath === "/learn/attendance") page = <PortalAttendance />;
  else if (pagePath === "/learn/progress") page = <PortalProgress />;
  else if (pagePath === "/learn/quizzes") page = <PortalQuizzes />;
  else if (pagePath === "/learn/portfolio") page = <PortalPortfolio />;
  else if (pagePath === "/learn/payments") page = <PortalPayments />;
  else if (pagePath === "/learn/makeup") page = <PortalMakeup />;
  else if (pagePath === "/learn/help")
    page = (
      <PortalHelp
        initialId={
          Number(new URLSearchParams(search).get("thread")) || undefined
        }
      />
    );
  else page = <PortalEmpty labelKey="portalNotFound" />;
  return (
    <PortalShell>
      <div
        key={`${account.id}:${subject?.linkId ?? "family"}:${subject?.permissions.join(",")}:${pagePath}:${search}`}
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
