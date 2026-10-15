const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { sync, latestNightly } = require("./codeup-sync.cjs");

test("only published desktop Nightly releases are eligible", () => {
  const good = { tag_name: "v0.0.46-nightly.20261012.3021", published_at: "2026-10-12T15:00:00Z" };
  assert.equal(
    latestNightly([
      { ...good, draft: true, published_at: "2026-10-13T00:00:00Z" },
      { ...good, tag_name: "android-nightly", published_at: "2026-10-14T00:00:00Z" },
      { ...good, tag_name: "main" },
      good,
    ]),
    good,
  );
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeup-sync-"));
  const origin = path.join(root, "origin.git");
  const upstream = path.join(root, "upstream");
  const work = path.join(root, "work");
  const command = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  command(root, "init", "--bare", origin);
  command(root, "init", "-b", "codeup-integration", upstream);
  for (const [key, value] of [
    ["user.name", "test"],
    ["user.email", "test@example.com"],
  ])
    command(upstream, "config", key, value);
  fs.mkdirSync(path.join(upstream, ".github"));
  fs.writeFileSync(path.join(upstream, "shared.txt"), "base\n");
  fs.writeFileSync(path.join(upstream, ".github/keep"), "");
  command(upstream, "add", ".");
  command(upstream, "commit", "-m", "base");
  command(upstream, "remote", "add", "origin", origin);
  command(upstream, "push", "origin", "codeup-integration");
  command(root, "clone", "--branch", "codeup-integration", origin, work);
  for (const [key, value] of [
    ["user.name", "test"],
    ["user.email", "test@example.com"],
  ])
    command(work, "config", key, value);
  const calls = [];
  const run = (...args) => {
    calls.push(args);
    return command(
      work,
      ...args.map((arg) => (arg === "https://github.com/pingdotgg/t3code.git" ? upstream : arg)),
    );
  };
  const releases = [];
  const addNightly = (build) => {
    fs.writeFileSync(path.join(upstream, "shared.txt"), `upstream ${build}\n`);
    command(upstream, "add", ".");
    command(upstream, "commit", "-m", `nightly ${build}`);
    const tag = `v0.0.46-nightly.20261012.${build}`;
    command(upstream, "tag", tag);
    releases.unshift({
      tag_name: tag,
      published_at: `2026-10-12T${String(build).padStart(2, "0")}:00:00Z`,
      html_url: `https://github.com/pingdotgg/t3code/releases/tag/${tag}`,
    });
  };
  let pr;
  let creates = 0;
  let dispatches = 0;
  const runs = [];
  const comments = [];
  const github = {
    paginate: async (method) => (method === "releases" ? releases : []),
    rest: {
      repos: {
        listReleases: "releases",
        getCommit: async ({ ref }) => ({ data: { sha: command(upstream, "rev-parse", ref) } }),
      },
      pulls: {
        list: async () => ({
          data: pr
            ? [{ ...pr, head: { sha: command(work, "rev-parse", "origin/sync/upstream-nightly") } }]
            : [],
        }),
        create: async (input) => {
          creates++;
          pr = { ...input, number: 42, html_url: "https://github.com/U4F5Va6c/t3code/pull/42" };
          return { data: pr };
        },
        update: async (input) => {
          Object.assign(pr, input);
        },
      },
      actions: {
        listWorkflowRuns: async ({ head_sha, branch, event }) => ({
          data: {
            workflow_runs: runs.filter(
              (r) =>
                r.head_sha === head_sha &&
                r.head_branch === branch &&
                (!event || r.event === event),
            ),
          },
        }),
        createWorkflowDispatch: async ({ ref }) => {
          dispatches++;
          runs.unshift({
            event: "workflow_dispatch",
            head_sha: command(work, "rev-parse", `origin/${ref}`),
            head_branch: ref,
            conclusion: null,
          });
        },
      },
      issues: {
        listComments: "comments",
        createComment: async (input) => {
          comments.push(input);
        },
      },
    },
  };
  const original = process.cwd();
  process.chdir(work);
  return {
    root,
    origin,
    upstream,
    work,
    command,
    run,
    github,
    addNightly,
    calls,
    comments,
    runs,
    counts: () => ({ creates, dispatches }),
    cleanup: () => {
      process.chdir(original);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
const context = { repo: { owner: "U4F5Va6c", repo: "t3code" } };
const core = { info() {} };

test("PR creation and repeated checks never dispatch while the PR event is registering", async () => {
  const f = fixture();
  try {
    f.addNightly(1);
    assert.equal((await sync({ ...f, context, core })).status, "updated");
    const firstHead = f.run("rev-parse", "HEAD");
    assert.equal((await sync({ ...f, context, core })).status, "unchanged");
    assert.deepEqual(f.counts(), { creates: 1, dispatches: 0 });
    f.addNightly(2);
    assert.equal((await sync({ ...f, context, core })).status, "updated");
    f.run("merge-base", "--is-ancestor", firstHead, "HEAD");
    assert.deepEqual(f.counts(), { creates: 1, dispatches: 0 });
    assert.ok(
      f.calls
        .filter((args) => args[0] === "push")
        .every((args) => !args.some((arg) => arg.includes("force") || arg.startsWith("+"))),
    );
    f.run("push", "origin", "HEAD:codeup-integration");
    assert.equal((await sync({ ...f, context, core })).status, "current");
    assert.deepEqual(f.counts(), { creates: 1, dispatches: 0 });
  } finally {
    f.cleanup();
  }
});

test("conflicts leave the remote untouched and preserve a patch and report", async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.work, "shared.txt"), "fork change\n");
    f.run("add", ".");
    f.run("commit", "-m", "fork");
    f.run("push", "origin", "codeup-integration");
    f.addNightly(1);
    await assert.rejects(sync({ ...f, context, core }), /Nightly merge conflicts/);
    assert.equal(f.run("ls-remote", "--heads", "origin", "sync/upstream-nightly"), "");
    assert.ok(fs.readFileSync("codeup-sync-conflict.patch", "utf8").includes("shared.txt"));
    assert.equal(f.comments[0].issue_number, 15);
    assert.deepEqual(f.counts(), { creates: 0, dispatches: 0 });
  } finally {
    f.cleanup();
  }
});

test("an already merged Nightly leaves release builds to the push event", async () => {
  const f = fixture();
  try {
    f.addNightly(1);
    await sync({ ...f, context, core });
    f.run("push", "origin", "HEAD:codeup-integration");
    assert.equal((await sync({ ...f, context, core, autoMerge: true })).status, "current");
    assert.deepEqual(f.counts(), { creates: 1, dispatches: 0 });
  } finally {
    f.cleanup();
  }
});

test("automatic merge requires approved PR CI, not a successful manual preview", async () => {
  const f = fixture();
  try {
    f.addNightly(1);
    let merges = 0;
    f.github.rest.pulls.merge = async ({ sha }) => {
      merges++;
      assert.equal(sha, f.run("rev-parse", "HEAD"));
      f.run("push", "origin", "HEAD:codeup-integration");
      return { data: { merged: true, sha } };
    };
    await sync({ ...f, context, core, autoMerge: true });
    assert.equal(merges, 0);
    const prRun = {
      event: "pull_request",
      head_sha: f.run("rev-parse", "HEAD"),
      head_branch: "sync/upstream-nightly",
      conclusion: "action_required",
    };
    f.runs.push(
      { ...prRun, event: "workflow_dispatch", conclusion: "success" },
      { ...prRun, head_sha: "0".repeat(40), conclusion: "success" },
      prRun,
    );
    await sync({ ...f, context, core, autoMerge: true });
    assert.equal(merges, 0);
    assert.equal(f.counts().dispatches, 0);
    prRun.conclusion = "success";
    await sync({ ...f, context, core, autoMerge: true });
    assert.equal(merges, 1);
    assert.deepEqual(f.counts(), { creates: 1, dispatches: 0 });
    await sync({ ...f, context, core, autoMerge: true });
    assert.deepEqual(f.counts(), { creates: 1, dispatches: 0 });
  } finally {
    f.cleanup();
  }
});

test("automatic merge still respects branch protection and a changed head", async () => {
  for (const status of [405, 409]) {
    const f = fixture();
    try {
      f.addNightly(1);
      await sync({ ...f, context, core, autoMerge: true });
      const base = f.run("rev-parse", "origin/codeup-integration");
      f.runs.push({
        event: "pull_request",
        head_sha: f.run("rev-parse", "HEAD"),
        head_branch: "sync/upstream-nightly",
        conclusion: "success",
      });
      f.github.rest.pulls.merge = async () => {
        throw Object.assign(Error("merge blocked"), { status });
      };
      await sync({ ...f, context, core, autoMerge: true });
      assert.equal(f.run("rev-parse", "origin/codeup-integration"), base);
      assert.deepEqual(f.counts(), { creates: 1, dispatches: 0 });
    } finally {
      f.cleanup();
    }
  }
});

test("CI completion merges only the tested sync head without discovering a newer Nightly", async () => {
  const f = fixture();
  try {
    f.addNightly(1);
    await sync({ ...f, context, core });
    const sha = f.run("rev-parse", "HEAD");
    const completed = {
      event: "pull_request",
      head_sha: sha,
      head_branch: "sync/upstream-nightly",
      conclusion: "success",
    };
    f.runs.push(completed);
    f.addNightly(2);
    f.github.paginate = async () => assert.fail("CI completion must not discover Nightlies");
    let merges = 0;
    f.github.rest.pulls.merge = async (input) => {
      assert.equal(input.sha, sha);
      assert.equal(input.pull_number, 42);
      merges++;
      return { data: { merged: true } };
    };
    const finish = (workflowRun, options = {}) =>
      sync({
        ...f,
        core,
        autoMerge: true,
        context: { ...context, eventName: "workflow_run", payload: { workflow_run: workflowRun } },
        run: () => assert.fail("CI completion must not change the sync branch"),
        ...options,
      });
    for (const patch of [
      { event: "workflow_dispatch" },
      { conclusion: "failure" },
      { head_branch: "other" },
      { head_sha: "0".repeat(40) },
    ])
      assert.equal((await finish({ ...completed, ...patch })).status, "ignored");
    assert.equal((await finish(completed, { autoMerge: false })).status, "ignored");
    assert.equal((await finish(completed, { dryRun: true })).status, "ignored");
    assert.equal(merges, 0);
    f.runs.unshift({ ...completed, conclusion: null });
    await finish(completed);
    assert.equal(merges, 0);
    f.runs.shift();
    await finish(completed);
    assert.equal(merges, 1);
    assert.deepEqual(f.counts(), { creates: 1, dispatches: 0 });
  } finally {
    f.cleanup();
  }
});
