import { randomUUID } from "~/lib/utils";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { WorkItemCreateInput as CreateInputSchema } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import {
  EnvironmentId,
  type WorkItemCategory,
  type WorkItemField,
  type WorkItemMetadata,
  type WorkItemValues,
  type WorkItem,
  type WorkItemCreateInput,
  type WorkItemRelationType,
} from "@t3tools/contracts";
import { environmentCatalog } from "~/connection/catalog";
import { workItemsEnvironment as api } from "~/state/workItems";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  initialWorkItemValues,
  workItemFormProblem,
  changedWorkItemFields,
  canCorrectCreation,
} from "./workItemForm";

const EMPTY_METADATA: WorkItemMetadata = {
  types: [],
  members: [],
  fields: [],
  statuses: [],
  relationTypes: [],
};

const decodePendingCreate = Schema.decodeUnknownSync(CreateInputSchema);

function Field({
  field,
  metadata,
  value,
  onChange,
}: {
  field: WorkItemField;
  metadata: WorkItemMetadata;
  value: WorkItemValues[string] | undefined;
  onChange: (value: WorkItemValues[string]) => void;
}) {
  const multiple = field.format.startsWith("multi");
  const options = field.format.toLowerCase().includes("user") ? metadata.members : field.options;
  return (
    <label className="grid gap-1 text-sm">
      <span>
        {field.name}
        {field.required ? " *" : ""}
      </span>
      {!field.supported ? (
        <span className="text-muted-foreground">
          {field.readOnly ? "Calculated by ProjeX" : "Edit this field in ProjeX"}
        </span>
      ) : options.length ||
        field.format.toLowerCase().includes("list") ||
        field.format.toLowerCase().includes("user") ? (
        <select
          className="rounded border bg-background p-2"
          multiple={multiple}
          value={
            multiple
              ? Array.isArray(value)
                ? [...value]
                : value == null || value === ""
                  ? []
                  : [String(value)]
              : String(value ?? "")
          }
          onChange={(e) =>
            onChange(
              multiple
                ? Array.from(e.target.selectedOptions, (o) => o.value).filter(Boolean)
                : e.target.value,
            )
          }
        >
          {!multiple ? <option value="">Choose…</option> : null}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : field.id === "description" || field.format === "text" ? (
        <Textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          type={field.format === "number" ? "number" : field.format === "date" ? "date" : "text"}
          value={String(value ?? "")}
          onChange={(e) =>
            onChange(
              field.format === "number" && e.target.value !== ""
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
export function WorkItemsPage() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environments = [...catalog.entries].filter(([, e]) => e.enabled);
  const [selected, setSelected] = useState("");
  const id = selected || environments[0]?.[0];
  return (
    <main className="flex h-full flex-col gap-4 overflow-auto p-6">
      <header>
        <h1 className="text-xl font-semibold">Work Items</h1>
        <p className="text-sm text-muted-foreground">ProjeX requirements, bugs, and tasks.</p>
      </header>
      <label>
        Environment{" "}
        <select
          className="rounded border bg-background p-2"
          value={id ?? ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          {environments.map(([id]) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      {id ? (
        <Organization key={id} environmentId={EnvironmentId.make(id)} />
      ) : (
        <p>Connect an environment to use work items.</p>
      )}
    </main>
  );
}
function Organization({ environmentId }: { environmentId: EnvironmentId }) {
  const [organizationId, setOrganizationId] = useState("");
  const [lookup, setLookup] = useState("");
  const [choice, setChoice] = useState("");
  const connections = useEnvironmentQuery(
    api.connections({ environmentId, input: lookup ? { organizationId: lookup } : {} }),
  );
  const connectionOptions = connections.data ?? [];
  const active = connectionOptions.find((c) => c.organizationId === choice);
  return (
    <>
      <div className="flex items-end gap-2">
        <label>
          Organization ID
          <Input value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} />
        </label>
        <Button
          onClick={() => {
            if (lookup === organizationId.trim()) connections.refresh();
            setLookup(organizationId.trim());
            setChoice(organizationId.trim());
          }}
          disabled={!organizationId.trim()}
        >
          Load organization
        </Button>
      </div>
      {connections.error ? <p role="alert">{connections.error}</p> : null}
      {connectionOptions.length ? (
        <label>
          Account and organization{" "}
          <select
            className="rounded border bg-background p-2"
            value={active?.organizationId ?? ""}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Choose an organization…</option>
            {connectionOptions.map((c) => (
              <option key={c.organizationId} value={c.organizationId}>
                {c.organizationId} · {c.viewer.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>
          Add an organization token in Source Control settings, or enter the organization used by
          this environment’s CLI.
        </p>
      )}
      {active ? (
        <Space
          key={`${active.organizationId}:${active.viewer.id}`}
          environmentId={environmentId}
          organizationId={active.organizationId}
          expectedAccountId={active.viewer.id}
        />
      ) : null}
    </>
  );
}
type Target = { environmentId: EnvironmentId; organizationId: string; expectedAccountId: string };
function Space(target: Target) {
  const { environmentId, ...input } = target;
  const [page, setPage] = useState(1),
    [space, setSpace] = useState("");
  const projects = useEnvironmentQuery(api.projects({ environmentId, input: { ...input, page } }));
  const { items: projectItems = [], nextPage = null } = projects.data ?? {};
  return (
    <>
      <label>
        Project{" "}
        <select
          className="rounded border bg-background p-2"
          value={space}
          onChange={(e) => setSpace(e.target.value)}
        >
          <option value="">Choose a project…</option>
          {projectItems.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {projects.error ? <p role="alert">{projects.error}</p> : null}
      <Button variant="outline" onClick={() => projects.refresh()}>
        Refresh projects
      </Button>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous projects
        </Button>
        <Button
          variant="outline"
          disabled={nextPage === null}
          onClick={() => {
            if (nextPage !== null) setPage(nextPage);
          }}
        >
          More projects
        </Button>
      </div>
      {space ? <Items key={space} {...target} spaceId={space} /> : null}
    </>
  );
}
type SpaceTarget = Target & { spaceId: string };
function Items(target: SpaceTarget) {
  const { environmentId, ...scope } = target;
  const [category, setCategory] = useState<WorkItemCategory>("Task");
  const [page, setPage] = useState(1);
  const [subject, setSubject] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [typeId, setTypeId] = useState("");
  const metadata = useEnvironmentQuery(
    api.metadata({ environmentId, input: { ...scope, category, ...(typeId ? { typeId } : {}) } }),
  );
  const items = useEnvironmentQuery(
    api.search({
      environmentId,
      input: {
        ...scope,
        category,
        page,
        ...(subject ? { subject } : {}),
        ...(owner ? { assignedTo: owner } : {}),
        ...(status ? { statusId: status } : {}),
      },
    }),
  );
  const metadataValue = metadata.data ?? EMPTY_METADATA;
  const { items: workItems = [], nextPage = null } = items.data ?? {};
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          Category
          <select
            className="block rounded border bg-background p-2"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as WorkItemCategory);
              setTypeId("");
              setStatus("");
              setPage(1);
            }}
          >
            {["Req", "Bug", "Task"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select
            className="block rounded border bg-background p-2"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
          >
            <option value="">Choose type for fields and states…</option>
            {metadataValue.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title contains
          <Input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Owner
          <select
            className="block rounded border bg-background p-2"
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All owners</option>
            {metadataValue.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            className="block rounded border bg-background p-2"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All states</option>
            {metadataValue.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={!typeId} onClick={() => setCreating((v) => !v)}>
          Create work item
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            items.refresh();
            metadata.refresh();
          }}
        >
          Refresh
        </Button>
      </div>
      {metadata.error || items.error ? <p role="alert">{metadata.error ?? items.error}</p> : null}
      {creating && metadata.data && typeId ? (
        <CreateItem
          key={`${category}:${typeId}`}
          {...target}
          typeId={typeId}
          category={category}
          metadata={metadataValue}
          onCreated={(id) => {
            setSelected(id);
            setCreating(false);
            items.refresh();
          }}
        />
      ) : null}
      <div className="grid gap-2">
        {workItems.map((item) => (
          <Button key={item.id} variant="outline" onClick={() => setSelected(item.id)}>
            {item.serialNumber} · {item.subject} · {item.status.name}
          </Button>
        ))}
        {items.data !== null && workItems.length === 0 ? <p>No matching work items.</p> : null}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span>Page {page}</span>
        <Button
          variant="outline"
          disabled={nextPage === null}
          onClick={() => {
            if (nextPage !== null) setPage(nextPage);
          }}
        >
          Next
        </Button>
      </div>
      {selected ? (
        <Detail key={selected} {...target} id={selected} onUpdated={items.refresh} />
      ) : null}
    </>
  );
}
function CreateItem({
  metadata,
  onCreated,
  ...target
}: SpaceTarget & {
  category: WorkItemCategory;
  typeId: string;
  metadata: WorkItemMetadata;
  onCreated: (id: string) => void;
}) {
  const storageKey = JSON.stringify(["work-item-create", target]);
  const [pending, setPending] = useState<WorkItemCreateInput | null>(() => {
    try {
      return localStorage.getItem(storageKey)
        ? decodePendingCreate(JSON.parse(localStorage.getItem(storageKey)!))
        : null;
    } catch {
      return null;
    }
  });
  const [values, setValues] = useState<WorkItemValues>(
    () => pending?.values ?? initialWorkItemValues(metadata.fields),
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState("");
  const create = useAtomCommand(api.create),
    recover = useAtomCommand(api.recover);
  const allowed = useAtomValue(api.create.permissionAtom(target.environmentId));
  const receipt = useEnvironmentQuery(
    pending
      ? api.receipt({
          environmentId: target.environmentId,
          input: {
            organizationId: target.organizationId,
            expectedAccountId: target.expectedAccountId,
            clientRequestId: pending.clientRequestId,
          },
        })
      : null,
  );
  const { status: receiptStatus = "checking", itemId: createdItemId = null } = receipt.data ?? {};
  const problem = workItemFormProblem(metadata.fields, values);
  const finish = (id: string) => {
    localStorage.removeItem(storageKey);
    setPending(null);
    onCreated(id);
  };
  return (
    <section className="grid gap-3 rounded border p-4">
      <h2>Create work item</h2>
      {metadata.fields.map((field) => (
        <fieldset key={field.id} disabled={!!pending || busy}>
          <Field
            field={field}
            metadata={metadata}
            value={values[field.id]}
            onChange={(v) => setValues((previous) => ({ ...previous, [field.id]: v }))}
          />
        </fieldset>
      ))}
      {problem ? <p role="alert">{problem}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {pending ? (
        <>
          <p>
            Request {pending.clientRequestId}: {receiptStatus}. This request will not be submitted
            again.
          </p>
          <Button variant="outline" onClick={() => receipt.refresh()}>
            Check creation receipt
          </Button>
          {createdItemId ? (
            <Button onClick={() => finish(createdItemId)}>Open created item</Button>
          ) : (
            <>
              <label>
                Existing item ID to verify and recover
                <Input value={candidate} onChange={(e) => setCandidate(e.target.value)} />
              </label>
              <Button
                disabled={!candidate || busy || !allowed}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await recover({
                      environmentId: target.environmentId,
                      input: { ...pending, candidateId: candidate },
                    });
                    if (r._tag === "Success" && r.value.itemId) finish(r.value.itemId);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Verify candidate
              </Button>
            </>
          )}
        </>
      ) : (
        <Button
          disabled={!!problem || busy || !allowed}
          onClick={async () => {
            const { environmentId, ...scope } = target;
            const input = { ...scope, values, clientRequestId: randomUUID() };
            localStorage.setItem(storageKey, JSON.stringify(input));
            setPending(input);
            setBusy(true);
            try {
              const r = await create({ environmentId, input });
              if (r._tag === "Success" && r.value.itemId) finish(r.value.itemId);
              else if (r._tag === "Failure" && canCorrectCreation(r.cause)) {
                localStorage.removeItem(storageKey);
                setPending(null);
                setMessage("No work item was submitted. Correct the fields and try again.");
              } else
                setMessage("Creation was not confirmed. Keep this request and check its receipt.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Create
        </Button>
      )}
    </section>
  );
}
function Detail({
  environmentId,
  onUpdated,
  ...scope
}: SpaceTarget & { id: string; onUpdated: () => void }) {
  const query = useEnvironmentQuery(api.get({ environmentId, input: scope }));
  const update = useAtomCommand(api.update),
    relate = useAtomCommand(api.relate);
  const allowed = useAtomValue(api.update.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false),
    [targetId, setTargetId] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [relationType, setRelationType] = useState<WorkItemRelationType>("DEPEND_ON");
  const [terminal, setTerminal] = useState<string[]>([]);
  const [check, setCheck] = useState(false);
  const ready = useEnvironmentQuery(
    check ? api.ready({ environmentId, input: { ...scope, terminalStatusIds: terminal } }) : null,
  );
  const { item = null, metadata = EMPTY_METADATA, relations = [] } = query.data ?? {};
  const { ready: isReady = false, blockers = [] } = ready.data ?? {};
  const allowedTargets =
    metadata.relationTypes.find((r) => r.relationType === relationType)?.types ?? [];
  const save = async (changes: WorkItemValues) => {
    if (!item) return;
    setBusy(true);
    setMutationError(null);
    try {
      const result = await update({
        environmentId,
        input: {
          ...scope,
          expectedModified: item.gmtModified,
          ...changedWorkItemFields(item, { ...item.values, ...changes }),
        },
      });
      if (result._tag === "Success") {
        setCheck(false);
        query.refresh();
        onUpdated();
      } else {
        setMutationError(Cause.pretty(result.cause));
        query.refresh();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-3 rounded border p-4">
      {query.error ? <p role="alert">{query.error}</p> : null}
      {mutationError ? <p role="alert">{mutationError}</p> : null}
      {item ? (
        <>
          <h2 className="text-lg font-semibold">
            {item.serialNumber} · {item.subject}
          </h2>
          <a href={item.url} target="_blank" rel="noreferrer">
            Open in ProjeX
          </a>
          <p>
            {item.status.name} · {item.assignedTo?.name ?? "No owner"}
          </p>
          <p className="text-sm text-muted-foreground">
            Updates check the last read version; refresh after conflicts. ProjeX decides which state
            transitions are allowed.
          </p>
          <Button
            disabled={!allowed || busy}
            onClick={() => save({ assignedTo: scope.expectedAccountId })}
          >
            Assign to me
          </Button>
          <label>
            Change workflow state
            <select
              className="rounded border bg-background p-2"
              disabled={!allowed || busy}
              value={item.status.id}
              onChange={(e) => save({ status: e.target.value })}
            >
              {metadata.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <EditItem
            key={`${item.id}:${item.gmtModified}`}
            item={item}
            metadata={metadata}
            disabled={!allowed || busy}
            save={save}
          />
          <h3>Relationships</h3>
          {relations.map((r) => (
            <div key={`${r.relationType}:${r.id}`} className="flex items-center gap-2">
              <span>
                {r.relationType}: {r.target.serialNumber} · {r.target.subject}
              </span>
              <Button
                variant="outline"
                disabled={!allowed || busy}
                onClick={async () => {
                  setBusy(true);
                  setMutationError(null);
                  try {
                    const result = await relate({
                      environmentId,
                      input: {
                        ...scope,
                        targetId: r.target.id,
                        relationType: r.relationType,
                        remove: true,
                        expectedModified: item.gmtModified,
                      },
                    });
                    if (result._tag === "Success") {
                      setCheck(false);
                      query.refresh();
                      onUpdated();
                    } else {
                      setMutationError(Cause.pretty(result.cause));
                      query.refresh();
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove relation
              </Button>
            </div>
          ))}
          <label>
            Relationship
            <select
              className="rounded border bg-background p-2"
              value={relationType}
              onChange={(e) => setRelationType(e.target.value as WorkItemRelationType)}
            >
              {metadata.relationTypes.map((r) => (
                <option key={r.relationType} value={r.relationType}>
                  {r.relationType} ({r.types.map((t) => t.name).join(", ") || "not allowed"})
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            Relations here support Req, Bug and Task targets only.
          </p>
          {allowedTargets.length === 0 ? (
            <p role="status">
              No supported target types are configured for {relationType}. Ask an organization
              administrator to configure relationships between these work item types, or manage
              other categories in ProjeX.
            </p>
          ) : null}
          <label>
            Target work item ID
            <Input value={targetId} onChange={(e) => setTargetId(e.target.value)} />
          </label>
          <Button
            disabled={!allowed || busy || !targetId || allowedTargets.length === 0}
            onClick={async () => {
              setBusy(true);
              setMutationError(null);
              try {
                const result = await relate({
                  environmentId,
                  input: {
                    ...scope,
                    targetId,
                    relationType,
                    remove: false,
                    expectedModified: item.gmtModified,
                  },
                });
                if (result._tag === "Success") {
                  setCheck(false);
                  query.refresh();
                  onUpdated();
                } else {
                  setMutationError(Cause.pretty(result.cause));
                  query.refresh();
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Add relation
          </Button>
          <label>
            Dependency states accepted as complete
            <select
              multiple
              className="rounded border bg-background p-2"
              value={terminal}
              onChange={(e) => {
                setTerminal(Array.from(e.target.selectedOptions, (o) => o.value));
                setCheck(false);
              }}
            >
              {relations
                .filter((r) => r.relationType === "DEPEND_ON")
                .flatMap((r) =>
                  r.statuses.map((s) => (
                    <option key={`${r.target.id}:${s.id}`} value={s.id}>
                      {r.target.serialNumber}: {s.name}
                    </option>
                  )),
                )}
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() => {
              setCheck(true);
              ready.refresh();
            }}
          >
            Check all prerequisites
          </Button>
          {ready.error ? (
            <p role="alert">Readiness unknown: {ready.error}</p>
          ) : ready.data ? (
            <p>
              {isReady
                ? "All prerequisites meet the selected states."
                : `Blocked by ${blockers.map((i) => i.serialNumber).join(", ")}`}
            </p>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              setCheck(false);
              query.refresh();
            }}
          >
            Refresh detail
          </Button>
        </>
      ) : (
        <p>Loading work item…</p>
      )}
    </section>
  );
}
function EditItem({
  item,
  metadata,
  disabled,
  save,
}: {
  item: WorkItem;
  metadata: WorkItemMetadata;
  disabled: boolean;
  save: (changes: WorkItemValues) => Promise<void>;
}) {
  const [values, setValues] = useState<WorkItemValues>({});
  return (
    <details>
      <summary>Edit fields</summary>
      <div className="grid gap-3 py-3">
        {metadata.fields.map((field) => (
          <fieldset
            disabled={disabled || (field.id === "description" && item.formatType !== "MARKDOWN")}
            key={field.id}
          >
            <Field
              field={field}
              metadata={metadata}
              value={values[field.id] ?? item.values[field.id]}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.id]: v }))}
            />
          </fieldset>
        ))}
        {item.formatType !== "MARKDOWN" ? (
          <p>Rich text descriptions must be edited in ProjeX.</p>
        ) : null}
        <Button
          disabled={disabled || Object.keys(values).length === 0}
          onClick={() => save(values)}
        >
          Save changed fields
        </Button>
      </div>
    </details>
  );
}
