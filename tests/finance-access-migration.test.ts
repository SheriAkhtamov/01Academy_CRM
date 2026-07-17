import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(repositoryRoot, "migrations/0047_add_finance_access_module.sql");
const schemaPath = path.join(repositoryRoot, "shared/schema.ts");
const journalPath = path.join(repositoryRoot, "migrations/meta/_journal.json");

describe("finance access module migration", () => {
  it("registers the migration after the Financial Center schema", () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));

    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 46)?.tag)
      .toBe("0046_add_financial_center");
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 47)?.tag)
      .toBe("0047_add_finance_access_module");
    expect(journal.entries.filter((entry: { idx: number }) => entry.idx === 47)).toHaveLength(1);
  });

  it("allows finance only in additional employee module assignments", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    const schema = fs.readFileSync(schemaPath, "utf8");
    const usersTable = schema.slice(
      schema.indexOf('export const users = pgTable("users"'),
      schema.indexOf('export const notifications = pgTable("notifications"'),
    );

    expect(migration).toContain('ALTER TABLE "user_workspaces"');
    expect(migration).toContain("'finance'");
    expect(migration).not.toContain('ALTER TABLE "users"');
    expect(schema).toMatch(/userWorkspaces[\s\S]+?workspace_check[\s\S]+?'finance'/);
    expect(usersTable).toContain('check("users_workspace_check"');
    expect(usersTable).toContain("'administration', 'sales', 'teacher', 'marketing'");
    expect(usersTable).not.toContain("'finance'");
  });
});
