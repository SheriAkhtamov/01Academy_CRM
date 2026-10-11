import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPortalWebSocketGateway,
  type PortalWebSocketGateway,
} from "../server/realtime/portal-websocket-gateway";
import {
  PortalIdentityService,
  createPortalCrypto,
  createPostgresPortalRepository,
} from "../server/modules/portal-identity";
import { PORTAL_COOKIE_NAME } from "../server/infrastructure/portal-session";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `portal_ws_${randomBytes(8).toString("hex")}`;
const sessionId = "a".repeat(43),
  csrf = "c".repeat(43),
  secret = "isolated-websocket-query-count-secret",
  origin = "http://portal.example.test";
let admin: Pool,
  pool: Pool,
  server: Server,
  gateway: PortalWebSocketGateway,
  client: WebSocket;
const statements: string[] = [];
const frame = () =>
  new Promise<void>((resolve) => client.once("message", () => resolve()));

describe.skipIf(!databaseUrl)(
  "portal WebSocket actual PostgreSQL authorization work",
  () => {
    beforeAll(async () => {
      if (
        !databaseUrl ||
        !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
          new URL(databaseUrl).hostname,
        )
      )
        throw new Error("Local isolated PostgreSQL required");
      admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema} -c timezone=UTC`,
      });
      await pool.query(
        "CREATE TABLE users(id serial PRIMARY KEY); CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text,manager_id integer)",
      );
      await pool.query(
        readFileSync(
          new URL("../migrations/0134_portal_identity.sql", import.meta.url),
          "utf8",
        ),
      );
      await pool.query(`INSERT INTO users DEFAULT VALUES; INSERT INTO academy_students(student_name,contact_name,manager_id) VALUES('Learner','Learner',1);
      INSERT INTO portal_student_identity(student_id,classification,verification_method,verified_at,verified_by) VALUES(1,'adult','in_person',now(),1);
      INSERT INTO portal_accounts(login,full_name,status,password_hash) VALUES('learner.login','Learner','active','unused-hash');
      INSERT INTO portal_student_links(account_id,student_id,kind,status,permissions,verified_at) VALUES(1,1,'self','active','["learning.read"]',now());`);
      await pool.query(
        "INSERT INTO portal_sessions(id,account_id,auth_version,created_at,last_seen_at,absolute_expires_at,csrf_token) VALUES($1,1,1,now(),now(),now()+interval '1 hour',$2)",
        [sessionId, csrf],
      );
      const observedPool = {
        query: (sql: string, values: unknown[] = []) => {
          statements.push(sql);
          return pool.query(sql, values);
        },
      } as unknown as Pool;
      const identity = new PortalIdentityService(
        createPostgresPortalRepository(observedPool),
        createPortalCrypto(),
        { appUrl: origin, allowInvitations: false, emailEnabled: false },
      );
      server = createServer((_request, response) => response.end());
      gateway = createPortalWebSocketGateway(server, {
        identity,
        sessionSecret: secret,
        appUrl: origin,
        enabled: () => true,
        isActorEnabled: () => true,
        readRevision: async () => "stable",
        heartbeatMs: 60000,
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected local HTTP port");
      client = new WebSocket(
        `ws://127.0.0.1:${address.port}/api/portal/ws?linkId=1`,
        ["portal.v1", `csrf.${csrf}`],
        {
          headers: {
            Origin: origin,
            Cookie: `${PORTAL_COOKIE_NAME}=${sessionId}.${createHmac("sha256", secret).update(sessionId).digest("base64url")}`,
          },
        },
      );
      const initial = frame();
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      await initial;
    });
    afterAll(async () => {
      client?.terminate();
      await gateway?.close();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      if (pool) await pool.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    it("uses two current identity snapshots per delivery pass, including an unchanged revision", async () => {
      for (let index = 0; index < 2; index++) {
        statements.length = 0;
        const delivered = index === 0 ? frame() : null;
        await gateway.refresh();
        if (delivered) await delivered;
        expect(statements).toHaveLength(2);
        expect(
          statements.filter((sql) =>
            sql.includes("WITH valid_session AS MATERIALIZED"),
          ),
        ).toHaveLength(1);
        expect(
          statements.filter((sql) =>
            /UPDATE portal_sessions(?:\s+\w+)? SET last_seen_at/.test(sql),
          ),
        ).toHaveLength(1);
        expect(
          statements.filter((sql) =>
            sql.includes("AS consents"),
          ),
        ).toHaveLength(1);
      }
      const closed = new Promise<number>((resolve) =>
        client.once("close", (code) => resolve(code)),
      );
      await pool.query(
        "UPDATE portal_accounts SET auth_version=auth_version+1 WHERE id=1",
      );
      await gateway.refresh();
      expect(await closed).toBe(1008);
    });
  },
);
