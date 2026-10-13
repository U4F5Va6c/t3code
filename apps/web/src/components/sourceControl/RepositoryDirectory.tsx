import { useEffect, useRef, useState } from "react";
import {
  SourceControlProviderKind,
  type EnvironmentId,
  type SourceControlDirectoryRepository,
  type SourceControlRepositoryDirectoryResult,
  type SourceControlRepositoryBranchesResult,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function RepositoryDirectory({
  environmentId,
  onSelect,
}: {
  environmentId: EnvironmentId;
  onSelect: (repository: SourceControlDirectoryRepository) => void;
}) {
  const listRepositories = useAtomQueryRunner(sourceControlEnvironment.repositories, {
    reportFailure: false,
    refresh: true,
  });
  const listBranches = useAtomQueryRunner(sourceControlEnvironment.branches, {
    reportFailure: false,
    refresh: true,
  });
  const [organizationId, setOrganizationId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [directory, setDirectory] = useState<SourceControlRepositoryDirectoryResult | null>(null);
  const [selected, setSelected] = useState<SourceControlDirectoryRepository | null>(null);
  const [branches, setBranches] = useState<SourceControlRepositoryBranchesResult | null>(null);
  const [branchPage, setBranchPage] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  function reset() {
    generation.current += 1;
    setDirectory(null);
    setSelected(null);
    setBranches(null);
    setError(null);
    setPending(false);
  }
  async function load(nextPage: number, repository?: SourceControlDirectoryRepository) {
    const request = ++generation.current;
    setPending(true);
    setError(null);
    const input = {
      provider: SourceControlProviderKind.make("codeup"),
      apiHost: "openapi-rdc.aliyuncs.com",
      organizationId: organizationId.trim(),
      page: nextPage,
      perPage: 20,
    };
    if (repository) {
      setSelected(repository);
      setBranches(null);
      const result = await listBranches({
        environmentId,
        input: {
          ...input,
          repositoryId: repository.repositoryId,
          repository: repository.nameWithOwner,
        },
      });
      if (generation.current !== request) return;
      if (result._tag === "Success") {
        setBranches(result.value);
        setBranchPage(nextPage);
      } else setError(String(squashAtomCommandFailure(result)));
    } else {
      setSelected(null);
      setBranches(null);
      setDirectory(null);
      const result = await listRepositories({
        environmentId,
        input: { ...input, ...(search.trim() ? { search: search.trim() } : {}) },
      });
      if (generation.current !== request) return;
      if (result._tag === "Success") {
        setDirectory(result.value);
        setPage(nextPage);
      } else setError(String(squashAtomCommandFailure(result)));
    }
    setPending(false);
  }
  return (
    <section
      aria-label="Codeup repository directory"
      className="space-y-3 border-t px-4 py-3"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="text-sm font-medium">Browse Codeup repositories</div>
      <div className="flex gap-2">
        <Input
          aria-label="Codeup organization ID"
          placeholder="Organization ID"
          value={organizationId}
          onChange={(event) => {
            reset();
            setOrganizationId(event.target.value);
          }}
        />
        <Input
          aria-label="Repository search"
          placeholder="Search repositories"
          value={search}
          onChange={(event) => {
            reset();
            setSearch(event.target.value);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !organizationId.trim()}
          onClick={() => {
            void load(1);
          }}
        >
          Browse
        </Button>
      </div>
      {pending && (
        <p role="status" className="text-sm">
          Loading…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {directory && !selected && (
        <>
          <ul className="max-h-52 space-y-2 overflow-y-auto">
            {directory.repositories.map((repository) => (
              <li
                key={repository.repositoryId}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 break-all">{repository.nameWithOwner}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    void load(1, repository);
                  }}
                >
                  View branches
                </Button>
              </li>
            ))}
          </ul>
          {directory.repositories.length === 0 && (
            <p className="text-sm">No repositories on this page.</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || page === 1}
              onClick={() => {
                void load(page - 1);
              }}
            >
              Previous
            </Button>
            <span className="text-xs">Page {page}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || directory.nextPage === null}
              onClick={() => {
                if (directory.nextPage !== null) void load(directory.nextPage);
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}
      {selected && (
        <>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                generation.current += 1;
                setPending(false);
                setSelected(null);
                setBranches(null);
                setError(null);
              }}
            >
              Back to repositories
            </Button>
            <Button
              size="sm"
              disabled={pending || branches === null}
              onClick={() => {
                if (branches) onSelect(branches.repository);
              }}
            >
              Clone this repository
            </Button>
          </div>
          <p className="break-all text-sm">{selected.nameWithOwner}</p>
          {branches && (
            <>
              <p className="text-sm">
                Default branch: {branches.repository.defaultBranch ?? "Not reported"}
              </p>
              <ul className="max-h-52 space-y-2 overflow-y-auto text-xs">
                {branches.branches.map((branch) => (
                  <li key={branch.name} className="break-all">
                    <span className="font-medium">{branch.name}</span>
                    {branch.protected ? " · protected" : ""}
                    <div className="font-mono">{branch.sha}</div>
                  </li>
                ))}
              </ul>
              {branches.branches.length === 0 && (
                <p className="text-sm">No branches on this page.</p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || branchPage === 1}
                  onClick={() => {
                    void load(branchPage - 1, selected);
                  }}
                >
                  Previous
                </Button>
                <span className="text-xs">Page {branchPage}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || branches.nextPage === null}
                  onClick={() => {
                    if (branches.nextPage !== null) void load(branches.nextPage, selected);
                  }}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
