import { enrollmentGroupsKey } from "@/features/groups/queries";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, CreditCard, UserMinus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { OrbitSpinner } from "@/components/ui/orbit-spinner";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useTranslation } from "@/hooks/useTranslation";
import type {
  FutureGroupMember,
  FutureGroupParty,
} from "@shared/contracts/future-groups";
import { futureGroupsApi, futureGroupsKey } from "./api";
import { FutureGroupPaymentDialog } from "./FutureGroupPaymentDialog";

export function FutureGroupMembers({ groupId }: { groupId: number }) {
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
  const add = useMutation({
    mutationFn: (party: FutureGroupParty) =>
      futureGroupsApi.add(groupId, party),
    onSuccess: async () => {
      setSearch("");
      setDebounced("");
      await changed();
    },
    onError: (e: Error) =>
      setError(
        e.message.includes("groupIsFull")
          ? t("groupIsFull")
          : t("futureGroupMemberFailed"),
      ),
  });
  const remove = useMutation({
    mutationFn: (party: FutureGroupParty) =>
      futureGroupsApi.remove(groupId, party),
    onSuccess: async () => {
      setRemoving(null);
      await changed();
    },
    onError: () => setError(t("futureGroupMemberFailed")),
  });
  const busy = add.isPending || remove.isPending;
  const money = (amount: number) =>
    new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US").format(amount);
  const selected = new Set(members.data?.map((m) => `${m.kind}:${m.id}`));
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="future-group-member-search">
          {t("futureGroupFindMember")}
        </Label>
        <Input
          id="future-group-member-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          disabled={busy}
        />
      </div>
      {debounced.length >= 2 && (
        <ul
          className="divide-y rounded-md border"
          aria-label={t("searchResults")}
        >
          {candidates.isPending ? (
            <li className="p-3">
              <OrbitSpinner aria-label={t("loading")} />
            </li>
          ) : candidates.isError ? (
            <li className="p-3 text-sm text-destructive">
              {t("failedToLoadData")}
            </li>
          ) : (
            candidates.data
              ?.filter((m) => !selected.has(`${m.kind}:${m.id}`))
              .map((m) => (
                <li
                  key={`${m.kind}:${m.id}`}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0 break-words text-sm">
                    <p className="font-semibold">
                      {m.studentName || m.contactName}
                    </p>
                    {m.studentName && <p>{m.contactName}</p>}
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
            candidates.data?.filter((m) => !selected.has(`${m.kind}:${m.id}`))
              .length === 0 && (
              <li className="p-3 text-sm">{t("futureGroupNoCandidates")}</li>
            )}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {members.isPending ? (
        <OrbitSpinner aria-label={t("loading")} />
      ) : members.isError ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void members.refetch()}
        >
          {t("retry")}
        </Button>
      ) : (
        <ul className="divide-y" aria-label={t("futureGroupMembers")}>
          {members.data?.map((m) => (
            <li
              key={`${m.kind}:${m.id}`}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <div className="min-w-0 flex-1 break-words text-sm">
                <p className="font-semibold">
                  {m.studentName || m.contactName}
                </p>
                {m.studentName && <p>{m.contactName}</p>}
                <p>{m.managerName}</p>
              </div>
              <span className="text-sm tabular-nums">
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
          ))}
          {members.data?.length === 0 && (
            <li className="py-3 text-sm">{t("futureGroupNoMembers")}</li>
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
