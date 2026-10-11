// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePortalRealtime } from "../client/src/features/portal-app/realtime";

class FakePortalSocket {
  static instances: FakePortalSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn();
  constructor(
    public url: URL,
    public protocols: string[],
  ) {
    FakePortalSocket.instances.push(this);
  }
  opened() {
    this.onopen?.(new Event("open"));
  }
  hint(value: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
  closed(code: number) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}
let client: QueryClient;
let invalidated: ReturnType<typeof vi.spyOn>;
const scope = {
  accountId: 50,
  csrfToken: "secret-csrf",
  linkId: 10,
  subjectKey: ["portal-subject", 50, 10, 20, "self", "feedback.read"],
};
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function hint(linkId?: number) {
  return {
    type: "portal.refresh",
    ...(linkId === undefined ? {} : { linkId }),
    serverTime: "2026-10-11T12:00:00.000Z",
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  FakePortalSocket.instances = [];
  vi.stubGlobal("WebSocket", FakePortalSocket);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidated = vi
    .spyOn(client, "invalidateQueries")
    .mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("sends CSRF only in websocket protocols and skips anonymous accounts", () => {
  const rendered = renderHook((props) => usePortalRealtime(props), {
    initialProps: { ...scope, accountId: null as number | null },
    wrapper,
  });
  expect(FakePortalSocket.instances).toHaveLength(0);
  rendered.rerender(scope);
  const socket = FakePortalSocket.instances[0];
  expect(socket.url.pathname).toBe("/api/portal/ws");
  expect(socket.url.search).toBe("?linkId=10");
  expect(String(socket.url)).not.toContain(scope.csrfToken);
  expect(socket.protocols).toEqual(["portal.v1", "csrf.secret-csrf"]);
});

it("debounces valid current-subject hints and ignores foreign or malformed records", () => {
  renderHook(() => usePortalRealtime(scope), { wrapper });
  const socket = FakePortalSocket.instances[0];
  act(() => {
    socket.hint(hint(11));
    socket.hint({ ...hint(10), records: ["forbidden"] });
    socket.hint({ ...hint(10), serverTime: "not-a-date" });
    vi.advanceTimersByTime(100);
  });
  expect(invalidated).not.toHaveBeenCalled();
  act(() => {
    socket.hint(hint(10));
    socket.hint(hint());
    vi.advanceTimersByTime(100);
  });
  expect(invalidated.mock.calls).toEqual([
    [{ queryKey: ["portal-session"] }],
    [{ queryKey: ["portal-account", 50] }],
    [{ queryKey: scope.subjectKey }],
  ]);
});

it("closes the previous child socket and cancels queued refresh when context changes or logs out", () => {
  const rendered = renderHook((props) => usePortalRealtime(props), {
    initialProps: { ...scope, accountId: scope.accountId as number | null },
    wrapper,
  });
  const previous = FakePortalSocket.instances[0];
  act(() => previous.hint(hint(10)));
  rendered.rerender({
    ...scope,
    linkId: 11,
    subjectKey: [
      "portal-subject",
      50,
      11,
      21,
      "representative",
      "feedback.read",
    ],
  });
  expect(previous.close).toHaveBeenCalledOnce();
  expect(previous.onmessage).toBeNull();
  act(() => vi.advanceTimersByTime(100));
  expect(invalidated).not.toHaveBeenCalled();
  const selected = FakePortalSocket.instances[1];
  expect(selected.url.search).toBe("?linkId=11");
  rendered.rerender({ ...scope, accountId: null });
  expect(selected.close).toHaveBeenCalledOnce();
  expect(FakePortalSocket.instances).toHaveLength(2);
});

it("keeps one connection for ordinary form renders and renews it when effective permissions change", () => {
  const rendered = renderHook((props) => usePortalRealtime(props), {
    initialProps: scope,
    wrapper,
  });
  rendered.rerender({ ...scope, subjectKey: [...scope.subjectKey] });
  expect(FakePortalSocket.instances).toHaveLength(1);
  rendered.rerender({
    ...scope,
    subjectKey: [...scope.subjectKey.slice(0, 5), "learning.read"],
  });
  expect(FakePortalSocket.instances[0].close).toHaveBeenCalledOnce();
  expect(FakePortalSocket.instances).toHaveLength(2);
});

it("refreshes canonical authorization after policy closure and does not repeatedly reconnect", () => {
  renderHook(() => usePortalRealtime(scope), { wrapper });
  act(() => {
    FakePortalSocket.instances[0].closed(1008);
    vi.advanceTimersByTime(100);
  });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ["portal-session"] });
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(300_000);
  });
  expect(FakePortalSocket.instances).toHaveLength(1);
});

it("bounds transport reconnects and removes retry timers on unmount", () => {
  const rendered = renderHook(() => usePortalRealtime(scope), { wrapper });
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
    act(() => FakePortalSocket.instances.at(-1)!.closed(1012));
    act(() => vi.advanceTimersByTime(delay - 1));
    const count = FakePortalSocket.instances.length;
    act(() => vi.advanceTimersByTime(1));
    expect(FakePortalSocket.instances).toHaveLength(count + 1);
  }
  act(() => {
    FakePortalSocket.instances.at(-1)!.closed(1011);
    vi.advanceTimersByTime(300_000);
    window.dispatchEvent(new Event("online"));
  });
  expect(FakePortalSocket.instances).toHaveLength(7);
  rendered.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps family refresh restricted to actively observed queries for the current account", () => {
  renderHook(
    () => usePortalRealtime({ ...scope, linkId: null, subjectKey: null }),
    { wrapper },
  );
  const socket = FakePortalSocket.instances[0];
  expect(socket.url.search).toBe("");
  act(() => {
    socket.hint(hint());
    vi.advanceTimersByTime(100);
  });
  const predicate = invalidated.mock.calls[2][0].predicate as (query: {
    queryKey: unknown[];
    getObserversCount: () => number;
  }) => boolean;
  expect(
    predicate({
      queryKey: ["portal-subject", 50, 10],
      getObserversCount: () => 1,
    }),
  ).toBe(true);
  expect(
    predicate({
      queryKey: ["portal-subject", 51, 10],
      getObserversCount: () => 1,
    }),
  ).toBe(false);
  expect(
    predicate({
      queryKey: ["portal-subject", 50, 10],
      getObserversCount: () => 0,
    }),
  ).toBe(false);
});
