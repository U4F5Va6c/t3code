import * as Cause from "effect/Cause";
import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const queries = vi.hoisted(() => ({
  values: new Map<string, { data: unknown; error: null; refresh: () => void }>(),
  listeners: new Set<() => void>(),
  update: vi.fn(),
  empty: { data: null, error: null, refresh: () => {} },
}));
vi.mock("~/lib/utils", () => ({ randomUUID: () => "request" }));
vi.mock("~/connection/catalog", () => ({ environmentCatalog: { catalogValueAtom: "catalog" } }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "catalog" ? { entries: new Map([["env", { enabled: true }]]) } : true,
}));
vi.mock("~/state/workItems", () => {
  const query = (key: string) => () => key;
  const command = Object.assign(
    async () => ({ _tag: "Success", value: { itemId: null, status: "pending" } }),
    { permissionAtom: () => null },
  );
  return {
    workItemsEnvironment: {
      connections: query("connections"),
      projects: query("projects"),
      metadata: query("metadata"),
      search: query("search"),
      get: query("get"),
      receipt: query("receipt"),
      ready: query("ready"),
      create: command,
      recover: command,
      update: Object.assign(queries.update, { permissionAtom: () => null }),
      relate: command,
    },
  };
});
vi.mock("~/state/query", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useEnvironmentQuery: (key: string | null) =>
      useSyncExternalStore(
        (listener) => {
          queries.listeners.add(listener);
          return () => {
            queries.listeners.delete(listener);
          };
        },
        () => queries.values.get(key ?? "") ?? queries.empty,
      ),
  };
});
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) =>
    createElement("button", props, children),
}));
vi.mock("../ui/input", () => ({ Input: (props: object) => createElement("input", props) }));
vi.mock("../ui/textarea", () => ({
  Textarea: (props: object) => createElement("textarea", props),
}));
import { WorkItemsPage } from "./WorkItemsPage";

it("survives loading, loaded and cleared queries while navigating projects, items, details and receipts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        organizationId: "org",
        expectedAccountId: "viewer",
        spaceId: "space",
        category: "Task",
        typeId: "type",
        clientRequestId: "request",
        values: { subject: "Item" },
      }),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  });
  queries.values.clear();
  queries.update.mockReset();
  let renderer: ReactTestRenderer | undefined;
  const publish = async (key: string, data: unknown) =>
    act(() => {
      queries.values.set(key, { data, error: null, refresh: () => {} });
      for (const notify of queries.listeners) notify();
    });
  const choose = async (label: string, value: string) =>
    act(() => {
      const element = renderer!.root
        .findAllByType("label")
        .find((node) =>
          node.children.some((child) => typeof child === "string" && child.trim() === label),
        );
      expect(element).toBeDefined();
      element!.findByType("select").props.onChange({ target: { value } });
    });
  const click = async (text: string) =>
    act(() => {
      const button = renderer!.root
        .findAllByType("button")
        .find((node) =>
          node.children.some((child) => typeof child === "string" && child.includes(text)),
        );
      expect(button).toBeDefined();
      return button!.props.onClick();
    });
  const metadata = {
    types: [{ id: "type", name: "Task", category: "Task" }],
    fields: [],
    members: [],
    statuses: [],
    relationTypes: [],
  };
  const item = {
    id: "item",
    serialNumber: "P-1",
    subject: "Item",
    spaceId: "space",
    typeId: "type",
    category: "Task",
    gmtModified: 1,
    formatType: "MARKDOWN",
    creatorId: "viewer",
    values: {},
    status: { id: "todo", name: "Todo" },
    assignedTo: null,
    url: "https://example.test/item",
  };
  try {
    await act(() => {
      renderer = create(createElement(WorkItemsPage));
    });
    await publish("connections", [
      { organizationId: "org", viewer: { id: "viewer", name: "Viewer" } },
    ]);
    await choose("Account and organization", "org");
    // Space initially has null project data, then a page, then null again.
    await publish("projects", { items: [{ id: "space", name: "Project" }], nextPage: null });
    await publish("projects", null);
    await publish("projects", { items: [{ id: "space", name: "Project" }], nextPage: null });
    await choose("Project", "space");
    await publish("metadata", metadata);
    await publish("search", { items: [item], nextPage: null });
    await publish("metadata", null);
    await publish("search", null);
    await publish("metadata", metadata);
    await publish("search", { items: [item], nextPage: null });
    await click("P-1");
    await publish("get", { item, metadata, relations: [] });
    await click("Check all prerequisites");
    await publish("ready", { ready: true, complete: true, blockers: [] });
    await publish("ready", null);
    await publish("get", null);
    await publish("get", { item, metadata, relations: [] });
    const tags = {
      id: "tags",
      name: "Tags",
      format: "multiList",
      type: "CustomField",
      required: false,
      readOnly: false,
      supported: true,
      defaultValue: null,
      options: [{ id: "one", name: "One" }],
    };
    await publish("get", { item, metadata: { ...metadata, fields: [tags] }, relations: [] });
    const tagsSelect = () =>
      renderer!.root
        .findAllByType("select")
        .find((node) =>
          node.findAllByType("option").some((option) => option.props.value === "one"),
        )!;
    expect(tagsSelect().props.value).toEqual([]);
    expect(
      tagsSelect()
        .findAllByType("option")
        .some((option) => option.props.value === ""),
    ).toBe(false);
    await act(() =>
      tagsSelect().props.onChange({ target: { selectedOptions: [{ value: "one" }] } }),
    );
    await act(() => tagsSelect().props.onChange({ target: { selectedOptions: [] } }));
    const updated = { ...item, subject: "Updated", status: { id: "done", name: "Done" } };
    const refresh = vi.fn(() => {
      queries.values.set("search", {
        data: { items: [updated], nextPage: null },
        error: null,
        refresh,
      });
      for (const notify of queries.listeners) notify();
    });
    await act(() => {
      queries.values.set("search", {
        data: { items: [item], nextPage: null },
        error: null,
        refresh,
      });
      for (const notify of queries.listeners) notify();
    });
    queries.update.mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(new Error("Version conflict")),
    });
    await click("Save changed fields");
    expect(refresh).not.toHaveBeenCalled();
    expect(
      renderer!.root
        .findAllByProps({ role: "alert" })
        .some((node) =>
          node.children.some(
            (child) => typeof child === "string" && child.includes("Version conflict"),
          ),
        ),
    ).toBe(true);
    queries.update.mockResolvedValueOnce({ _tag: "Success", value: updated });
    await click("Save changed fields");
    expect(queries.update.mock.lastCall?.[0].input.changes).toEqual({ tags: [] });
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      renderer!.root
        .findAllByType("button")
        .some((node) => node.children.includes("Updated") && node.children.includes("Done")),
    ).toBe(true);
    await choose("Type", "type");
    await click("Create work item");
    await publish("receipt", {
      status: "pending",
      itemId: null,
      item: null,
      clientRequestId: "request",
    });
    await publish("receipt", null);
    expect(
      renderer!.root
        .findAllByType("button")
        .some((node) => node.children.includes("Check creation receipt")),
    ).toBe(true);
  } finally {
    if (renderer) await act(() => renderer!.unmount());
    vi.unstubAllGlobals();
    queries.listeners.clear();
    queries.values.clear();
  }
});
