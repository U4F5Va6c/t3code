import { describe, expect, it } from "vite-plus/test";

import { definition } from "./definition.ts";
import { parseCodeupRepository } from "./repository.ts";

describe("Codeup repository identity", () => {
  it("keeps the organization and all nested groups across clone transports", () => {
    for (const input of [
      "org-a/team/sub/repo",
      "git@codeup.aliyun.com:org-a/team/sub/repo.git",
      "ssh://git@codeup.aliyun.com:22/org-a/team/sub/repo.git",
      "https://codeup.aliyun.com/org-a/team/sub/repo.git/",
    ])
      expect(parseCodeupRepository(input)).toEqual({
        organizationId: "org-a",
        repository: "org-a/team/sub/repo",
      });
    expect(parseCodeupRepository("org-b/team/sub/repo")?.organizationId).toBe("org-b");
    expect(
      parseCodeupRepository("https://codeup.aliyun.com/org-a/%E4%B8%AD%E6%96%87/repo")?.repository,
    ).toBe("org-a/中文/repo");
  });

  it("rejects ambiguous IDs, foreign hosts, credentials, path escapes, and malformed input", () => {
    for (const input of [
      "1234",
      "owner",
      "",
      "org/../repo",
      "https://codeup.aliyun.com/org-a/../org-b/repo",
      "https://codeup.aliyun.com/org-a/%2e%2e/org-b/repo",
      "https://codeup.aliyun.com/org/rep\no",
      "org/%2F/repo",
      "org/%252F/repo",
      "org//repo",
      "org/repo?secret=1",
      "org/repo#1",
      "org/rep%xx",
      "org\\group/repo",
      "https://codeup.evil.test/org/repo",
      "http://codeup.aliyun.com/org/repo",
      "https://user:token@codeup.aliyun.com/org/repo",
      "https://codeup.aliyun.com:8443/org/repo",
      "https://codeup.aliyun.com/org/repo?token=secret",
      "git@another.host:org/repo.git",
    ])
      expect(parseCodeupRepository(input), input).toBeNull();
  });

  it("uses Codeup's MR URL and offers no unimplemented write or checkout actions", () => {
    expect(
      definition.changeRequestUrl({
        host: "codeup.aliyun.com",
        repository: "org/team/repo",
        number: 9,
      }),
    ).toBe("https://codeup.aliyun.com/org/team/repo/change/9");
    expect(definition.isChangeRequestUrl("https://codeup.aliyun.com/org/team/repo/change/9")).toBe(
      true,
    );
    expect(definition.isChangeRequestUrl("https://other.test/org/repo/change/9")).toBe(false);
    expect(
      definition.changeRequestUrl({ host: "other.test", repository: "org/repo", number: 9 }),
    ).toBeNull();
    expect([...definition.changeRequestActions]).toEqual(["close", "reopen", "merge"]);
    expect(definition.checkoutCommand()).toBeNull();
  });
});
