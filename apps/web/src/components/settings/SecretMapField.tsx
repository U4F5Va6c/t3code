import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { SettingsRow } from "./settingsLayout";

/** Each entry is saved separately by the server; redaction markers never enter a password input. */
export function SecretMapField({
  id,
  label,
  description,
  keyPlaceholder,
  value,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly keyPlaceholder?: string | undefined;
  readonly value: unknown;
  readonly onChange: (value: Record<string, string>) => void;
}) {
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const entries =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === "string" && entry[1].trim().length > 0,
          ),
        )
      : {};
  const normalizedKey = key.trim().toLowerCase();
  const canAdd =
    /^[a-z0-9][a-z0-9._/-]*$/u.test(normalizedKey) &&
    !Object.hasOwn(entries, normalizedKey) &&
    secret.trim().length > 0;
  return (
    <SettingsRow title={label} description={description}>
      <div className="mt-3 space-y-2">
        {Object.entries(entries).map(([entryKey]) => (
          <div key={entryKey} className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 break-all text-xs">{entryKey}</span>
            <div className="min-w-0 flex-1">
              <DraftInput
                key={String(entries[entryKey])}
                size="sm"
                type="password"
                autoComplete="off"
                value=""
                placeholder="Stored secret, enter a new value to replace"
                aria-label={`Token for ${entryKey}`}
                spellCheck={false}
                onCommit={(next) => {
                  if (next.trim()) onChange({ ...entries, [entryKey]: next.trim() });
                }}
              />
            </div>
            <Button
              type="button"
              size="icon-micro"
              variant="ghost-destructive"
              aria-label={`Remove ${entryKey}`}
              onClick={() => {
                const next = { ...entries };
                delete next[entryKey];
                onChange(next);
              }}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <Input
              id={`${id}-key`}
              size="sm"
              value={key}
              placeholder={keyPlaceholder ?? "Name"}
              aria-label={keyPlaceholder ?? "Secret name"}
              spellCheck={false}
              onChange={(event) => setKey(event.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              id={`${id}-value`}
              size="sm"
              type="password"
              autoComplete="off"
              value={secret}
              placeholder="Token"
              aria-label="New token"
              spellCheck={false}
              onChange={(event) => setSecret(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canAdd}
            onClick={() => {
              onChange({ ...entries, [normalizedKey]: secret.trim() });
              setKey("");
              setSecret("");
            }}
          >
            <PlusIcon />
            Add
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
}
