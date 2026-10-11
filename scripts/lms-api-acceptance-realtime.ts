import WebSocket from "ws";
import {
  PORTAL_REALTIME_PATH,
  PORTAL_REALTIME_PROTOCOL,
  PORTAL_REALTIME_CSRF_PREFIX,
  portalRealtimeEventSchema,
} from "../shared/contracts/portal-realtime";
import { LmsAcceptanceFailure } from "./lms-api-acceptance-guard";
import {
  AcceptanceHttpActor,
  checkAcceptance,
} from "./lms-api-acceptance-http";

export type AcceptanceRealtimeClient = {
  socket: WebSocket;
  received: number;
  invalid: boolean;
  closed: Promise<number>;
};
type HandshakeOptions = {
  badOrigin?: boolean;
  badCsrf?: boolean;
  expectedDenial?: number[];
};
const wait = (delay: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delay));

/** Every connection uses its actor's signed cookie; CSRF never appears in the URL or output. */
export async function openAcceptanceRealtime(
  actor: AcceptanceHttpActor,
  baseUrl: string,
  linkId: number,
  options: HandshakeOptions = {},
): Promise<AcceptanceRealtimeClient | null> {
  const origin = new URL(baseUrl);
  checkAcceptance(
    ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname),
    "ACCEPTANCE_WS_TARGET_REFUSED",
  );
  const url = new URL(PORTAL_REALTIME_PATH, origin);
  url.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  checkAcceptance(
    Number.isSafeInteger(linkId) && linkId > 0,
    "ACCEPTANCE_WS_LINK_INVALID",
  );
  url.searchParams.set("linkId", String(linkId));
  const authentication = actor.realtimeAuthentication();
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await new Promise<{
      client: AcceptanceRealtimeClient | null;
      status?: number;
    }>((resolve, reject) => {
      const socket = new WebSocket(
        url,
        [
          PORTAL_REALTIME_PROTOCOL,
          `${PORTAL_REALTIME_CSRF_PREFIX}${options.badCsrf ? "x".repeat(43) : authentication.csrfToken || "x".repeat(43)}`,
        ],
        {
          headers: {
            Cookie: authentication.cookie,
            Origin: options.badOrigin
              ? "https://foreign-origin.invalid"
              : origin.origin,
          },
          handshakeTimeout: 10_000,
          perMessageDeflate: false,
        },
      );
      let closedResolve!: (code: number) => void;
      const client: AcceptanceRealtimeClient = {
        socket,
        received: 0,
        invalid: false,
        closed: new Promise<number>((done) => {
          closedResolve = done;
        }),
      };
      let settled = false;
      const finish = (status?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (status !== undefined) {
          socket.terminate();
          resolve({ client: null, status });
        } else resolve({ client });
      };
      const fail = (code: string) => {
        if (settled) {
          client.invalid = true;
          socket.terminate();
          return;
        }
        settled = true;
        clearTimeout(deadline);
        socket.terminate();
        reject(new LmsAcceptanceFailure(code));
      };
      const deadline = setTimeout(() => fail("ACCEPTANCE_WS_TIMEOUT"), 12_000);
      socket.on("unexpected-response", (_request, response) => {
        response.resume();
        finish(response.statusCode ?? 0);
      });
      socket.on("error", () => {
        if (!settled) fail("ACCEPTANCE_WS_CONNECT_FAILED");
      });
      socket.on("close", (code) => {
        closedResolve(code);
        if (!settled) fail("ACCEPTANCE_WS_CLOSED_BEFORE_HINT");
      });
      socket.on("message", (body) => {
        const bytes = Array.isArray(body)
          ? Buffer.concat(body)
          : Buffer.isBuffer(body)
            ? body
            : Buffer.from(body);
        const parsed =
          bytes.byteLength <= 1024
            ? (() => {
                try {
                  return portalRealtimeEventSchema.safeParse(
                    JSON.parse(bytes.toString()),
                  );
                } catch {
                  return null;
                }
              })()
            : null;
        if (
          !parsed?.success ||
          parsed.data.linkId !== linkId ||
          socket.protocol !== PORTAL_REALTIME_PROTOCOL
        ) {
          fail("ACCEPTANCE_WS_RECORD_INVALID");
          return;
        }
        client.received += 1;
        finish();
      });
    });
    if (result.status === 429 || result.status === 503) {
      if (attempt < 4) {
        await wait(200 * 2 ** attempt);
        continue;
      }
      throw new LmsAcceptanceFailure(
        "ACCEPTANCE_WS_CAPACITY_RETRY_EXHAUSTED",
        result.status,
      );
    }
    if (options.expectedDenial) {
      if (result.client) {
        await closeAcceptanceRealtime(result.client);
        throw new LmsAcceptanceFailure("ACCEPTANCE_WS_UNEXPECTED_ACCESS");
      }
      checkAcceptance(
        options.expectedDenial.includes(result.status ?? 0),
        "ACCEPTANCE_WS_DENIAL_INVALID",
      );
      return null;
    }
    checkAcceptance(result.client, "ACCEPTANCE_WS_HANDSHAKE_DENIED");
    return result.client;
  }
  throw new LmsAcceptanceFailure("ACCEPTANCE_WS_CONNECT_FAILED");
}
export async function closeAcceptanceRealtime(
  client: AcceptanceRealtimeClient,
) {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  client.socket.close(1000);
  await closedWithin(client, 1000);
  if (Number(client.socket.readyState) !== WebSocket.CLOSED)
    client.socket.terminate();
}
export async function requireAcceptancePolicyClose(
  client: AcceptanceRealtimeClient,
) {
  const code = await closedWithin(client, 45_000);
  checkAcceptance(code === 1008, "ACCEPTANCE_WS_REVOKE_NOT_CLOSED");
}
function closedWithin(client: AcceptanceRealtimeClient, timeoutMs: number) {
  return new Promise<number | null>((resolve) => {
    const deadline = setTimeout(() => resolve(null), timeoutMs);
    void client.closed.then((code) => {
      clearTimeout(deadline);
      resolve(code);
    });
  });
}
