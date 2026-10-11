import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PORTAL_REALTIME_CSRF_PREFIX,
  PORTAL_REALTIME_PATH,
  PORTAL_REALTIME_PROTOCOL,
  portalRealtimeEventSchema,
} from "@shared/contracts/portal-realtime";

type PortalRealtimeScope = {
  accountId: number | null;
  csrfToken?: string;
  linkId: number | null;
  subjectKey: readonly unknown[] | null;
};

/** Hints only invalidate canonical queries; the websocket never carries records or permissions. */
export function usePortalRealtime({
  accountId,
  csrfToken,
  linkId,
  subjectKey,
}: PortalRealtimeScope) {
  const client = useQueryClient();
  const scopeFingerprint = JSON.stringify(subjectKey);
  useEffect(() => {
    if (!accountId || !csrfToken || typeof WebSocket === "undefined") return;
    const currentSubjectKey = JSON.parse(scopeFingerprint) as
      | readonly unknown[]
      | null;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let refresh: ReturnType<typeof setTimeout> | null = null;
    let stable: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    let stopped = false;

    const invalidate = () => {
      refresh = null;
      if (!active) return;
      void client.invalidateQueries({ queryKey: ["portal-session"] });
      void client.invalidateQueries({
        queryKey: ["portal-account", accountId],
      });
      if (currentSubjectKey) {
        void client.invalidateQueries({ queryKey: currentSubjectKey });
      } else {
        void client.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "portal-subject" &&
            query.queryKey[1] === accountId &&
            query.getObserversCount() > 0,
        });
      }
    };
    const scheduleRefresh = () => {
      if (refresh === null) refresh = setTimeout(invalidate, 100);
    };
    const connect = () => {
      reconnect = null;
      if (!active || stopped) return;
      const url = new URL(PORTAL_REALTIME_PATH, window.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      if (linkId !== null) url.searchParams.set("linkId", String(linkId));
      try {
        socket = new WebSocket(url, [
          PORTAL_REALTIME_PROTOCOL,
          `${PORTAL_REALTIME_CSRF_PREFIX}${csrfToken}`,
        ]);
      } catch {
        retry();
        return;
      }
      socket.onopen = () => {
        stable = setTimeout(() => {
          retries = 0;
          stable = null;
        }, 30_000);
      };
      socket.onmessage = (message) => {
        if (
          !active ||
          typeof message.data !== "string" ||
          message.data.length > 1024
        )
          return;
        try {
          const parsed = portalRealtimeEventSchema.safeParse(
            JSON.parse(message.data),
          );
          if (!parsed.success) return;
          if (parsed.data.linkId !== undefined && parsed.data.linkId !== linkId)
            return;
          scheduleRefresh();
        } catch {
          return;
        }
      };
      socket.onclose = (event) => {
        socket = null;
        if (stable !== null) clearTimeout(stable);
        stable = null;
        if (!active) return;
        if (event.code === 1008) {
          stopped = true;
          scheduleRefresh();
          return;
        }
        retry();
      };
    };
    const retry = () => {
      if (!active || stopped || reconnect !== null) return;
      if (retries >= 6) {
        stopped = true;
        return;
      }
      const delay = Math.min(1000 * 2 ** retries, 30_000);
      retries += 1;
      reconnect = setTimeout(connect, delay);
    };
    const resume = () => {
      if (!socket && reconnect === null && !stopped) connect();
    };
    connect();
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    return () => {
      active = false;
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      if (reconnect !== null) clearTimeout(reconnect);
      if (refresh !== null) clearTimeout(refresh);
      if (stable !== null) clearTimeout(stable);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.close();
      }
    };
  }, [accountId, csrfToken, linkId, scopeFingerprint, client]);
}
