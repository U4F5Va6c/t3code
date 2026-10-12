const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const REPO = { owner: "U4F5Va6c", repo: "t3code" };
const MANIFEST = "codeup-release.json";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

async function resolve({ github, context, core }) {
  if (`${context.repo.owner}/${context.repo.repo}` !== "U4F5Va6c/t3code")
    throw Error("Fork-only workflow.");
  const upstream = JSON.parse(await fs.readFile(".github/codeup-upstream.json", "utf8"));
  const match = /^v(\d+\.\d+\.\d+)-nightly\.\d{8}\.\d+$/.exec(upstream.tag);
  if (!match || !/^[a-f0-9]{40}$/.test(upstream.sha)) throw Error("Invalid upstream provenance.");
  const upstreamRepo = { owner: "pingdotgg", repo: "t3code" };
  const { data: published } = await github.rest.repos.getReleaseByTag({
    ...upstreamRepo,
    tag: upstream.tag,
  });
  const { data: commit } = await github.rest.repos.getCommit({
    ...upstreamRepo,
    ref: upstream.tag,
  });
  if (published.draft || !published.published_at || commit.sha !== upstream.sha)
    throw Error("The baseline is not the recorded published Nightly.");
  git("merge-base", "--is-ancestor", upstream.sha, "HEAD");
  const sha = git("rev-parse", "HEAD");
  // A run keeps its version on retry; build numbers are monotonic across workflows.
  const date = git("show", "-s", "--format=%cs", "HEAD").replaceAll("-", "");
  const version = `${match[1]}-codeup.${date}.${context.runId}`;
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...REPO,
    per_page: 100,
  });
  const alreadyPublished = releases.some(
    (release) =>
      !release.draft &&
      release.target_commitish === sha &&
      release.assets?.some((a) => a.name === MANIFEST) &&
      /^v\d+\.\d+\.\d+-codeup\./.test(release.tag_name),
  );
  const metadata = {
    version,
    forkSha: sha,
    upstream,
    runUrl: `https://github.com/${REPO.owner}/${REPO.repo}/actions/runs/${context.runId}`,
  };
  await fs.writeFile("codeup-build.json", `${JSON.stringify(metadata, null, 2)}\n`);
  core.setOutput("version", version);
  core.setOutput("sha", sha);
  core.setOutput("build", String(!alreadyPublished || context.eventName === "pull_request"));
  return metadata;
}

async function filesBelow(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? filesBelow(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat();
}

async function digest(file, algorithm, encoding) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

async function assemble(inputDirectory, outputDirectory, metadata) {
  const { parseUpdateManifest, mergeUpdateManifests, serializeUpdateManifest } = await import(
    pathToFileURL(path.resolve("scripts/lib/update-manifest.ts")).href
  );
  const files = await filesBelow(inputDirectory);
  const { version, forkSha } = metadata;
  if (!/^\d+\.\d+\.\d+-codeup\.\d{8}\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(forkSha))
    throw Error("Invalid build identity.");
  const receipts = files.filter((file) => path.basename(file) === "COMMIT.txt");
  if (receipts.length !== 4) throw Error("Expected all four build receipts.");
  for (const receipt of receipts)
    if ((await fs.readFile(receipt, "utf8")).trim() !== forkSha)
      throw Error("Artifacts do not share the build commit.");
  const required = [
    ...["arm64", "x64"].flatMap((arch) =>
      ["dmg", "zip", "zip.blockmap"].map(
        (ext) => `T3-Code-Codeup-Preview-${version}-${arch}.${ext}`,
      ),
    ),
    `t3-${version}-darwin-arm64.tar.gz`,
    `t3-${version}-linux-x64.tar.gz`,
  ];
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const name of required) {
    const matches = files.filter((file) => path.basename(file) === name);
    if (matches.length !== 1) throw Error(`Missing or duplicate asset: ${name}`);
    await fs.copyFile(matches[0], path.join(outputDirectory, name));
  }
  const manifestPaths = files.filter((file) => path.basename(file) === "codeup-mac.yml");
  if (manifestPaths.length !== 2) throw Error("Expected two macOS updater manifests.");
  const manifests = await Promise.all(
    manifestPaths.map(async (file) =>
      parseUpdateManifest(await fs.readFile(file, "utf8"), file, "macOS"),
    ),
  );
  const merged = mergeUpdateManifests(manifests[0], manifests[1], "macOS");
  if (merged.version !== version) throw Error("Updater manifest version differs from the build.");
  for (const asset of merged.files) {
    if (!required.includes(asset.url)) throw Error(`Unexpected updater asset: ${asset.url}`);
    const file = path.join(outputDirectory, asset.url);
    if (
      (await fs.stat(file)).size !== asset.size ||
      (await digest(file, "sha512", "base64")) !== asset.sha512
    )
      throw Error(`Updater digest mismatch: ${asset.url}`);
  }
  for (const arch of ["arm64", "x64"])
    if (
      !merged.files.some((asset) => asset.url === `T3-Code-Codeup-Preview-${version}-${arch}.zip`)
    )
      throw Error(`Missing updater ZIP: ${arch}`);
  await fs.writeFile(
    path.join(outputDirectory, "codeup-mac.yml"),
    serializeUpdateManifest(merged, { platformLabel: "macOS" }),
  );
  await fs.writeFile(
    path.join(outputDirectory, MANIFEST),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  await fs.writeFile(path.join(outputDirectory, "COMMIT.txt"), `${forkSha}\n`);
  const names = [...required, "codeup-mac.yml", MANIFEST, "COMMIT.txt"];
  const sums = await Promise.all(
    names.map(
      async (name) => `${await digest(path.join(outputDirectory, name), "sha256", "hex")}  ${name}`,
    ),
  );
  await fs.writeFile(path.join(outputDirectory, "SHA256SUMS"), `${sums.join("\n")}\n`);
  return [...names, "SHA256SUMS"];
}

async function publish({ github, directory, metadata, candidate = false }) {
  const tag = candidate ? `codeup-test-${metadata.version}` : `v${metadata.version}`;
  const body = `Codeup Preview ${metadata.version}\n\n- Fork commit: ${metadata.forkSha}\n- Upstream: [${metadata.upstream.tag}](https://github.com/pingdotgg/t3code/releases/tag/${metadata.upstream.tag}) (${metadata.upstream.sha})\n- [Build and verification](${metadata.runUrl})\n\n${candidate ? "This is an unmerged acceptance build, excluded from the update channel.\n\n" : ""}macOS arm64/x64: install the matching DMG. Standalone backends: macOS arm64 and Linux x64. SHA256SUMS covers the complete release.\n\nThe app has a separate Codeup identity and profile. Builds without Developer ID use ad-hoc signatures: update checks/downloads are available, but macOS may require installing the DMG manually. Do not disable signature verification. Preserve the previous app/runtime and a stopped data backup for rollback; replacing a binary alone does not reverse database migrations.`;
  let release;
  try {
    release = (await github.rest.repos.getReleaseByTag({ ...REPO, tag })).data;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (release && release.target_commitish !== metadata.forkSha)
    throw Error("Release tag belongs to another commit.");
  if (release && !release.draft) return release.html_url;
  release ??= (
    await github.rest.repos.createRelease({
      ...REPO,
      tag_name: tag,
      target_commitish: metadata.forkSha,
      name: `${candidate ? "Acceptance: " : ""}Codeup Preview ${metadata.version}`,
      body,
      draft: true,
      prerelease: true,
      make_latest: "false",
    })
  ).data;
  for (const name of await fs.readdir(directory)) {
    const existing = release.assets?.find((asset) => asset.name === name);
    if (existing) await github.rest.repos.deleteReleaseAsset({ ...REPO, asset_id: existing.id });
    await github.rest.repos.uploadReleaseAsset({
      ...REPO,
      release_id: release.id,
      name,
      data: await fs.readFile(path.join(directory, name)),
    });
  }
  // The first public response already has every manifest and archive.
  await github.rest.repos.updateRelease({
    ...REPO,
    release_id: release.id,
    body,
    draft: false,
    prerelease: true,
    make_latest: "false",
  });
  return release.html_url;
}

module.exports = { resolve, assemble, publish };
