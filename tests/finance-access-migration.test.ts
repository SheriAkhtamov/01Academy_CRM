import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { ACADEMY_MODULES } from "../shared/academy";
import { insertUserSchema, userModules, users } from "../server/db/schema";
import { createUserSchema, defaultUserFormValues } from "../client/src/features/employees/employeeFormSchema";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(repositoryRoot, "migrations/0047_add_finance_access_module.sql");
const terminologyMigrationPath = path.join(
  repositoryRoot,
  "migrations/0073_rename_workspaces_to_modules.sql",
);
const journalPath = path.join(repositoryRoot, "migrations/meta/_journal.json");
const primaryModuleMigrationPath = path.join(repositoryRoot, "migrations/0121_allow_finance_primary_module.sql");

describe("finance access module migration", () => {
  it("registers the migration after the Financial Center schema", () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));

    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 46)?.tag)
      .toBe("0046_add_financial_center");
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 47)?.tag)
      .toBe("0047_add_finance_access_module");
    expect(journal.entries.filter((entry: { idx: number }) => entry.idx === 47)).toHaveLength(1);
  });

  it("originally added finance to additional employee module assignments", () => {
    const legacyMigration = fs.readFileSync(migrationPath, "utf8");

    expect(legacyMigration).toContain('ALTER TABLE "user_workspaces"');
    expect(legacyMigration).toContain("'finance'");
    expect(legacyMigration).not.toContain('ALTER TABLE "users"');
  });

  it("uses the same module constraint for primary and additional assignments", () => {
    const dialect = new PgDialect();
    for (const table of [users, userModules]) {
      const constraint = getTableConfig(table).checks.find((entry) => entry.name.endsWith("module_check"));
      expect(constraint).toBeDefined();
      const query = dialect.sqlToQuery(constraint!.value);
      expect(query.params).toEqual([]);
      expect([...query.sql.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(ACADEMY_MODULES);
    }
  });

  it("registers the primary-module migration and keeps its values aligned with the shared list", () => {
    const migration = fs.readFileSync(primaryModuleMigrationPath, "utf8");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "users_module_check"');
    expect(migration).toContain('ADD CONSTRAINT "users_module_check"');
    expect([...migration.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(ACADEMY_MODULES);
    expect(migration).not.toMatch(/DELETE FROM|DROP TABLE|UPDATE "users"/);
    expect(journal.entries.filter((entry: { idx: number }) => entry.idx === 121)).toEqual([
      expect.objectContaining({ tag: "0121_allow_finance_primary_module" }),
    ]);
  });

  it.each(ACADEMY_MODULES)("accepts %s in the employee form and persistence validation", (module) => {
    expect(createUserSchema((key) => key).safeParse({
      ...defaultUserFormValues,
      fullName: "Module Employee",
      module,
      modules: [module],
      salesFunnelIds: module === "sales" ? [1] : [],
    }).success).toBe(true);
    expect(insertUserSchema.safeParse({
      email: "employee@example.com",
      password: "hashed",
      fullName: "Module Employee",
      module,
    }).success).toBe(true);
  });

  it("renames the persisted access model without rebuilding employee data", () => {
    const migration = fs.readFileSync(terminologyMigrationPath, "utf8");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));

    expect(migration).toContain('RENAME TO "user_modules"');
    expect(migration).toContain('RENAME COLUMN "workspace" TO "module"');
    expect(migration).not.toContain("DROP TABLE");
    expect(migration).not.toContain("DELETE FROM");
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 73)?.tag)
      .toBe("0073_rename_workspaces_to_modules");
    expect(journal.entries.filter((entry: { idx: number }) => entry.idx === 73)).toHaveLength(1);
  });
});
