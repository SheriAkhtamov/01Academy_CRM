import { performance } from "node:perf_hooks";
import { LmsAcceptanceFailure } from "./lms-api-acceptance-guard";

export type HttpReply<T> = {
  status: number;
  data: T;
  headers: Headers;
  durationMs: number;
};
export class AcceptanceHttpActor {
  private cookies = new Map<string, string>();
  private csrf = "";
  constructor(private readonly baseUrl: string) {}
  copyCookiesFrom(other: AcceptanceHttpActor, names: string[]) {
    for (const name of names) {
      const value = other.cookies.get(name);
      if (value) this.cookies.set(name, value);
    }
  }
  setSeededPortalSession(cookie: string, csrf: string) {
    this.cookies.set("academy.portal.sid", cookie);
    this.csrf = csrf;
  }
  /** Private transport material is consumed only by the local acceptance websocket helper. */
  realtimeAuthentication() {
    return {
      cookie: [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
      csrfToken: this.csrf,
    };
  }
  async request<T>(
    method: string,
    requestPath: string,
    body?: unknown,
    options: {
      expected?: number[];
      omitCsrf?: boolean;
      timeoutMs?: number;
      bytes?: boolean;
    } = {},
  ): Promise<HttpReply<T>> {
    const url = new URL(requestPath, this.baseUrl);
    if (
      url.origin !== this.baseUrl ||
      !url.pathname.startsWith("/api/") ||
      url.username ||
      url.password
    )
      throw new LmsAcceptanceFailure("ACCEPTANCE_HTTP_TARGET_REFUSED");
    const headers = new Headers({
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
    });
    if (this.cookies.size)
      headers.set(
        "Cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    if (
      url.pathname.startsWith("/api/portal/") &&
      !options.omitCsrf &&
      this.csrf
    )
      headers.set("X-Portal-CSRF", this.csrf);
    const form = body instanceof FormData;
    if (body !== undefined && !form)
      headers.set("Content-Type", "application/json");
    const start = performance.now();
    const response = await fetch(url, {
      method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      ...(body === undefined
        ? {}
        : { body: form ? body : JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals);
      const value = pair.slice(equals + 1);
      if (!["academy.sid", "academy.portal.sid"].includes(name)) continue;
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    if (!(options.expected ?? [200]).includes(response.status)) {
      const errorBody = await response.json().catch(() => null);
      const responseCode =
        typeof errorBody?.code === "string" &&
        /^(portal|lms)[A-Za-z0-9]{1,80}$/.test(errorBody.code)
          ? errorBody.code
          : undefined;
      throw new LmsAcceptanceFailure(
        "ACCEPTANCE_HTTP_STATUS",
        response.status,
        responseCode,
      );
    }
    const data = options.bytes
      ? new Uint8Array(await response.arrayBuffer())
      : response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : null;
    if (data && typeof data === "object" && typeof data.csrfToken === "string")
      this.csrf = data.csrfToken;
    return {
      status: response.status,
      data: data as T,
      headers: response.headers,
      durationMs: performance.now() - start,
    };
  }
  get<T>(
    requestPath: string,
    options?: Parameters<AcceptanceHttpActor["request"]>[3],
  ) {
    return this.request<T>("GET", requestPath, undefined, options);
  }
  post<T>(
    requestPath: string,
    body: unknown,
    options?: Parameters<AcceptanceHttpActor["request"]>[3],
  ) {
    return this.request<T>("POST", requestPath, body, options);
  }
  put<T>(
    requestPath: string,
    body: unknown,
    options?: Parameters<AcceptanceHttpActor["request"]>[3],
  ) {
    return this.request<T>("PUT", requestPath, body, options);
  }
}
export class AcceptanceRecorder {
  currentStep = "starting";
  readonly cases: {
    name: string;
    status: "passed" | "failed" | "skipped";
    durationMs: number;
  }[] = [];
  constructor(
    private readonly output: (value: unknown) => void = () => undefined,
  ) {}
  skip(name: string) {
    if (!/^[a-z][a-z0-9_]{3,60}$/.test(name))
      throw new LmsAcceptanceFailure("ACCEPTANCE_CASE_NAME_INVALID");
    const item = { name, status: "skipped" as const, durationMs: 0 };
    this.cases.push(item);
    this.output(item);
  }
  async step<T>(name: string, work: () => Promise<T>): Promise<T> {
    if (!/^[a-z][a-z0-9_]{3,60}$/.test(name))
      throw new LmsAcceptanceFailure("ACCEPTANCE_CASE_NAME_INVALID");
    this.currentStep = name;
    const start = performance.now();
    try {
      const result = await work();
      const item = {
        name,
        status: "passed" as const,
        durationMs: Math.round(performance.now() - start),
      };
      this.cases.push(item);
      this.output(item);
      return result;
    } catch (error) {
      const item = {
        name,
        status: "failed" as const,
        durationMs: Math.round(performance.now() - start),
      };
      this.cases.push(item);
      this.output(item);
      throw error;
    }
  }
}
export function checkAcceptance(
  condition: unknown,
  code = "ACCEPTANCE_ASSERTION_FAILED",
): asserts condition {
  if (!condition) throw new LmsAcceptanceFailure(code);
}
export const acceptanceId = (value: unknown) => {
  const number = Number(value);
  checkAcceptance(
    Number.isSafeInteger(number) && number > 0,
    "ACCEPTANCE_RESPONSE_ID_INVALID",
  );
  return number;
};
export function percentile95(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]);
}
