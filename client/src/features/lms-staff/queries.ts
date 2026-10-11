import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lmsStaffApi } from "./api";
export const lmsStaffKey = ["lms-management"] as const;
const staffRefreshInterval = 30_000;
export function useStaffQuery<T>(
  name: string,
  runId: number | null,
  load: (signal: AbortSignal) => Promise<T>,
  extra: unknown[] = [],
) {
  return useQuery({
    queryKey: [...lmsStaffKey, name, runId, ...extra],
    queryFn: ({ signal }) => load(signal),
    enabled: runId !== null,
    staleTime: 15000,
    refetchInterval: staffRefreshInterval,
    refetchIntervalInBackground: false,
  });
}
export function useStaffRuns() {
  return useQuery({
    queryKey: [...lmsStaffKey, "runs"],
    queryFn: ({ signal }) => lmsStaffApi.runs(signal),
    staleTime: 15000,
    refetchInterval: staffRefreshInterval,
    refetchIntervalInBackground: false,
  });
}
export function useStaffInvalidate() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: lmsStaffKey });
}
