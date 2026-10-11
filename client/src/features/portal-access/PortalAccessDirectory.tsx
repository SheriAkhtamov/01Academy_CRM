import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import type { PortalDirectoryAccount, PortalDirectoryQuery, PortalDirectoryRow, PortalDirectoryStats, PortalDirectoryStudent, PortalRepresentativeRow } from "@shared/contracts/portal-directory";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { hasLeadershipAccess } from "@shared/academy";
import type { TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StudentDetailDialog } from "@/components/ux/StudentDetailDialog";
import { permissionLabels } from "./ui/PermissionChecklist";
import { portalDirectoryApi } from "./directory-api";

const filters: Record<PortalDirectoryQuery["filter"], TranslationKey> = {
  all: "portalDirectoryAll", without_access: "portalDirectoryWithoutAccess", pending: "portalDirectoryPending", unverified: "portalDirectoryUnverified", blocked: "portalDirectoryBlocked",
};
const accountStatuses: Record<PortalDirectoryAccount["accountStatus"], TranslationKey> = {
  pending: "lmsStaffPending", active: "lmsStaffActive", suspended: "portalDirectoryBlocked", archived: "portalDirectoryArchived",
};
const invitationStatuses: Record<NonNullable<PortalDirectoryAccount["invitationStatus"]>, TranslationKey> = {
  created: "lmsAccessInvitationCreated", sent: "lmsAccessInvitationSent", delivery_failed: "lmsAccessInvitationFailed", accepted: "lmsAccessInvitationAccepted", expired: "lmsAccessInvitationExpired", revoked: "lmsStaffRevoked",
};
const relationships = { parent: "lmsStaffParent", guardian: "lmsStaffGuardian", payer: "lmsStaffPayer", other: "lmsStaffOther" } as const;
const selectClass = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
const labelClass = "space-y-2";
export type PortalAccessDirectoryProps = { kind?: "students" | "representatives"; enabled?: boolean };
export function PortalAccessDirectory({ kind = "students", enabled = true }: PortalAccessDirectoryProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const [query, setQuery] = useState<PortalDirectoryQuery>({ page: 1, pageSize: 20, filter: "all", q: "" });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PortalDirectoryStudent | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<TranslationKey | null>(null);
  const allowed = enabled && hasLeadershipAccess(user);
  const students = useQuery({ queryKey: ["staff-portal-directory", user?.id ?? 0, "students", query], queryFn: () => portalDirectoryApi.students(query), enabled: allowed && kind === "students", staleTime: 0 });
  const representatives = useQuery({ queryKey: ["staff-portal-directory", user?.id ?? 0, "representatives", query], queryFn: () => portalDirectoryApi.representatives(query), enabled: allowed && kind === "representatives", staleTime: 0 });
  const active = kind === "students" ? students : representatives;
  const groups = active.data?.groups ?? [];
  const total = active.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const format = useMemo(() => new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tashkent" }), [language]);
  const dateTime = (value: string | null | undefined) => value ? format.format(new Date(value)) : t("portalDirectoryNeverSeen");
  const update = (changes: Partial<PortalDirectoryQuery>) => { setQuery((current) => ({ ...current, ...changes, page: 1 })); setExportError(null); };
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true); setExportError(null);
    try {
      const blob = await portalDirectoryApi.export(query, language);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "portal-access.csv";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) { setExportError(error instanceof Error && error.message === "portalDirectoryExportLimit" ? "portalDirectoryExportLimit" : "portalDirectoryExportFailed"); }
    finally { setExporting(false); }
  };
  if (!allowed) return null;
  return <section className="min-w-0 space-y-5" aria-label={t(kind === "students" ? "portalDirectoryTitle" : "portalDirectoryRepresentatives")}>
    {kind === "students" && students.data ? <DirectoryStats stats={students.data.stats} /> : null}
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,2fr)_minmax(170px,1fr)_minmax(170px,1fr)_auto]" onSubmit={(event) => { event.preventDefault(); update({ q: search.trim() }); }}>
      <div className={labelClass}><Label htmlFor={`directory-search-${kind}`}>{t(kind === "students" ? "portalDirectorySearch" : "portalRepresentativeDirectorySearch")}</Label><div className="flex gap-2"><Input id={`directory-search-${kind}`} value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} className="min-h-11" /><Button type="submit" variant="outline" className="min-h-11" aria-label={t("search")}><Search className="size-4" /></Button></div></div>
      <div className={labelClass}><Label htmlFor={`directory-filter-${kind}`}>{t("portalDirectoryFilter")}</Label><select id={`directory-filter-${kind}`} className={selectClass} value={query.filter} onChange={(event) => update({ filter: event.target.value as PortalDirectoryQuery["filter"] })}>{Object.entries(filters).map(([value, key]) => <option key={value} value={value}>{t(value === "all" && kind === "representatives" ? "portalRepresentativeDirectoryAll" : key)}</option>)}</select></div>
      <div className={labelClass}><Label htmlFor={`directory-group-${kind}`}>{t("lmsStaffGroup")}</Label><select id={`directory-group-${kind}`} className={selectClass} value={query.groupId ?? ""} onChange={(event) => update({ groupId: event.target.value ? Number(event.target.value) : undefined })}><option value="">{t("portalDirectoryAllGroups")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div>
      {kind === "students" ? <Button type="button" variant="outline" className="min-h-11 self-end" disabled={exporting || active.isPending || Boolean(active.error)} onClick={() => void exportCsv()}><Download className="mr-2 size-4" />{t(exporting ? "loading" : "portalDirectoryExport")}</Button> : null}
    </form>
    {exportError ? <p role="alert" className="text-sm text-destructive">{t(exportError)}</p> : null}
    {active.isPending ? <div role="status" aria-label={t("loading")} className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : active.error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><p>{t("lmsStaffLoadFailed")}</p><Button variant="outline" onClick={() => void active.refetch()}>{t("retry")}</Button></div> : total === 0 ? <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">{t(kind === "students" ? "portalDirectoryEmpty" : "portalDirectoryRepresentativesEmpty")}</div> : <>
      {kind === "students" ? <StudentDirectoryTable rows={students.data?.items ?? []} onOpen={setSelected} dateTime={dateTime} /> : <RepresentativeDirectoryTable rows={representatives.data?.items ?? []} onOpen={setSelected} dateTime={dateTime} />}
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Label htmlFor={`directory-size-${kind}`}>{t("portalDirectoryPageSize")}</Label><select id={`directory-size-${kind}`} value={query.pageSize} className="min-h-11 rounded-md border bg-background px-3" onChange={(event) => update({ pageSize: Number(event.target.value) })}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></div><span className="text-sm text-muted-foreground" aria-live="polite">{t("portalDirectoryPage").replace("{page}", String(query.page)).replace("{pages}", String(pages))}</span><div className="flex gap-2"><Button variant="outline" disabled={query.page <= 1 || active.isFetching} onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}>{t("previousPage")}</Button><Button variant="outline" disabled={query.page >= pages || active.isFetching} onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}>{t("nextPage")}</Button></div></div>
    </>}
    <StudentDetailDialog student={selected ? { ...selected, updatedAt: selected.updatedAt ?? undefined } : null} open={Boolean(selected)} initialTab="access" onOpenChange={(open) => { if (!open) { setSelected(null); void client.invalidateQueries({ queryKey: ["staff-portal-directory", user?.id ?? 0] }); } }} dateTime={dateTime} />
  </section>;
}
function DirectoryStats({ stats }: { stats: PortalDirectoryStats }) {
  const { t } = useTranslation();
  const metrics = [
    ["portalDirectoryTotalAccounts", stats.accounts, null],
    ["portalDirectoryActivation", `${stats.activationPercent}%`, t("portalDirectoryRatio").replace("{count}", String(stats.activatedAccounts)).replace("{total}", String(stats.accounts))],
    ["portalDirectoryActive7", stats.active7Days, t("portalDirectoryRatio").replace("{count}", String(stats.active7Days)).replace("{total}", String(stats.accounts))],
    ["portalDirectoryActive30", stats.active30Days, t("portalDirectoryRatio").replace("{count}", String(stats.active30Days)).replace("{total}", String(stats.accounts))],
  ] as const;
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([key, value, detail]) => <Card key={key}><CardContent className="space-y-2 p-4"><p className="text-sm text-muted-foreground">{t(key)}</p><p className="text-2xl font-semibold tabular-nums">{value}</p>{detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}</CardContent></Card>)}</div>;
}
function AccountSummary({ account }: { account: PortalDirectoryAccount | null }) {
  const { t } = useTranslation();
  if (!account) return <span className="text-muted-foreground">{t("portalDirectoryNoAccount")}</span>;
  return <div className="space-y-1"><p className="break-words font-medium">{account.fullName}</p><p className="break-all text-xs text-muted-foreground">{account.login}</p><Badge variant={account.accountStatus === "active" && account.linkStatus === "active" ? "secondary" : "outline"}>{t(account.linkStatus === "suspended" ? "portalDirectoryBlocked" : accountStatuses[account.accountStatus])}</Badge></div>;
}
function StudentName({ student, onOpen }: { student: PortalDirectoryStudent; onOpen: (student: PortalDirectoryStudent) => void }) {
  const { t } = useTranslation();
  const name = student.studentName || student.contactName;
  return <Button variant="link" className="h-auto justify-start whitespace-normal p-0 text-left" aria-label={t("portalDirectoryOpenStudent").replace("{name}", name)} onClick={() => onOpen(student)}>{name}</Button>;
}
function StudentDirectoryTable({ rows, onOpen, dateTime }: { rows: PortalDirectoryRow[]; onOpen: (student: PortalDirectoryStudent) => void; dateTime: (value: string | null) => string }) {
  const { t } = useTranslation();
  const headings = ["portalDirectoryStudent", "lmsStaffGroup", "portalDirectorySelfAccount", "portalDirectoryRepresentatives", "portalDirectoryInvitations", "portalDirectoryLastSeen"] as const;
  return <div className="max-w-full overflow-x-auto rounded-lg border"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted/50"><tr>{headings.map((key) => <th key={key} scope="col" className="px-4 py-3 font-medium">{t(key)}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.student.id} className="border-t align-top"><td className="max-w-56 space-y-2 px-4 py-4"><StudentName student={row.student} onOpen={onOpen} /><div className="flex flex-wrap gap-1">{row.needsVerification ? <Badge variant="outline">{t("portalDirectoryUnverified")}</Badge> : null}{row.blocked ? <Badge variant="outline">{t("portalDirectoryBlocked")}</Badge> : null}</div>{row.student.managerName ? <p className="text-xs text-muted-foreground">{t("portalDirectoryManager")}: {row.student.managerName}</p> : null}</td><td className="max-w-48 px-4 py-4"><div className="space-y-1">{row.student.groups.length ? row.student.groups.map((group) => <p key={group.id} className="break-words">{group.name}</p>) : t("noData")}</div></td><td className="max-w-48 px-4 py-4"><AccountSummary account={row.selfAccount} /></td><td className="max-w-56 space-y-3 px-4 py-4">{row.representatives.length ? row.representatives.map((account) => <AccountSummary key={account.linkId} account={account} />) : <span className="text-muted-foreground">{t("portalDirectoryNoRepresentatives")}</span>}</td><td className="max-w-48 space-y-2 px-4 py-4">{[row.selfAccount, ...row.representatives].some((account) => account?.invitationStatus) ? [row.selfAccount, ...row.representatives].filter((account) => account?.invitationStatus).map((account) => <p key={account!.linkId} className="break-words text-xs"><span className="font-medium">{account!.login}</span><br />{t(invitationStatuses[account!.invitationStatus!])}</p>) : <span className="text-muted-foreground">{t("portalDirectoryNoInvitation")}</span>}</td><td className="px-4 py-4 text-xs text-muted-foreground">{dateTime(row.lastSeenAt)}</td></tr>)}</tbody></table></div>;
}
function RepresentativeDirectoryTable({ rows, onOpen, dateTime }: { rows: PortalRepresentativeRow[]; onOpen: (student: PortalDirectoryStudent) => void; dateTime: (value: string | null) => string }) {
  const { t } = useTranslation();
  return <div className="max-w-full overflow-x-auto rounded-lg border"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-muted/50"><tr>{["portalRepresentativeDirectoryName", "portalRepresentativeDirectoryStudents", "portalDirectoryLastSeen"].map((key) => <th key={key} scope="col" className="px-4 py-3 font-medium">{t(key as TranslationKey)}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.accountId} className="border-t align-top"><td className="max-w-64 space-y-1 px-4 py-4"><p className="break-words font-medium">{row.fullName}</p><p className="break-all text-xs text-muted-foreground">{row.login}</p><Badge variant="outline">{t(accountStatuses[row.accountStatus])}</Badge></td><td className="space-y-4 px-4 py-4">{row.students.map(({ student, access }) => <div key={access.linkId} className="space-y-2"><StudentName student={student} onOpen={onOpen} /><div className="flex flex-wrap gap-1">{access.relationship ? <Badge variant="outline">{t(relationships[access.relationship])}</Badge> : null}{access.permissions.map((permission) => <Badge key={permission} variant="secondary">{t(permissionLabels[permission])}</Badge>)}</div>{access.invitationStatus ? <p className="text-xs text-muted-foreground">{t(invitationStatuses[access.invitationStatus])}</p> : null}</div>)}</td><td className="px-4 py-4 text-xs text-muted-foreground">{dateTime(row.lastSeenAt)}</td></tr>)}</tbody></table></div>;
}
