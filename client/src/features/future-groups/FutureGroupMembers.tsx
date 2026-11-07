import { enrollmentGroupsKey } from "@/features/groups/queries";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  Plus,
  Search,
  UserMinus,
  UserRound,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { OrbitSpinner } from "@/components/ui/orbit-spinner";
import ConfirmDialog from "@/components/ConfirmDialog";
import { GroupSeatMeter } from "@/features/groups/GroupSeatMeter";
import type { GroupSeats } from "@/features/groups/presentation";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import type {
  FutureGroupMember,
  FutureGroupParty,
} from "@shared/contracts/future-groups";
import { futureGroupsApi, futureGroupsKey } from "./api";
import { FutureGroupPaymentDialog } from "./FutureGroupPaymentDialog";

const KNOWN_MEMBER_ERRORS = [
  "groupIsFull",
  "futureGroupArchivedLead",
  "archivedStudentMustBeRestoredBeforeUpdate",
  "futureGroupStudentUnavailable",
  "futureGroupUnavailable",
  "futureGroupChanged",
  "accessDenied",
] as const;

export function FutureGroupMembers({
  groupId,
  maxStudents,
  occupiedSeats,
  paidMembersCount,
  paidTotalUzs,
}: {
  groupId: number;
  maxStudents?: number;
  occupiedSeats?: number;
  paidMembersCount?: number;
  paidTotalUzs?: number;
}) {
  const { t, language } = useTranslation();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<FutureGroupMember | null>(null);
  const [paying, setPaying] = useState<FutureGroupMember | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const members = useQuery({
    queryKey: ["future-group-members", groupId],
    queryFn: () => futureGroupsApi.members(groupId),
  });
  const candidates = useQuery({
    queryKey: ["future-group-candidates", debounced],
    queryFn: () => futureGroupsApi.candidates(debounced),
    enabled: debounced.length >= 2,
  });
  const changed = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: futureGroupsKey }),
      client.invalidateQueries({ queryKey: enrollmentGroupsKey }),
      client.invalidateQueries({ queryKey: ["future-group-members", groupId] }),
      client.invalidateQueries({
        queryKey: ["/api/academy/group-configuration"],
      }),
    ]);
  };
  const resolveMemberError = (e: Error & { rawMessage?: string }) => {
    const code = e.rawMessage ?? e.message;
    const key = KNOWN_MEMBER_ERRORS.find(
      (k) => code.includes(k) || e.message.includes(k) || e.message === t(k),
    );
    return key ? t(key) : t("futureGroupMemberFailed");
  };
  const add = useMutation({
    mutationFn: (party: FutureGroupParty) =>
      futureGroupsApi.add(groupId, party),
    onSuccess: async () => {
      setSearch("");
      setDebounced("");
      await changed();
    },
    onError: (e: Error & { rawMessage?: string }) =>
      setError(resolveMemberError(e)),
  });
  const remove = useMutation({
    mutationFn: (party: FutureGroupParty) =>
      futureGroupsApi.remove(groupId, party),
    onSuccess: async () => {
      setRemoving(null);
      await changed();
    },
    onError: (e: Error & { rawMessage?: string }) =>
      setError(resolveMemberError(e)),
  });
  const busy = add.isPending || remove.isPending;
  const money = (amount: number) =>
    new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US").format(amount);
  const memberList = members.data ?? [];
  const selected = new Set(memberList.map((m) => `${m.kind}:${m.id}`));
  const filteredCandidates =
    candidates.data?.filter((m) => !selected.has(`${m.kind}:${m.id}`)) ?? [];

  const effectiveMax = maxStudents ?? 0;
  const effectiveOccupied = Math.max(occupiedSeats ?? 0, memberList.length);
  const effectiveFree = Math.max(0, effectiveMax - effectiveOccupied);
  const effectivePaidMembers =
    paidMembersCount ?? memberList.filter((m) => m.paidAmountUzs > 0).length;
  const effectivePaidTotal =
    paidTotalUzs ?? memberList.reduce((sum, m) => sum + m.paidAmountUzs, 0);
  const seats: GroupSeats | null =
    effectiveMax > 0
      ? {
          current: effectiveOccupied,
          reserved: 0,
          occupied: effectiveOccupied,
          max: effectiveMax,
          free: effectiveFree,
          sellable: true,
          tone:
            effectiveFree === 0
              ? "full"
              : effectiveFree <= 2 && effectiveMax > 2
                ? "few"
                : "available",
        }
      : null;

  return (
    <div className="space-y-3">
      {seats ? (
        <div className="space-y-2 rounded-lg border border-border/70 bg-muted/25 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold tabular-nums text-foreground">
              {t("futureGroupOccupied")}: {seats.occupied} / {seats.max}
            </span>
            <div className="flex flex-wrap items-center gap-3 tabular-nums">
              <span
                className={cn(
                  "font-medium",
                  seats.tone === "full"
                    ? "text-rose-700 dark:text-rose-300"
                    : seats.tone === "few"
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-emerald-700 dark:text-emerald-300",
                )}
              >
                {t("futureGroupFree")}: {seats.free}
              </span>
              <span className="font-medium text-muted-foreground">
                {t("futureGroupPaid")}: {effectivePaidMembers}
                {effectivePaidTotal > 0
                  ? ` (${money(effectivePaidTotal)} ${t("currencyUzs")})`
                  : ""}
              </span>
            </div>
          </div>
          <GroupSeatMeter seats={seats} size="lg" />
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="future-group-member-search">
          {t("futureGroupFindMember")}
        </Label>
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="future-group-member-search"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            disabled={busy}
          />
        </div>
      </div>

      {debounced.length >= 2 && (
        <ul
          className="divide-y rounded-lg border bg-card shadow-2xs"
          aria-label={t("searchResults")}
        >
          {candidates.isPending ? (
            <li className="flex items-center justify-center p-3">
              <OrbitSpinner aria-label={t("loading")} />
            </li>
          ) : candidates.isError ? (
            <li className="p-3 text-sm text-destructive">
              {t("failedToLoadData")}
            </li>
          ) : (
            filteredCandidates.map((m) => (
              <li
                key={`${m.kind}:${m.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                    aria-hidden="true"
                  >
                    <UserRound className="size-3.5" />
                  </span>
                  <div className="min-w-0 break-words text-sm">
                    <p className="font-semibold text-foreground">
                      {m.studentName || m.contactName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[m.studentName ? m.contactName : null, m.managerName]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    add.mutate({ kind: m.kind, id: m.id });
                  }}
                >
                  <Plus aria-hidden />
                  {t("add")}
                </Button>
              </li>
            ))
          )}
          {!candidates.isPending &&
            !candidates.isError &&
            filteredCandidates.length === 0 && (
              <li className="p-3 text-center text-sm text-muted-foreground">
                {t("futureGroupNoCandidates")}
              </li>
            )}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive"
        >
          {error}
        </p>
      )}

      {members.isPending ? (
        <div className="flex items-center justify-center py-4">
          <OrbitSpinner aria-label={t("loading")} />
        </div>
      ) : members.isError ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void members.refetch()}
        >
          {t("retry")}
        </Button>
      ) : (
        <ul
          className="divide-y rounded-lg border bg-card"
          aria-label={t("futureGroupMembers")}
        >
          {memberList.map((m) => {
            const hasPaid = m.paidAmountUzs > 0;
            return (
              <li
                key={`${m.kind}:${m.id}`}
                className="flex flex-wrap items-center gap-3 px-3 py-2.5"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    hasPaid
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  <UserRound className="size-4" />
                </span>
                <div className="min-w-0 flex-1 break-words text-sm">
                  <p className="font-semibold text-foreground">
                    {m.studentName || m.contactName}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {m.studentName && <span>{m.contactName}</span>}
                    {m.managerName && <span>{m.managerName}</span>}
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
                    hasPaid
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border/70 bg-muted/40 text-muted-foreground",
                  )}
                >
                  {money(m.paidAmountUzs)} {t("currencyUzs")}
                </span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={busy || !m.canManage}
                    aria-label={t("futureGroupRecordPayment")}
                    onClick={() => setPaying(m)}
                  >
                    <CreditCard aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy || !m.canManage}
                    aria-label={t("futureGroupRemoveMember")}
                    onClick={() => {
                      setError("");
                      setRemoving(m);
                    }}
                  >
                    <UserMinus aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
          {memberList.length === 0 && (
            <li className="flex flex-col items-center justify-center gap-1 py-6 text-center text-sm text-muted-foreground">
              <Users className="size-5 opacity-50" aria-hidden="true" />
              <span>{t("futureGroupNoMembers")}</span>
            </li>
          )}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
        title={t("futureGroupRemoveMember")}
        description={removing?.studentName || removing?.contactName || ""}
        confirmLabel={t("removeFromGroup")}
        variant="destructive"
        isPending={remove.isPending}
        error={error}
        keepOpenOnConfirm
        onConfirm={() => {
          if (removing) remove.mutate({ kind: removing.kind, id: removing.id });
        }}
      />
      {paying && (
        <FutureGroupPaymentDialog
          groupId={groupId}
          member={paying}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
}
