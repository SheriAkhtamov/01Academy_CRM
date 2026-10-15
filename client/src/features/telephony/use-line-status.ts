import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OwnTelephonyLineStatus } from '@shared/contracts/telephony-lines';
import { telephonyApi, telephonyQueryKeys } from './api';

const STATUS_LIFETIME_MS = 15_000;
const POLL_INTERVAL_MS = 2_500;
type LineSnapshot = OwnTelephonyLineStatus & { epoch: object; receivedAt: number; fromStatus: boolean };

/** One observer per phone provider; individual call buttons share its result. */
export function useTelephonyLineStatus(actorId: number | null, extension: string | null, ready: boolean) {
  const queryClient = useQueryClient();
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const owner = `${actorId ?? ''}:${extension ?? ''}`;
  const scopeRef = useRef({ owner, epoch: {}, revision: 0 });
  if (scopeRef.current.owner !== owner) scopeRef.current = { owner, epoch: {}, revision: 0 };
  const scope = scopeRef.current;
  const queryKey = useMemo(() => telephonyQueryKeys.lineStatus(actorId, extension), [actorId, extension]);
  const [foreground, setForeground] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'visible');
  const [, expireSnapshot] = useState(0);
  const enabled = Boolean(actorId && extension && ready && foreground);
  const status = useQuery({
    queryKey,
    queryFn: async (): Promise<LineSnapshot> => {
      const revision = scope.revision;
      const result = await telephonyApi.getLineStatus();
      if (revision !== scope.revision) {
        const current = queryClient.getQueryData<LineSnapshot>(queryKey);
        if (current?.epoch === scope.epoch) return current;
        throw new Error('onlinePbxUnavailable');
      }
      return { ...result, epoch: scope.epoch, receivedAt: Date.now(), fromStatus: true };
    },
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: enabled ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    structuralSharing: false,
  });
  const refetch = status.refetch;
  const refresh = useCallback(() => {
    if (actorId && extension && readyRef.current && document.visibilityState === 'visible') void refetch({ cancelRefetch: false });
  }, [actorId, extension, refetch]);

  useEffect(() => {
    const visibility = () => {
      const visible = document.visibilityState === 'visible';
      setForeground(visible);
      if (visible) refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);

  const snapshot = status.data?.epoch === scope.epoch ? status.data : undefined;
  useEffect(() => {
    if (!snapshot?.busyWithReminder) return;
    const remaining = snapshot.receivedAt + STATUS_LIFETIME_MS - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => expireSnapshot(value => value + 1), remaining);
    return () => window.clearTimeout(timer);
  }, [snapshot]);
  const isLineBusyWithReminder = Boolean(snapshot?.busyWithReminder && Date.now() - snapshot.receivedAt < STATUS_LIFETIME_MS);

  const priorityRef = useRef<{ scope: typeof scope; running: boolean; succeeded: boolean; attemptedAt: number } | null>(null);
  const priorityBaselineRef = useRef<LineSnapshot | undefined>();
  useEffect(() => {
    if (!enabled || !isLineBusyWithReminder) {
      priorityRef.current = null;
      priorityBaselineRef.current = snapshot;
      return;
    }
    if (!snapshot?.fromStatus || snapshot === priorityBaselineRef.current) return;
    let episode = priorityRef.current;
    if (!episode || episode.scope !== scope) {
      episode = { scope, running: false, succeeded: false, attemptedAt: Number.NEGATIVE_INFINITY };
      priorityRef.current = episode;
    }
    if (episode.running || episode.succeeded || Date.now() - episode.attemptedAt < POLL_INTERVAL_MS) return;
    episode.running = true;
    episode.attemptedAt = Date.now();
    const ownEpisode = episode;
    void telephonyApi.requestLinePriority().then((receipt) => {
      if (scopeRef.current !== scope || priorityRef.current !== ownEpisode) return;
      ownEpisode.succeeded = receipt.busyWithReminder;
      // A late priority ACK must never overwrite a newer GET/free snapshot.
      refresh();
    }).catch(() => undefined).finally(() => { ownEpisode.running = false; });
  }, [enabled, isLineBusyWithReminder, refresh, scope, snapshot]);

  const markBusy = useCallback(() => {
    if (scopeRef.current !== scope) return;
    scope.revision += 1;
    queryClient.setQueryData<LineSnapshot>(queryKey, {
      busyWithReminder: true, epoch: scope.epoch, receivedAt: Date.now(), fromStatus: false,
    });
    refresh();
  }, [queryClient, queryKey, refresh, scope]);

  return { isLineBusyWithReminder, markBusy, refresh };
}
