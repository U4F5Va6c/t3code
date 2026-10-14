import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE work_item_creation_receipts (
    environment_id TEXT NOT NULL, organization_id TEXT NOT NULL, viewer TEXT NOT NULL,
    client_request_id TEXT NOT NULL, space_id TEXT NOT NULL, type_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','unknown','created')),
    item_id TEXT,
    PRIMARY KEY(environment_id, organization_id, viewer, client_request_id)
  ) WITHOUT ROWID`;
});
