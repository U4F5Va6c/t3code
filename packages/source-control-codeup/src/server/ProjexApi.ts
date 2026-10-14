import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import { readSourceControlHostSettings } from "@t3tools/source-control-core/client/definition";
import {
  WorkItemError,
  WorkItemCategory,
  type WorkItem,
  type WorkItemField,
  type WorkItemType,
  type WorkItemOption,
  type WorkItemValues,
} from "@t3tools/contracts";
import * as CodeupApi from "./CodeupApi.ts";
import * as Definition from "../client/definition.ts";

const objectSchema = Schema.Record(Schema.String, Schema.Unknown);
const object = Schema.decodeUnknownSync(objectSchema);
const array = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown));
const text = Schema.decodeUnknownSync(Schema.String);
const categoryDecoder = Schema.decodeUnknownSync(WorkItemCategory);
const number = Schema.decodeUnknownSync(Schema.Number);
const nullableText = (value: unknown) => (value === null || value === undefined ? "" : text(value));
export const parseOption = (value: unknown): WorkItemOption => {
  const row = object(value);
  return { id: text(row.id), name: nullableText(row.displayName ?? row.name ?? row.displayValue) };
};
export const parseTypes = (value: unknown): readonly WorkItemType[] =>
  array(value).map((v) => {
    const row = object(v);
    return {
      ...parseOption(v),
      category: categoryDecoder(row.categoryId),
    };
  });
export const parseOptions = (value: unknown) => array(value).map(parseOption);
export const parseMembers = (value: unknown) =>
  array(value).map((v) => {
    const row = object(v);
    return { id: text(row.userId), name: text(row.userName) };
  });
export const parseStatuses = (value: unknown) => parseOptions(object(value).statuses);
const isWorkItemCategory = Schema.is(WorkItemCategory);
export const parseRelationTypes = (value: unknown): readonly WorkItemType[] =>
  array(value).flatMap((group) =>
    array(object(group).workitemTypeList).flatMap((value) => {
      const row = object(value);
      const option = parseOption(row);
      const category = text(row.categoryId);
      if (!category.trim()) throw new Error("Missing relation target category");
      // ProjeX advertises Request/Topic alongside the categories this client can operate.
      return isWorkItemCategory(category) ? [{ ...option, category }] : [];
    }),
  );
export const parseRelationIds = (value: unknown) =>
  array(value).map((v) => {
    const row = object(v);
    if (!["WORKITEM", "Req", "Bug", "Task"].includes(text(row.resourceType)))
      throw new Error("Unsupported relation target");
    return { id: text(row.id), targetId: text(row.resourceId) };
  });
export function parseFields(value: unknown): readonly WorkItemField[] {
  return array(value).map((v) => {
    const row = object(v),
      format = text(row.format),
      type = text(row.type);
    const readOnly = format.toLowerCase().includes("auto") || type.toLowerCase().includes("auto");
    const options =
      row.options == null
        ? []
        : array(row.options).map((o) => {
            const option = object(o);
            return { id: text(option.id), name: nullableText(option.displayValue ?? option.value) };
          });
    return {
      id: text(row.id),
      name: text(row.name),
      format,
      type,
      required: row.required === true,
      readOnly,
      supported:
        !readOnly &&
        ["string", "text", "list", "multiList", "user", "multiUser", "number"].includes(format),
      defaultValue:
        typeof row.defaultValue === "string" || typeof row.defaultValue === "number"
          ? row.defaultValue
          : null,
      options,
    };
  });
}
export function parseWorkItem(value: unknown): WorkItem {
  const row = object(value),
    category = categoryDecoder(row.categoryId);
  const values: Record<string, typeof import("@t3tools/contracts").WorkItemValue.Type> = {};
  for (const [key, val] of Object.entries(row)) {
    if (
      val === null ||
      typeof val === "string" ||
      typeof val === "number" ||
      typeof val === "boolean"
    )
      values[key] = val;
    else if (Array.isArray(val) && key !== "customFieldValues")
      values[key] = val.map((v) => (typeof v === "string" ? v : text(object(v).id)));
    else if (val && typeof val === "object" && !Array.isArray(val) && "id" in val)
      values[key] = text(object(val).id);
  }
  for (const v of row.customFieldValues == null ? [] : array(row.customFieldValues)) {
    const field = object(v);
    const entries = array(field.values).map((entry) => text(object(entry).identifier));
    values[text(field.fieldId)] = ["multiList", "multiUser"].includes(String(field.fieldFormat))
      ? entries
      : field.fieldFormat === "number" &&
          entries.length === 1 &&
          entries[0]!.trim() !== "" &&
          Number.isFinite(Number(entries[0]))
        ? Number(entries[0])
        : entries.length === 1
          ? entries[0]!
          : entries;
  }
  const serialNumber = text(row.serialNumber);
  return {
    id: text(row.id),
    serialNumber,
    subject: text(row.subject),
    spaceId: text(object(row.space).id),
    typeId: text(object(row.workitemType).id),
    category,
    gmtModified: number(row.gmtModified),
    formatType: nullableText(row.formatType),
    creatorId: row.creator == null ? "" : text(object(row.creator).id),
    values,
    status: parseOption(row.status),
    assignedTo: row.assignedTo == null ? null : parseOption(row.assignedTo),
    url: `https://devops.aliyun.com/projex/${category.toLowerCase()}/${encodeURIComponent(serialNumber)}`,
  };
}
export function encodeFields(
  fields: readonly WorkItemField[],
  values: WorkItemValues,
  creating: boolean,
) {
  const body: Record<string, unknown> = {};
  const customFieldValues: Record<string, string> = {};
  for (const [id, value] of Object.entries(values)) {
    const field = fields.find((f) => f.id === id);
    if (!field || field.readOnly || !field.supported)
      throw new WorkItemError({ reason: "unsupported-field" });
    const multi = ["multiList", "multiUser"].includes(field.format);
    const empty =
      value == null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && empty) throw new WorkItemError({ reason: "invalid-input" });
    if (
      multi
        ? !Array.isArray(value) || value.some((v) => !v.trim())
        : Array.isArray(value) ||
          (field.format === "number"
            ? typeof value !== "number" || !Number.isFinite(value)
            : typeof value !== "string")
    )
      throw new WorkItemError({ reason: "invalid-input" });
    const entries = Array.isArray(value) ? value : [value];
    if (
      field.options.length &&
      entries.some((entry) => !field.options.some((option) => option.id === entry))
    )
      throw new WorkItemError({ reason: "invalid-input" });
    if (creating && ["CustomField", "SystemCustomField"].includes(field.type))
      customFieldValues[id] = entries.join(",");
    else body[id] = ["CustomField", "SystemCustomField"].includes(field.type) ? entries : value;
  }
  if (creating) {
    for (const field of fields.filter((f) => f.required && !f.readOnly)) {
      const value = values[field.id];
      if (!field.supported) throw new WorkItemError({ reason: "unsupported-field" });
      if (
        value == null ||
        (typeof value === "string" && value.trim() === "") ||
        (Array.isArray(value) && value.length === 0)
      )
        throw new WorkItemError({ reason: "invalid-input" });
    }
    if (Object.keys(customFieldValues).length) body.customFieldValues = customFieldValues;
    body.formatType = "MARKDOWN";
  }
  return body;
}

export class ProjexApi extends Context.Service<
  ProjexApi,
  {
    readonly request: (
      input: CodeupApi.CodeupRequest & { readonly organizationId: string },
    ) => Effect.Effect<unknown, WorkItemError>;
    readonly account: (organizationId: string) => Effect.Effect<WorkItemOption, WorkItemError>;
    readonly verify: (
      organizationId: string,
      expectedAccountId: string,
    ) => Effect.Effect<void, WorkItemError>;
    readonly organizations: Effect.Effect<
      readonly { organizationId: string; viewer: WorkItemOption }[],
      WorkItemError
    >;
  }
>()("@t3tools/source-control-codeup/server/ProjexApi") {}
const make = Effect.gen(function* () {
  const api = yield* CodeupApi.CodeupApi;
  const host = yield* SourceControlHost.SourceControlHost;
  const env = yield* HostProcess.Environment;
  const request = (input: CodeupApi.CodeupRequest & { readonly organizationId: string }) =>
    input.organizationId.trim()
      ? api
          .request(input)
          .pipe(Effect.mapError((cause) => new WorkItemError({ reason: "unavailable", cause })))
      : Effect.fail(new WorkItemError({ reason: "invalid-input" }));
  const viewer = (organizationId: string) =>
    request({ organizationId, operation: "GetUserByToken" }).pipe(
      Effect.flatMap((v) =>
        Effect.try({
          try: () => {
            const row = object(v);
            return { id: text(row.id), name: nullableText(row.name ?? row.username) };
          },
          catch: (cause) => new WorkItemError({ reason: "unavailable", cause }),
        }),
      ),
    );
  return ProjexApi.of({
    request,
    account: viewer,
    verify: (org, expected) =>
      viewer(org).pipe(
        Effect.flatMap((v) =>
          v.id === expected
            ? Effect.void
            : Effect.fail(new WorkItemError({ reason: "account-mismatch" })),
        ),
      ),
    organizations: host.settings.get.pipe(
      Effect.mapError((cause) => new WorkItemError({ reason: "unavailable", cause })),
      Effect.flatMap((settings) =>
        Effect.forEach(
          [
            ...new Set([
              ...Object.keys(
                readSourceControlHostSettings(
                  Definition.settings,
                  settings.sourceControlHosts.codeup,
                ).organizationTokens,
              ),
              ...(env.ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID
                ? [env.ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID]
                : []),
            ]),
          ],
          (organizationId) =>
            viewer(organizationId).pipe(Effect.map((viewer) => ({ organizationId, viewer }))),
        ),
      ),
    ),
  });
});
export const layer = Layer.effect(ProjexApi, make);
