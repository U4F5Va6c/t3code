const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { resolve, assemble, publish } = require("./codeup-release.cjs");

const metadata = {
  version: "0.0.46-codeup.20261013.42",
  forkSha: "a".repeat(40),
  upstream: { tag: "v0.0.46-nightly.20261012.3021", sha: "b".repeat(40) },
  runUrl: "https://github.com/U4F5Va6c/t3code/actions/runs/42",
};

test("PRs validate provenance without packaging; pushes and manual previews package only unpublished commits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeup-resolve-"));
  const original = process.cwd();
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init");
    git("config", "user.name", "test");
    git("config", "user.email", "test@example.com");
    git("commit", "--allow-empty", "-m", "upstream");
    const upstream = { ...metadata.upstream, sha: git("rev-parse", "HEAD") };
    await fs.mkdir(path.join(root, ".github"));
    await fs.writeFile(path.join(root, ".github/codeup-upstream.json"), JSON.stringify(upstream));
    git("add", ".");
    git("commit", "-m", "fork");
    const sha = git("rev-parse", "HEAD");
    process.chdir(root);
    const published = {
      tag_name: "v0.0.46-codeup.20261013.1",
      target_commitish: sha,
      assets: [{ name: "codeup-release.json" }],
    };
    for (const [eventName, releases, build] of [
      ["pull_request", [], "false"],
      ["push", [], "true"],
      ["workflow_dispatch", [], "true"],
      ["push", [published], "false"],
      ["workflow_dispatch", [published], "false"],
      ["push", [{ ...published, draft: true }], "true"],
      ["push", [{ ...published, tag_name: "codeup-test-0.0.46-codeup.20261013.1" }], "true"],
    ]) {
      const outputs = {};
      const result = await resolve({
        github: {
          paginate: async () => releases,
          rest: {
            repos: {
              getReleaseByTag: async () => ({ data: { published_at: "2026-10-13T00:00:00Z" } }),
              getCommit: async () => ({ data: { sha: upstream.sha } }),
            },
          },
        },
        context: { repo: { owner: "U4F5Va6c", repo: "t3code" }, eventName, runId: 42 },
        core: {
          setOutput: (name, value) => {
            outputs[name] = value;
          },
        },
      });
      assert.equal(outputs.build, build, `${eventName}: ${JSON.stringify(releases)}`);
      assert.equal(outputs.sha, sha);
      assert.equal(result.forkSha, sha);
      assert.deepEqual(JSON.parse(await fs.readFile("codeup-build.json", "utf8")), result);
    }
  } finally {
    process.chdir(original);
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeup-release-"));
  const input = path.join(root, "input");
  const output = path.join(root, "output");
  for (const name of ["macos-arm64", "macos-x64", "cli-darwin-arm64", "cli-linux-x64"]) {
    const dir = path.join(input, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "COMMIT.txt"), metadata.forkSha);
    if (name.startsWith("cli-")) {
      await fs.writeFile(path.join(dir, `t3-${metadata.version}-${name.slice(4)}.tar.gz`), name);
    } else {
      const base = `T3-Code-Codeup-Preview-${metadata.version}-${name.slice(6)}`;
      for (const ext of ["dmg", "zip", "zip.blockmap"])
        await fs.writeFile(path.join(dir, `${base}.${ext}`), name);
      const sha512 = crypto.createHash("sha512").update(name).digest("base64");
      await fs.writeFile(
        path.join(dir, "codeup-mac.yml"),
        `version: ${metadata.version}\nfiles:\n  - url: ${base}.zip\n    sha512: ${sha512}\n    size: ${name.length}\nreleaseDate: '2026-10-13T00:00:00Z'\n`,
      );
    }
  }
  return { root, input, output };
}

test("assembly verifies both architectures, the same commit and updater digests", async () => {
  const f = await fixture();
  try {
    const names = await assemble(f.input, f.output, metadata);
    assert.equal(names.length, 12);
    assert.match(
      await fs.readFile(path.join(f.output, "SHA256SUMS"), "utf8"),
      /codeup-release.json/,
    );
    await fs.writeFile(path.join(f.input, "macos-x64/COMMIT.txt"), "c".repeat(40));
    await assert.rejects(assemble(f.input, f.output, metadata), /build commit/);
    await fs.writeFile(path.join(f.input, "macos-x64/COMMIT.txt"), metadata.forkSha);
    await fs.writeFile(
      path.join(f.input, "macos-x64", `T3-Code-Codeup-Preview-${metadata.version}-x64.zip`),
      "tampered",
    );
    await assert.rejects(assemble(f.input, f.output, metadata), /digest mismatch/);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("publication stays draft on upload failure and retries before becoming visible", async () => {
  const f = await fixture();
  try {
    await assemble(f.input, f.output, metadata);
    let release;
    let fail = true;
    let published = 0;
    let uploads = 0;
    const github = {
      rest: {
        repos: {
          getReleaseByTag: async () => {
            if (!release) throw Object.assign(Error("missing"), { status: 404 });
            return { data: release };
          },
          createRelease: async (input) => {
            release = { ...input, id: 42, assets: [], html_url: "release-url" };
            return { data: release };
          },
          uploadReleaseAsset: async ({ name }) => {
            uploads++;
            if (fail && uploads === 2) throw Error("network error");
            release.assets.push({ id: uploads, name });
          },
          deleteReleaseAsset: async ({ asset_id }) => {
            release.assets = release.assets.filter((a) => a.id !== asset_id);
          },
          updateRelease: async (input) => {
            published++;
            Object.assign(release, input);
          },
        },
      },
    };
    await assert.rejects(publish({ github, directory: f.output, metadata }), /network error/);
    assert.equal(release.draft, true);
    assert.equal(published, 0);
    fail = false;
    await publish({ github, directory: f.output, metadata });
    assert.equal(release.assets.length, 12);
    assert.equal(release.draft, false);
    const before = uploads;
    await publish({ github, directory: f.output, metadata });
    assert.equal(uploads, before);
    assert.equal(published, 1);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
