import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { WorkItemError } from "@t3tools/contracts";
export interface ReceiptKey {
  readonly environmentId: string;
  readonly organizationId: string;
  readonly viewer: string;
  readonly clientRequestId: string;
}
export interface CreationReceipt {
  readonly spaceId: string;
  readonly typeId: string;
  readonly payloadHash: string;
  readonly status: "pending" | "unknown" | "created";
  readonly itemId: string | null;
}
export class WorkItemCreationReceiptRepository extends Context.Service<
  WorkItemCreationReceiptRepository,
  {
    readonly get: (key: ReceiptKey) => Effect.Effect<CreationReceipt | undefined, WorkItemError>;
    readonly reserve: (
      key: ReceiptKey,
      value: Omit<CreationReceipt, "status" | "itemId">,
    ) => Effect.Effect<boolean, WorkItemError>;
    readonly record: (key: ReceiptKey, itemId: string | null) => Effect.Effect<void, WorkItemError>;
  }
>()("t3/persistence/WorkItemCreationReceiptRepository") {}
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const failure = (cause: unknown) => new WorkItemError({ reason: "unavailable", cause });
  const get = (k: ReceiptKey) =>
    sql<CreationReceipt>`SELECT space_id AS "spaceId", type_id AS "typeId", payload_hash AS "payloadHash", status, item_id AS "itemId" FROM work_item_creation_receipts WHERE environment_id=${k.environmentId} AND organization_id=${k.organizationId} AND viewer=${k.viewer} AND client_request_id=${k.clientRequestId}`.pipe(
      Effect.map((rows) => rows[0]),
      Effect.mapError(failure),
    );
  return WorkItemCreationReceiptRepository.of({
    get,
    reserve: (k, v) =>
      sql`INSERT INTO work_item_creation_receipts(environment_id,organization_id,viewer,client_request_id,space_id,type_id,payload_hash,status) VALUES(${k.environmentId},${k.organizationId},${k.viewer},${k.clientRequestId},${v.spaceId},${v.typeId},${v.payloadHash},'pending') ON CONFLICT DO NOTHING RETURNING client_request_id`.pipe(
        Effect.map((rows) => rows.length === 1),
        Effect.mapError(failure),
      ),
    record: (k, id) =>
      sql`UPDATE work_item_creation_receipts SET status=${id === null ? "unknown" : "created"},item_id=${id} WHERE environment_id=${k.environmentId} AND organization_id=${k.organizationId} AND viewer=${k.viewer} AND client_request_id=${k.clientRequestId} AND item_id IS NULL`.pipe(
        Effect.asVoid,
        Effect.mapError(failure),
      ),
  });
});
export const layer = Layer.effect(WorkItemCreationReceiptRepository, make);
