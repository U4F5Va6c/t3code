import { AtomRegistry } from "effect/reactivity";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { codeupReleaseAtom } from "./releases";

// FetchHttpClient reads globalThis.fetch once and keeps it, so every test shares this mock.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

describe("codeupReleaseAtom", () => {
  afterAll(() => vi.unstubAllGlobals());
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
