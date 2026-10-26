import { createElement } from "react";
import { render } from "../../../test/render";
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

function setup() {
  connection.phase = "offline";
  for (const command of Object.values(commands)) command.mockReset();
}

it("keeps failed deletions instead of clearing all drafts", async () => {
  setup();
  const remaining = new Set(["one", "two", "three"]);
  const removed = await discardReviewDrafts([...remaining], async (id) => id !== "two");
  for (const id of removed) remaining.delete(id);
  expect([...remaining]).toEqual(["two"]);
});
it("does not treat a fresh draft-list head as a head the reviewer already inspected", () => {
  setup();
  const revision = { headSha: "new", baseSha: "base", fromPatchSetId: "b", toPatchSetId: "s" };
  expect(hasUnreviewedDraftHead("old", "old", revision)).toBe(true);
  expect(hasUnreviewedDraftHead("old", "new", revision)).toBe(true);
  expect(hasUnreviewedDraftHead("new", "new", revision)).toBe(false);
});
it("isolates private drafts across actual viewers and environments", () => {
  setup();
  const ref = { projectId: ProjectId.make("p"), repository: "org/repo", number: 1 };
  const a = privateReviewDraftKey(EnvironmentId.make("env"), ref, "viewer-a");
  expect(privateReviewDraftKey(EnvironmentId.make("env"), ref, "viewer-b")).not.toBe(a);
  expect(privateReviewDraftKey(EnvironmentId.make("other"), ref, "viewer-a")).not.toBe(a);
  expect(privateReviewDraftKey(EnvironmentId.make("env"), ref, undefined)).not.toBe(a);
});

it("waits for connection and recovers a failed private read on reconnect without retrying writes", async () => {
  setup();
  const reference = {
    projectId: ProjectId.make("reconnect-project"),
    repository: "org/repo",
    number: 1,
  };
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
  commands.list
    .mockResolvedValue({ _tag: "Failure" })
    .mockResolvedValueOnce({ _tag: "Failure" })
    .mockResolvedValueOnce({
      _tag: "Success",
      value: {
        viewer: "viewer",
        drafts: [],
        revision: { headSha: "head", baseSha: "base", fromPatchSetId: "b", toPatchSetId: "s" },
      },
    });
  connection.phase = "offline";
  await using screen = await render(createElement(Probe, { phase: connection.phase }), {
    // The probe exercises draft synchronization without navigation.
    router: false,
  });
  expect(commands.list).not.toHaveBeenCalled();
  expect(screen.container.textContent).toBe(`${connection.phase}:false:`);
  connection.phase = "connected";
  await screen.rerender(createElement(Probe, { phase: connection.phase }));
  expect(commands.list).toHaveBeenCalledTimes(1);
  expect(screen.container.textContent).toBe(`${connection.phase}:false:`);
  connection.phase = "offline";
  await screen.rerender(createElement(Probe, { phase: connection.phase }));
  expect(commands.list).toHaveBeenCalledTimes(1);
  connection.phase = "connected";
  await screen.rerender(createElement(Probe, { phase: connection.phase }));
  expect(commands.list).toHaveBeenCalledTimes(2);
  expect(screen.container.textContent).toBe("connected:true:head");
  await screen.rerender(createElement(Probe, { phase: "unrelated-render" }));
  expect(commands.list).toHaveBeenCalledTimes(2);
  expect(screen.container.textContent).toBe("unrelated-render:true:head");
  expect(commands.create).not.toHaveBeenCalled();
  expect(commands.update).not.toHaveBeenCalled();
  expect(commands.remove).not.toHaveBeenCalled();
});
