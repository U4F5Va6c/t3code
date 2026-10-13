import { AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { codeupReleaseAtom } from "./releases";

const fetch = vi.fn();
beforeEach(() => {
  fetch.mockReset();
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("codeupReleaseAtom", () => {
  it.each(["HTTP 403", "network error"])("preserves %s and supports retry", async (failure) => {
    if (failure === "HTTP 403")
      fetch.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    else fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetch.mockImplementation(() => Promise.resolve(new Response("[]", { status: 200 })));
    vi.stubGlobal("fetch", fetch);
    const registry = AtomRegistry.make();
    try {
      registry.mount(codeupReleaseAtom);
      expect(registry.get(codeupReleaseAtom).waiting).toBe(true);
      await vi.waitFor(() => expect(registry.get(codeupReleaseAtom)._tag).toBe("Failure"));
      registry.refresh(codeupReleaseAtom);
      await vi.waitFor(() => expect(registry.get(codeupReleaseAtom)._tag).toBe("Success"));
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      registry.dispose();
    }
  });
});
