import { describe, expect, it } from "vite-plus/test";

import {
  sourceControlClients,
  sourceControlRepositoryLabel,
  sourceControlActorLabel,
} from "./sourceControlClients.ts";

describe("sourceControlClients", () => {
  it("labels Codeup repositories without their organization selector, retaining nested groups", () => {
    expect(sourceControlRepositoryLabel("codeup", "org-a/repo")).toBe("repo");
    expect(sourceControlRepositoryLabel("codeup", "org-a/team/sub/repo")).toBe("team/sub/repo");
    expect(sourceControlRepositoryLabel("codeup", "unresolved")).toBe("unresolved");
    expect(sourceControlRepositoryLabel("github", "owner/repo")).toBe("owner/repo");
    expect(sourceControlRepositoryLabel("gitlab", "group/team/repo")).toBe("group/team/repo");
    expect(sourceControlRepositoryLabel("unshipped", "owner/repo")).toBe("owner/repo");
  });

  it("uses Codeup names without changing logins or other hosts' labels", () => {
    const actor = { login: "user-id", name: "张三", avatarUrl: null };
    expect(sourceControlActorLabel("codeup", actor)).toBe("张三");
    expect(sourceControlActorLabel("codeup", { ...actor, name: " " })).toBe("user-id");
    expect(sourceControlActorLabel("codeup", null)).toBe("ghost");
    expect(sourceControlActorLabel("github", actor)).toBe("user-id");
    expect(actor.login).toBe("user-id");
  });
  it("reads a missing kind as the first host and an unshipped kind as the generic one", () => {
    expect(sourceControlClients.get(undefined).kind).toBe("github");
    expect(sourceControlClients.get("forkhost").kind).toBe("unknown");
  });

  it("gives a change request URL to the first host whose shape it has", () => {
    // GitCafe and Forgejo share `/pulls/`; GitCafe only claims its own hostnames.
    const kindOf = (url: string) => sourceControlClients.findByChangeRequestUrl(url)?.kind;
    expect(kindOf("https://git.cafe/acme/web/pulls/7")).toBe("gitcafe");
    expect(kindOf("https://codeberg.org/acme/web/pulls/7")).toBe("forgejo");
    expect(kindOf("https://codeup.aliyun.com/org/team/web/change/7")).toBe("codeup");
    expect(kindOf("https://other.test/org/team/web/change/7")).toBeUndefined();
  });
});
