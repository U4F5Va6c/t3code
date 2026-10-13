const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const REPOSITORY = { owner: "U4F5Va6c", repo: "t3code" };
const UPSTREAM = { owner: "pingdotgg", repo: "t3code" };
const BASE = "codeup-integration";
const BRANCH = "sync/upstream-nightly";
const MARKER = "<!-- codeup-nightly-sync -->";

async function ensureCi(github, sha, ref) {
  const { data } = await github.rest.actions.listWorkflowRuns({
    ...REPOSITORY,
    workflow_id: "codeup-ci.yml",
    head_sha: sha,
    branch: ref,
    ...(ref === BRANCH ? { event: "pull_request" } : {}),
    per_page: 100,
  });
  const existing = data.workflow_runs[0];
  // PR events now create approval-required runs; only token-authenticated pushes need a dispatch.
  if (!existing && ref === BASE)
    await github.rest.actions.createWorkflowDispatch({
      ...REPOSITORY,
      workflow_id: "codeup-ci.yml",
      ref,
    });
  return existing;
}

function latestNightly(releases) {
  return releases
    .filter(
      (r) => !r.draft && r.published_at && /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/.test(r.tag_name),
    )
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function reportConflict({ github, number, tag, paths }) {
  const body = `${MARKER}\n同步 ${tag} 时发生冲突，保留原分支；没有强推或发布。\n\n冲突文件：\n${paths.map((p) => `- \`${p}\``).join("\n")}\n\n请在同步分支解决冲突后重新运行 Codeup CI。完整 patch 见本次 Actions artifact。`;
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...REPOSITORY,
    issue_number: number,
    per_page: 100,
  });
  const existing = comments.find((c) => c.user?.type === "Bot" && c.body?.startsWith(MARKER));
  if (existing) {
    if (existing.body !== body)
      await github.rest.issues.updateComment({ ...REPOSITORY, comment_id: existing.id, body });
  } else {
    await github.rest.issues.createComment({ ...REPOSITORY, issue_number: number, body });
  }
}

async function sync({ github, context, core, run = git, dryRun = false, autoMerge = false }) {
  if (`${context.repo.owner}/${context.repo.repo}` !== "U4F5Va6c/t3code")
    throw Error("Fork-only workflow.");
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...UPSTREAM,
    per_page: 100,
  });
  const nightly = latestNightly(releases);
  if (!nightly) throw Error("No published upstream Nightly was found.");
  const { data: commit } = await github.rest.repos.getCommit({
    ...UPSTREAM,
    ref: nightly.tag_name,
  });
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error("Invalid upstream commit.");
  core.info(`Published Nightly: ${nightly.tag_name} (${commit.sha})`);
  run("fetch", "--no-tags", "origin", BASE);
  run(
    "fetch",
    "--no-tags",
    "https://github.com/pingdotgg/t3code.git",
    `refs/tags/${nightly.tag_name}`,
  );
  if (run("rev-parse", "FETCH_HEAD^{commit}") !== commit.sha)
    throw Error("Published tag moved during discovery.");
  const contains = (base, target) => {
    try {
      run("merge-base", "--is-ancestor", target, base);
      return true;
    } catch {
      return false;
    }
  };
  if (contains(`origin/${BASE}`, commit.sha)) {
    // Recover a dispatch failure after a token-authenticated merge (which emits no push run).
    if (autoMerge && !dryRun) await ensureCi(github, run("rev-parse", `origin/${BASE}`), BASE);
    core.info("The integration branch already contains this Nightly; no PR or build needed.");
    return { status: "current", tag: nightly.tag_name };
  }
  if (dryRun) return { status: "available", tag: nightly.tag_name, sha: commit.sha };

  const { data: prs } = await github.rest.pulls.list({
    ...REPOSITORY,
    state: "open",
    base: BASE,
    head: `${REPOSITORY.owner}:${BRANCH}`,
  });
  const pr = prs[0];
  const remoteBranch = run("ls-remote", "--heads", "origin", BRANCH);
  if (remoteBranch) {
    run("fetch", "--no-tags", "origin", BRANCH);
    run("checkout", "-B", BRANCH, "FETCH_HEAD");
  } else {
    run("checkout", "-b", BRANCH, `origin/${BASE}`);
  }
  const previousHead = run("rev-parse", "HEAD");
  for (const ref of [`origin/${BASE}`, commit.sha]) {
    if (contains("HEAD", ref)) continue;
    try {
      run(
        "merge",
        "--no-ff",
        ref,
        "-m",
        `chore-上游同步-合入${ref === commit.sha ? nightly.tag_name : "集成分支"}-#15`,
      );
    } catch (error) {
      const paths = run("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
      if (paths.length === 0) throw error;
      fs.writeFileSync("codeup-sync-conflict.patch", run("diff"));
      run("merge", "--abort");
      await reportConflict({ github, number: pr?.number ?? 15, tag: nightly.tag_name, paths });
      throw Error(`Nightly merge conflicts: ${paths.join(", ")}`, { cause: error });
    }
  }
  fs.writeFileSync(
    ".github/codeup-upstream.json",
    `${JSON.stringify({ tag: nightly.tag_name, sha: commit.sha, publishedAt: nightly.published_at }, null, 2)}\n`,
  );
  run("add", ".github/codeup-upstream.json");
  if (run("diff", "--cached", "--name-only"))
    run("commit", "-m", `chore-上游同步-记录${nightly.tag_name}-#15`);
  const sha = run("rev-parse", "HEAD");
  const changed = sha !== previousHead;
  if (changed || !remoteBranch) run("push", "origin", `HEAD:refs/heads/${BRANCH}`);

  const title = `chore-上游同步-跟进${nightly.tag_name}-#15`;
  const body = `${MARKER}\n跟进官方已发布的 [${nightly.tag_name}](${nightly.html_url})（\`${commit.sha}\`）。\n\n本 PR 会持续更新到最新 Nightly，因此跳过几天也只需合并一次。合并前请确认 Codeup CI 和所需评审通过；冲突保留现场，自动化不会强推。合并后由 Codeup CI 构建并完整发布客户端及后端。\n\n关联 #15、#16、#17。上游同步自动化，GitHub Actions。`;
  const current =
    pr ??
    (await github.rest.pulls.create({ ...REPOSITORY, head: BRANCH, base: BASE, title, body })).data;
  if (pr && (changed || pr.title !== title))
    await github.rest.pulls.update({ ...REPOSITORY, pull_number: pr.number, title, body });
  const ci = await ensureCi(github, sha, BRANCH);
  if (!ci || ci.conclusion === "action_required")
    core.info("Waiting for the PR workflow. Approve workflows to run on the PR if requested.");
  if (autoMerge && ci?.conclusion === "success") {
    // The merge API enforces branch protection; a matching SHA prevents merging a newer push.
    try {
      const { data: merged } = await github.rest.pulls.merge({
        ...REPOSITORY,
        pull_number: current.number,
        sha,
        merge_method: "merge",
      });
      if (!merged.merged) throw Error(merged.message);
      await ensureCi(github, merged.sha, BASE);
    } catch (error) {
      if (error.status !== 405 && error.status !== 409) throw error;
      core.info(`Automatic merge is waiting for branch protection: ${error.message}`);
    }
  }
  core.info(`Single sync PR: ${current.html_url} (${changed ? "updated" : "unchanged"})`);
  return { status: changed || !pr ? "updated" : "unchanged", number: current.number, sha };
}

module.exports = { latestNightly, sync };
