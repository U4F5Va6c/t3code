import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { codeupReleaseAtom, releasePublishedAtom } from "./releases";

const version = "0.0.46-nightly.20261012.3021";

// FetchHttpClient reads globalThis.fetch once and keeps it, so every test shares this mock.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

async function settledCheck(checkVersion = version) {
  const atom = releasePublishedAtom(checkVersion);
  const registry = AtomRegistry.make();
  const unmount = registry.mount(atom);
  try {
    await vi.waitFor(() => {
      const result = registry.get(atom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    return registry.get(atom);
  } finally {
    unmount();
    registry.dispose();
  }
}

describe("releasePublishedAtom", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("checks npm without tracing headers, so the browser skips the preflight npm rejects", async () => {
    fetchMock.mockImplementation(async () => Response.json({ version }));

    const result = await settledCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(`https://registry.npmjs.org/t3/${version}`);
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("b3")).toBeNull();
    expect(AsyncResult.getOrElse(result, () => false)).toBe(true);
  });

  it("reports a version npm does not have as unpublished", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    const result = await settledCheck();

    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => true)).toBe(false);
  });

  it.each([
    { draft: false, complete: true, published: true },
    { draft: true, complete: true, published: false },
    { draft: false, complete: false, published: false },
  ])("checks the Fork release source: %j", async ({ draft, complete, published }) => {
    const codeupVersion = "0.0.46-codeup.20261014.1234";
    fetchMock.mockImplementation(async () =>
      Response.json({
        tag_name: `v${codeupVersion}`,
        draft,
        assets: complete
          ? ["codeup-release.json", "SHA256SUMS", "codeup-mac.yml"].map((name) => ({ name }))
          : [],
      }),
    );

    const result = await settledCheck(codeupVersion);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(
      `https://api.github.com/repos/U4F5Va6c/t3code/releases/tags/v${codeupVersion}`,
    );
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("b3")).toBeNull();
    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => false)).toBe(published);
  });

  it("leaves a failed first check unknown, which callers read as unpublished", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await settledCheck();

    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => false)).toBe(false);
  });
});


describe("codeupReleaseAtom", () => {
  afterEach(() => fetchMock.mockReset());
  it.each(["HTTP 403", "network error"])("preserves %s and supports retry", async (failure) => {
    if (failure === "HTTP 403")
      fetchMock.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    else fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockImplementation(() => Promise.resolve(new Response("[]", { status: 200 })));
    const registry = AtomRegistry.make();
    try {
      registry.mount(codeupReleaseAtom);
      expect(registry.get(codeupReleaseAtom).waiting).toBe(true);
      await vi.waitFor(() => expect(registry.get(codeupReleaseAtom)._tag).toBe("Failure"));
      registry.refresh(codeupReleaseAtom);
      await vi.waitFor(() => expect(registry.get(codeupReleaseAtom)._tag).toBe("Success"));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      registry.dispose();
    }
  });
});
