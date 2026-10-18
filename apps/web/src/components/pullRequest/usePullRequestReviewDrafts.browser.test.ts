import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
const connection = vi.hoisted(() => ({ phase: "offline" }));
const commands = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("~/state/presentation", () => ({
  useEnvironmentPresentation: () => ({ presentation: { connection: { phase: connection.phase } } }),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("~/state/pullRequests", () => ({
  pullRequestEnvironment: {
    listReviewDrafts: commands.list,
    createReviewDraft: Object.assign(commands.create, { permissionAtom: () => null }),
    updateReviewDraft: commands.update,
    deleteReviewDraft: commands.remove,
  },
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
import {
  discardReviewDrafts,
  hasUnreviewedDraftHead,
  privateReviewDraftKey,
  usePullRequestReviewDrafts,
} from "./usePullRequestReviewDrafts";
it("keeps failed deletions instead of clearing all drafts", async () => {
  const remaining = new Set(["one", "two", "three"]);
  const removed = await discardReviewDrafts([...remaining], async (id) => id !== "two");
  for (const id of removed) remaining.delete(id);
  expect([...remaining]).toEqual(["two"]);
});
it("does not treat a fresh draft-list head as a head the reviewer already inspected", () => {
  const revision = { headSha: "new", baseSha: "base", fromPatchSetId: "b", toPatchSetId: "s" };
  expect(hasUnreviewedDraftHead("old", "old", revision)).toBe(true);
  expect(hasUnreviewedDraftHead("old", "new", revision)).toBe(true);
  expect(hasUnreviewedDraftHead("new", "new", revision)).toBe(false);
});
it("isolates private drafts across actual viewers and environments", () => {
  const ref = { projectId: ProjectId.make("p"), repository: "org/repo", number: 1 };
  const a = privateReviewDraftKey(EnvironmentId.make("env"), ref, "viewer-a");
  expect(privateReviewDraftKey(EnvironmentId.make("env"), ref, "viewer-b")).not.toBe(a);
  expect(privateReviewDraftKey(EnvironmentId.make("other"), ref, "viewer-a")).not.toBe(a);
  expect(privateReviewDraftKey(EnvironmentId.make("env"), ref, undefined)).not.toBe(a);
});

it("waits for connection and recovers a failed private read on reconnect without retrying writes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const reference = {
    projectId: ProjectId.make("reconnect-project"),
    repository: "org/repo",
    number: 1,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const renderer = createRoot(container);
  function Probe({ phase }: { phase: string }) {
    const drafts = usePullRequestReviewDrafts(
      EnvironmentId.make("reconnect-env"),
      reference,
      true,
      "viewer",
    );
    return createElement(
      "output",
      null,
      `${phase}:${drafts.loaded}:${drafts.revision?.headSha ?? ""}`,
    );
  }
  commands.list.mockResolvedValueOnce({ _tag: "Failure" }).mockResolvedValue({
    _tag: "Success",
    value: {
      viewer: "viewer",
      drafts: [],
      revision: { headSha: "head", baseSha: "base", fromPatchSetId: "b", toPatchSetId: "s" },
    },
  });
  connection.phase = "offline";
  try {
    await act(() => {
      renderer.render(createElement(Probe, { phase: connection.phase }));
    });
    expect(commands.list).not.toHaveBeenCalled();
    expect(container.textContent).toBe(`${connection.phase}:false:`);
    connection.phase = "connected";
    await act(() => {
      renderer.render(createElement(Probe, { phase: connection.phase }));
    });
    expect(commands.list).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe(`${connection.phase}:false:`);
    connection.phase = "offline";
    await act(() => {
      renderer.render(createElement(Probe, { phase: connection.phase }));
    });
    expect(commands.list).toHaveBeenCalledTimes(1);
    connection.phase = "connected";
    await act(() => {
      renderer.render(createElement(Probe, { phase: connection.phase }));
    });
    expect(commands.list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("connected:true:head");
    expect(commands.create).not.toHaveBeenCalled();
    expect(commands.update).not.toHaveBeenCalled();
    expect(commands.remove).not.toHaveBeenCalled();
  } finally {
    await act(() => renderer.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
