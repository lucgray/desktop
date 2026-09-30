import { useId, useState } from "react";
import { LabeledGroup } from "@/components/form/labeled-group";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deleteMcpSecret, setMcpSecret } from "@/lib/git/api";
import { MCP_TRANSPORTS, type McpServer } from "@/lib/settings/api";
import {
  emptyMcpServer,
  entriesFor,
  MCP_SCOPE_GLOBAL,
  mcpHostAllowFixable,
  scopeRepoPath,
  serverScope,
  validateMcpServer,
} from "@/lib/settings/mcp";
import { useRepoKeys } from "@/lib/settings/queries";
import { toastError } from "@/lib/toast";
import { useTranslation } from "@/lib/i18n";
import { HostAllowNote } from "../HostAllowNote";
import { EntryEditor } from "./EntryEditor";
import { type EntryRow, repoBasename } from "./shared";

function toRows(server: McpServer): EntryRow[] {
  const secretKeys = new Set(server.secretKeys);
  return entriesFor(server).map((e) => ({
    rowId: crypto.randomUUID(),
    key: e.key,
    value: e.value,
    secret: secretKeys.has(e.key),
    secretInput: "",
  }));
}

/** Add/edit dialog for one MCP server. Mounted with a `key` so each open starts
 *  from fresh local state. Save persists secret values to the OS keychain, then
 *  hands the (secret-free) server up to the settings form. */
export function McpServerDialog({
  initial,
  others,
  repoPath,
  repoName,
  allowedHosts,
  onAllowHost,
  onSave,
  onClose,
}: {
  initial: McpServer | null;
  /** The other servers in the registry, for duplicate-name detection. */
  others: McpServer[];
  /** The repo open behind Settings (for the "This repo" scope option). */
  repoPath: string | null;
  repoName: string | null;
  /** The draft AI allow list (the settings form both screens share). An http URL
   *  pointing at a host that isn't on it blocks Save until the host is added. */
  allowedHosts: string[];
  /** Add a URL's host to the draft allow list — the one-click fix behind the
   *  host note. Mutates the draft settings, not persisted settings. */
  onAllowHost: (url: string) => void;
  onSave: (server: McpServer) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Per-mount base for the field ids (label↔control association).
  const idBase = useId();
  const editing = initial !== null;
  const [draft, setDraft] = useState<McpServer>(initial ?? emptyMcpServer());
  const [rows, setRows] = useState<EntryRow[]>(initial ? toRows(initial) : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStdio = draft.transport === "stdio";
  const set = <K extends keyof McpServer>(key: K, value: McpServer[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setRow = (rowId: string, patch: Partial<EntryRow>) =>
    setRows((rs) =>
      rs.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    );

  // Scope/override lookup keys for the open repo: [repoPath] while its identity
  // resolves, [repoPath, identity] once it does. A server scoped under EITHER the
  // raw checkout path (legacy) or the worktree-stable identity counts as "this
  // repo", so a scope set from a sibling worktree is recognized here.
  const repoKeys = useRepoKeys(repoPath);
  // The canonical value the "This repo" option stores + selects with: the resolved
  // identity when available (so new/changed scopes are identity-keyed, matching
  // fold-on-write), else the raw path.
  const thisRepoKey = repoKeys.length ? repoKeys[repoKeys.length - 1] : null;

  const curScope = serverScope(draft);
  // Is the draft repo-scoped to the OPEN repo (under any of its keys)? Legacy
  // raw-path scopes for the current repo read as "this repo" too — repoKeys
  // includes the raw path — so they select the "This repo" option, not "other".
  const scopedToThisRepo =
    curScope !== MCP_SCOPE_GLOBAL && repoKeys.includes(curScope);

  // Scope choices: always Global; "This repo" when one is open; plus the server's
  // own scope when it points at a DIFFERENT repo (editing it elsewhere), so that
  // assignment is preserved rather than silently dropped.
  const scopeOptions: { value: string; label: string }[] = [
    { value: MCP_SCOPE_GLOBAL, label: t("dataUi.repoScope.global") },
  ];
  if (repoPath && thisRepoKey)
    scopeOptions.push({
      value: thisRepoKey,
      label: t("dataUi.repoScope.thisRepo", { name: repoName ?? repoBasename(repoPath) }),
    });
  if (curScope !== MCP_SCOPE_GLOBAL && !scopedToThisRepo)
    scopeOptions.push({
      value: curScope,
      // The stored scope is a worktree-stable identity key (`…/.git`); show the
      // containing repo folder, never a bare ".git".
      label: t("dataUi.repoScope.otherRepo", { name: repoBasename(scopeRepoPath(curScope)) }),
    });
  // The Select's value must equal an option value. A draft scoped to the current
  // repo under a legacy raw path (curScope) won't equal the canonical "This repo"
  // option value (the identity); normalize to it so the option stays selected.
  // The `?? curScope` arm is type-level only: `scopedToThisRepo` implies repoKeys
  // is non-empty, so `thisRepoKey` is non-null here — the fallback is unreachable
  // at runtime, but TS can't narrow `thisRepoKey` across the `scopedToThisRepo`
  // check, so removing it fails the null check.
  const selectedScope = scopedToThisRepo ? (thisRepoKey ?? curScope) : curScope;

  // Reconstruct a candidate server from the live draft + rows for validation.
  function candidate(): McpServer {
    const entries = rows.map((r) => ({
      key: r.key.trim(),
      value: r.secret ? "" : r.value,
    }));
    const secretKeys = rows.filter((r) => r.secret).map((r) => r.key.trim());
    return {
      ...draft,
      name: draft.name.trim(),
      args: draft.args,
      env: isStdio ? entries : [],
      headers: isStdio ? [] : entries,
      secretKeys,
    };
  }

  const validationError = validateMcpServer(candidate(), others, allowedHosts);

  async function save() {
    if (validationError) {
      setError(validationError);
      return;
    }
    const server = candidate();
    setSaving(true);
    setError(null);
    try {
      // Write any newly-typed secret values to the keychain (keyed per server +
      // entry name); only the names are kept in `secretKeys`, never the values.
      for (const row of rows) {
        if (row.secret && row.secretInput.trim())
          await setMcpSecret(server.id, row.key.trim(), row.secretInput);
      }
      // Clean up keychain entries for keys that are no longer secret (renamed,
      // removed, or flipped back to a plain value).
      const liveSecretKeys = new Set(server.secretKeys);
      for (const old of initial?.secretKeys ?? []) {
        if (!liveSecretKeys.has(old)) await deleteMcpSecret(server.id, old);
      }
      onSave(server);
    } catch (e) {
      setSaving(false);
      toastError(e);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("settingsAdvanced.editMcp") : t("settingsAdvanced.addMcp")}
          </DialogTitle>
          <DialogDescription>
            {t("mcpUi.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-1">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${idBase}-name`}>{t("settingsAdvanced.mcpName")}</Label>
              <Input
                id={`${idBase}-name`}
                autoFocus
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="filesystem"
                className="font-mono"
                spellCheck={false}
              />
            </div>
            <LabeledGroup label={t("settingsAdvanced.mcpTransport")}>
              <div className="flex gap-1">
                {MCP_TRANSPORTS.map((transport) => (
                  <Button
                    key={transport}
                    type="button"
                    size="sm"
                    variant={draft.transport === transport ? "default" : "outline"}
                    aria-pressed={draft.transport === transport}
                    className="flex-1"
                    onClick={() => set("transport", transport)}
                  >
                    {transport === "stdio" ? t("mcpUi.localStdio") : t("mcpUi.remoteHttp")}
                  </Button>
                ))}
              </div>
            </LabeledGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idBase}-desc`}>{t("settingsAdvanced.mcpDescription")}</Label>
            <Input
              id={`${idBase}-desc`}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={t("settingsAdvanced.localFileOperations")}
            />
          </div>

          {scopeOptions.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor={`${idBase}-scope`}>{t("settingsAdvanced.mcpScope")}</Label>
              <Select
                value={selectedScope}
                onValueChange={(v) => v && set("scope", v)}
                // Without `items`, Base UI's SelectValue renders the RAW value in
                // the trigger — for an identity-keyed scope that's a bare
                // "…/.git" path. The map makes the trigger show the option label.
                items={Object.fromEntries(
                  scopeOptions.map((o) => [o.value, o.label]),
                )}
              >
                <SelectTrigger
                  id={`${idBase}-scope`}
                  size="sm"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("mcpUi.repoScopeHint")}
              </p>
            </div>
          )}

          {isStdio ? (
            <>
              <div className="space-y-2">
                <Label htmlFor={`${idBase}-command`}>{t("settingsAdvanced.mcpCommand")}</Label>
                <Input
                  id={`${idBase}-command`}
                  value={draft.command}
                  onChange={(e) => set("command", e.target.value)}
                  placeholder="npx"
                  className="font-mono"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idBase}-args`}>{t("settingsAdvanced.mcpArguments")}</Label>
                <Textarea
                  id={`${idBase}-args`}
                  value={draft.args.join("\n")}
                  onChange={(e) =>
                    set(
                      "args",
                      e.target.value.split("\n").map((a) => a.trimEnd()),
                    )
                  }
                  onBlur={() =>
                    set("args", draft.args.map((a) => a.trim()).filter(Boolean))
                  }
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
                  className="min-h-24 font-mono"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {t("mcpUi.oneArgumentPerLine")}
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`${idBase}-url`}>{t("settingsAdvanced.mcpUrl")}</Label>
              <Input
                id={`${idBase}-url`}
                value={draft.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className="font-mono"
                spellCheck={false}
              />
              {/* The guided fix for the registration gate: Save stays blocked
                  (validateMcpServer carries the same host check) until this host
                  is on the draft allow list, and allowing it here clears both.
                  Mounted only where Allow host actually clears the block — with
                  `defaultNote={null}` the all-clear branch renders an empty <p>,
                  and a malformed or non-http(s) URL is refused for a reason no
                  host can fix. */}
              {mcpHostAllowFixable(draft, allowedHosts) && (
                <HostAllowNote
                  url={draft.url}
                  allowedHosts={allowedHosts}
                  onAllowHost={onAllowHost}
                  defaultNote={null}
                  consequence={t("mcpUi.allowlistConsequence")}
                />
              )}
            </div>
          )}

          <EntryEditor
            label={isStdio ? t("settingsAdvanced.mcpEnvironment") : t("settingsAdvanced.mcpHeaders")}
            keyPlaceholder={isStdio ? "API_KEY" : "Authorization"}
            rows={rows}
            editing={editing}
            onAdd={() =>
              setRows((rs) => [
                ...rs,
                {
                  rowId: crypto.randomUUID(),
                  key: "",
                  value: "",
                  secret: false,
                  secretInput: "",
                },
              ])
            }
            onChange={setRow}
            onRemove={(rowId) =>
              setRows((rs) => rs.filter((r) => r.rowId !== rowId))
            }
          />

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("settingsAdvanced.mcpEnabled")}</p>
              <p className="text-xs text-muted-foreground">
                {t("mcpUi.enabledHint")}
              </p>
            </div>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(v) => set("enabled", v)}
            />
          </label>
        </div>

        <DialogFooter>
          {error ? (
            <p className="mr-auto self-center text-xs text-destructive">
              {error}
            </p>
          ) : validationError ? (
            <p className="mr-auto self-center text-xs text-muted-foreground">
              {validationError}
            </p>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("mcpUi.cancel")}
          </Button>
          <Button onClick={save} disabled={!!validationError || saving}>
            {editing ? t("settingsAdvanced.mcpSaveChanges") : t("settingsAdvanced.mcpAddServer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
