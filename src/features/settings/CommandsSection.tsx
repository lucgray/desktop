import { PencilSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { BUILTIN_COMMANDS } from "@/lib/ai/slash";
import { withForm } from "@/lib/form";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import type { CustomCommand } from "@/lib/settings/api";
import { settingsFormOpts } from "./settings-form";
import { useTranslation } from "@/lib/i18n";

const EMPTY_COMMAND: Omit<CustomCommand, "id"> = {
  name: "",
  description: "",
  prompt: "",
};

const BUILTIN_NAMES = new Set(
  BUILTIN_COMMANDS.map((c) => c.name.toLowerCase()),
);
const NAME_RE = /^[a-zA-Z0-9][\w-]*$/;

/** Normalizes a typed name to the allowed charset (lowercased, spaces→-). */
function normalizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}

/** Add/edit dialog for one custom command; mounted with a key so each open
 *  starts from fresh local state. */
function CommandDialog({
  initial,
  takenNames,
  onSave,
  onClose,
}: {
  initial: CustomCommand | null;
  /** Lowercased names already used by OTHER custom commands. */
  takenNames: Set<string>;
  onSave: (cmd: CustomCommand) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Omit<CustomCommand, "id">>(
    initial ?? EMPTY_COMMAND,
  );
  const set = <K extends keyof Omit<CustomCommand, "id">>(
    key: K,
    value: CustomCommand[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const name = normalizeName(draft.name);
  const prompt = draft.prompt.trim();
  const invalidName = draft.name.trim().length > 0 && !NAME_RE.test(name);
  const duplicate = name.length > 0 && takenNames.has(name);
  const overridesBuiltin = name.length > 0 && BUILTIN_NAMES.has(name);
  const canSave = name.length > 0 && prompt.length > 0 && !duplicate;

  function save() {
    if (!canSave) return;
    onSave({ id: initial?.id ?? crypto.randomUUID(), ...draft, name, prompt });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initial ? t("settingsAdvanced.editCommand") : t("settingsAdvanced.newSlashCommand")}
          </DialogTitle>
          <DialogDescription>
            {t("settingsAdvanced.reusablePrompt")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-[10rem_1fr] gap-3">
            <div className="space-y-2">
              <Label htmlFor="cc-name">{t("settingsAdvanced.mcpName")}</Label>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                <Input
                  id="cc-name"
                  autoFocus
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="ship"
                  className="font-mono"
                  aria-invalid={invalidName || duplicate}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cc-desc">{t("settingsAdvanced.mcpDescription")}</Label>
              <Input
                id="cc-desc"
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder={t("commandsUi.placeholderDescription")}
              />
            </div>
          </div>
          {duplicate && (
            <p className="text-xs text-destructive">
              {t("commandsUi.duplicateName", { name })}
            </p>
          )}
          {!duplicate && overridesBuiltin && (
            <p className="text-xs text-warning">
              {t("commandsUi.overridesBuiltin", { name })}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="cc-prompt">{t("settingsAdvanced.slashCommandPrompt")}</Label>
            <Textarea
              id="cc-prompt"
              value={draft.prompt}
              onChange={(e) => set("prompt", e.target.value)}
              placeholder={
                "Review the staged changes, then open a PR.\n\n$ARGUMENTS"
              }
              className="min-h-40 font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {t("commandsUi.argumentsHelp")}
            </p>
          </div>
        </div>

        <DialogFooter>
          {!canSave && !duplicate && (
            <p className="mr-auto self-center text-xs text-muted-foreground">
              {t("settingsAdvanced.commandRequired")}
            </p>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("commandsUi.cancel")}
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {initial ? t("settingsAdvanced.saveCommand") : t("settingsAdvanced.addCommand")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const CommandsSection = withForm({
  ...settingsFormOpts,
  render: function CommandsSectionRender({ form }) {
    const { t } = useTranslation();
    const commands = useSelector(form.store, (s) => s.values.customCommands);
    const [editing, setEditing] = useState<CustomCommand | "new" | null>(null);
    const [activeIndex, setActiveIndex] = useState(-1);

    const list = commands ?? [];

    // Removing rows shrinks `list` but not `activeIndex`, so clamp the stale
    // value (keeping -1 = "nothing active yet") to keep a row focusable.
    const safeActive =
      activeIndex >= list.length ? list.length - 1 : activeIndex;

    const onKeyDown = listKeyboardNav<CustomCommand>({
      items: list,
      activeIndex: safeActive,
      onActivate: (_c, to) => setActiveIndex(to),
      rowKey: (c) => c.id,
      rowAttr: "data-cc-row",
    });

    function setCommands(next: CustomCommand[]) {
      form.setFieldValue("customCommands", next);
    }

    function saveCommand(cmd: CustomCommand) {
      const exists = list.some((c) => c.id === cmd.id);
      setCommands(
        exists ? list.map((c) => (c.id === cmd.id ? cmd : c)) : [...list, cmd],
      );
      setEditing(null);
    }

    function removeCommand(id: string) {
      setCommands(list.filter((c) => c.id !== id));
    }

    const takenNames = (excludeId?: string) =>
      new Set(
        list
          .filter((c) => c.id !== excludeId)
          .map((c) => c.name.trim().toLowerCase())
          .filter(Boolean),
      );

    return (
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">{t("settings.slashCommands")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("commandsUi.sectionDescription")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setEditing("new")}
          >
            <PlusIcon data-icon="inline-start" /> {t("settingsAdvanced.addCommand")}
          </Button>
        </div>

        {list.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("commandsUi.noCommands", { path: ".claude/commands/*.md" })}
          </p>
        ) : (
          // A roving-focus list — arrow keys move between rows, Enter edits.
          <div className="space-y-2" onKeyDown={onKeyDown}>
            {list.map((cmd, i) => (
              <div
                key={cmd.id}
                data-cc-row={cmd.id}
                aria-label={t("commandsUi.commandRowAria", {
                  name: cmd.name,
                  description: cmd.description ? t("commandsUi.commandDescription", { description: cmd.description }) : "",
                })}
                tabIndex={
                  i === safeActive || (safeActive === -1 && i === 0) ? 0 : -1
                }
                onFocus={() => setActiveIndex(i)}
                onKeyDown={(e) => {
                  // Only the row itself edits on Enter — not when a child
                  // control (the Edit/Remove buttons) is focused.
                  if (e.key === "Enter" && e.target === e.currentTarget) {
                    e.preventDefault();
                    setEditing(cmd);
                  }
                }}
                className="flex items-center gap-2 rounded border px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <code className="shrink-0 font-mono text-xs font-medium">
                  /{cmd.name}
                </code>
                {cmd.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {cmd.description}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit /${cmd.name}`}
                    onClick={() => setEditing(cmd)}
                  >
                    <PencilSimpleIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove /${cmd.name}`}
                    onClick={() => removeCommand(cmd.id)}
                  >
                    <XIcon />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing !== null && (
          <CommandDialog
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            takenNames={takenNames(editing === "new" ? undefined : editing.id)}
            onSave={saveCommand}
            onClose={() => setEditing(null)}
          />
        )}
      </section>
    );
  },
});
