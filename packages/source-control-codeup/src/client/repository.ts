/** Central Edition's Git and web host. The API has a separate, fixed authority. */
export const CODEUP_HOST = "codeup.aliyun.com";
export const CODEUP_API_HOST = "openapi-rdc.aliyuncs.com";

/** A full repository path or an SSH/HTTPS clone URL, never a display name or numeric ID. */
export function parseCodeupRepository(input: string) {
  let path = input.trim();
  if (/[\p{Cc}\\]/u.test(path) || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/iu.test(path)) return null;
  if (path.startsWith("git@")) {
    const prefix = `git@${CODEUP_HOST}:`;
    if (!path.startsWith(prefix)) return null;
    path = path.slice(prefix.length);
  } else if (path.includes("://")) {
    try {
      const url = new URL(path);
      if (
        url.hostname !== CODEUP_HOST ||
        (url.protocol !== "https:" && url.protocol !== "ssh:") ||
        (url.port !== "" && !(url.protocol === "ssh:" && url.port === "22")) ||
        url.password ||
        url.search ||
        url.hash ||
        (url.username !== "" && !(url.protocol === "ssh:" && url.username === "git"))
      )
        return null;
      path = url.pathname.slice(1);
    } catch {
      return null;
    }
  }
  path = path.replace(/\/$/u, "").replace(/\.git$/u, "");
  let segments: string[];
  try {
    segments = path.split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  const organizationId = segments[0];
  if (
    segments.length < 2 ||
    !organizationId ||
    !/^[a-z0-9][a-z0-9_-]*$/u.test(organizationId) ||
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || /[\s/\\?#:%\p{Cc}]/u.test(segment),
    )
  )
    return null;
  return { organizationId, repository: segments.join("/") };
}

export function codeupRepositoryUrl(repository: string): string {
  return `https://${CODEUP_HOST}/${repository.split("/").map(encodeURIComponent).join("/")}`;
}

/** A Codeup web reference, preserving the full organization and nested repository path. */
export function parseCodeupChangeRequest(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.host !== CODEUP_HOST || url.username || url.password)
      return null;
    const match = /^(.*)\/change\/([1-9]\d*)(?:\/.*)?$/u.exec(url.pathname);
    const repository = match?.[1] ? parseCodeupRepository(match[1].slice(1)) : null;
    const number = Number(match?.[2]);
    return repository && Number.isSafeInteger(number) ? { ...repository, number } : null;
  } catch {
    return null;
  }
}
