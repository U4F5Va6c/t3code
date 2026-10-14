import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { runCodeupMigrations } from "./CodeupMigrations.ts";
import WorkItemCreationReceipts from "./CodeupMigrations/001_WorkItemCreationReceipts.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";

const receipt = {
  environment_id: "environment",
  organization_id: "organization",
  viewer: "viewer",
  client_request_id: "request",
  space_id: "space",
  type_id: "type",
  payload_hash: "hash",
  status: "created",
  item_id: "item",
};

describe("Codeup migrations", () => {
  it.effect("does not create retired work item tables in new databases", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* runMigrations();
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE name IN ('work_item_creation_receipts', 'codeup_sql_migrations')`,
        [],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("preserves released Fork tables without consuming upstream migration ids", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Migrator.make({})({
        table: "codeup_sql_migrations",
        loader: Migrator.fromRecord({ "1_WorkItemCreationReceipts": WorkItemCreationReceipts }),
      });
      yield* runMigrations();
      yield* sql`INSERT INTO work_item_creation_receipts ${sql.insert(receipt)}`;
      yield* runMigrations();

      assert.deepStrictEqual(yield* sql`SELECT * FROM work_item_creation_receipts`, [receipt]);
      assert.deepStrictEqual(yield* sql`SELECT migration_id, name FROM codeup_sql_migrations`, [
        { migration_id: 1, name: "WorkItemCreationReceipts" },
      ]);
      assert.deepStrictEqual(
        yield* sql`SELECT migration_id FROM effect_sql_migrations WHERE name = 'WorkItemCreationReceipts'`,
        [],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades released Fork databases without losing receipts or skipping upstream", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* WorkItemCreationReceipts;
      yield* sql`INSERT INTO work_item_creation_receipts ${sql.insert(receipt)}`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        VALUES (62, 'WorkItemCreationReceipts', '2026-10-14 00:00:00')
      `;

      yield* runMigrations();
      yield* runMigrations();

      assert.deepStrictEqual(yield* sql`SELECT * FROM work_item_creation_receipts`, [receipt]);
      assert.deepStrictEqual(
        yield* sql`SELECT migration_id, name, created_at FROM codeup_sql_migrations`,
        [{ migration_id: 1, name: "WorkItemCreationReceipts", created_at: "2026-10-14 00:00:00" }],
      );
      const upstream = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        upstream.map((row) => [row.migration_id, row.name] as const),
        migrationManifest,
      );

      const nextId = Math.max(...migrationManifest.map(([id]) => id)) + 1;
      yield* Migrator.make({})({
        loader: Migrator.fromRecord({
          [`${nextId}_NextUpstreamMigration`]: sql`CREATE TABLE next_upstream (id INTEGER)`,
        }),
      });
      yield* sql`INSERT INTO next_upstream (id) VALUES (1)`;
      assert.deepStrictEqual(yield* sql`SELECT * FROM next_upstream`, [{ id: 1 }]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("leaves upstream or unknown entries at 62 untouched", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (62, 'ThreadFailureLookupIndex')
      `;
      yield* runCodeupMigrations();
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM effect_sql_migrations WHERE migration_id = 62`,
        [{ name: "ThreadFailureLookupIndex" }],
      );
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE name = 'work_item_creation_receipts'`,
        [],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("preserves the legacy ledger if its recorded receipt table is missing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (62, 'WorkItemCreationReceipts')
      `;
      const exit = yield* Effect.exit(runMigrations());
      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "WorkItemCreationReceipts migration is missing its table");
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM effect_sql_migrations WHERE migration_id = 62`,
        [{ name: "WorkItemCreationReceipts" }],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rolls back a failed ledger transfer and can retry without losing receipts", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* WorkItemCreationReceipts;
      yield* sql`INSERT INTO work_item_creation_receipts ${sql.insert(receipt)}`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (62, 'WorkItemCreationReceipts')
      `;
      yield* sql`
        CREATE TRIGGER reject_transfer BEFORE DELETE ON effect_sql_migrations
        WHEN OLD.migration_id = 62
        BEGIN SELECT RAISE(ABORT, 'blocked ledger transfer'); END
      `;

      assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE name = 'codeup_sql_migrations'`,
        [],
      );
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM effect_sql_migrations WHERE migration_id = 62`,
        [{ name: "WorkItemCreationReceipts" }],
      );
      yield* sql`DROP TRIGGER reject_transfer`;
      yield* runMigrations();
      assert.deepStrictEqual(yield* sql`SELECT * FROM work_item_creation_receipts`, [receipt]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
