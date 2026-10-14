import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import WorkItemCreationReceipts from "./CodeupMigrations/001_WorkItemCreationReceipts.ts";

const run = Migrator.make({});

// Fork migrations use their own ledger so upstream can keep assigning sequential ids.
export const runCodeupMigrations = Effect.fn("runCodeupMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
        AND name IN ('effect_sql_migrations', 'work_item_creation_receipts')
      `;
      const legacy = tables.some((table) => table.name === "effect_sql_migrations")
        ? yield* sql`
            SELECT migration_id FROM effect_sql_migrations
            WHERE migration_id = 62 AND name = 'WorkItemCreationReceipts'
          `
        : [];
      // Work Items is retired; only migrate databases that already contain its state.
      if (
        legacy.length === 0 &&
        !tables.some((table) => table.name === "work_item_creation_receipts")
      )
        return;
      if (
        legacy.length > 0 &&
        !tables.some((table) => table.name === "work_item_creation_receipts")
      ) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: "The recorded Codeup WorkItemCreationReceipts migration is missing its table.",
        });
      }
      yield* run({
        table: "codeup_sql_migrations",
        loader: Migrator.fromRecord({
          "1_WorkItemCreationReceipts": legacy.length > 0 ? Effect.void : WorkItemCreationReceipts,
        }),
      });
      if (legacy.length > 0) {
        // Transfer only the known released Fork entry; its table and receipts stay intact.
        yield* sql`
          UPDATE codeup_sql_migrations SET created_at = (
            SELECT created_at FROM effect_sql_migrations
            WHERE migration_id = 62 AND name = 'WorkItemCreationReceipts'
          ) WHERE migration_id = 1 AND name = 'WorkItemCreationReceipts'
        `;
        yield* sql`
          DELETE FROM effect_sql_migrations
          WHERE migration_id = 62 AND name = 'WorkItemCreationReceipts'
        `;
      }
    }),
  );
});
