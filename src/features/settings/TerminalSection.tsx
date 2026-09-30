import { WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { PathText } from "@/components/path-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { withForm } from "@/lib/form";
import { detectTerminals } from "@/lib/git/api";
import { isWindows, type Platform, platform } from "@/lib/hotkeys/binding";
import { settingsFormOpts } from "./settings-form";
import { useTranslation } from "@/lib/i18n";

const DEFAULT = "__default__";
const CUSTOM = "__custom__";
const CUSTOM_COMMAND = "__custom_command__";

const CUSTOM_PLACEHOLDERS: Record<Platform, string> = {
  windows: "C:\\path\\to\\terminal.exe",
  mac: "/Applications/iTerm.app",
  linux: "/usr/bin/alacritty",
};
const CUSTOM_PLACEHOLDER = CUSTOM_PLACEHOLDERS[platform];

// A representative shell-free command per platform, showing the {path} token.
const CUSTOM_COMMAND_PLACEHOLDERS: Record<Platform, string> = {
  windows: "wt -d {path}",
  mac: "wezterm start --cwd {path}",
  linux: "tmux new-window -c {path}",
};
const CUSTOM_COMMAND_PLACEHOLDER = CUSTOM_COMMAND_PLACEHOLDERS[platform];

export const TerminalSection = withForm({
  ...settingsFormOpts,
  render: function TerminalSectionRender({ form }) {
    const { t } = useTranslation();
    const defaultLabel = platform === "windows" ? t("remainingUi.terminalDefaultWindows") : platform === "mac" ? t("remainingUi.terminalDefaultMac") : t("remainingUi.terminalDefaultLinux");
    const detected = useQuery({
      queryKey: ["detected-terminals"],
      queryFn: detectTerminals,
      staleTime: 5 * 60 * 1000,
      // A local probe: react-query's default "online" mode would park it offline.
      networkMode: "always",
    });

    const terminal = useSelector(form.store, (s) => s.values.terminal);
    const terminalPath = useSelector(form.store, (s) => s.values.terminalPath);
    const terminalCommand = useSelector(
      form.store,
      (s) => s.values.terminalCommand,
    );

    const terminals = detected.data ?? [];
    const matched = terminals.find((t) => t.id === terminal);
    const isCustom = terminal === "custom";
    const isCustomCommand = terminal === "custom-command";
    const selectValue = isCustomCommand
      ? CUSTOM_COMMAND
      : terminal === ""
        ? DEFAULT
        : isCustom
          ? CUSTOM
          : (matched?.id ?? CUSTOM);
    const showCustom = selectValue === CUSTOM;
    const showCustomCommand = selectValue === CUSTOM_COMMAND;
    // Non-blocking hint: a template without {path} still runs (it starts in the
    // repo directory), but the user probably meant to reference the repo.
    const missingPathToken =
      showCustomCommand &&
      terminalCommand.trim() !== "" &&
      !terminalCommand.includes("{path}");

    // Base UI's Select.Value renders the raw value unless given value→label items
    const selectItems: Record<string, string> = {
      [DEFAULT]: defaultLabel,
      [CUSTOM]: t("remainingUi.terminalCustom"),
      [CUSTOM_COMMAND]: t("remainingUi.terminalCustomCommand"),
      ...Object.fromEntries(terminals.map((t) => [t.id, t.name])),
    };

    // Only ever writes `terminal`/`terminalPath`, leaving `terminalCommand`
    // untouched — so switching between modes preserves the other mode's value.
    function setTerminal(kind: string, path: string) {
      form.setFieldValue("terminal", kind);
      form.setFieldValue("terminalPath", path);
    }

    async function choose() {
      const picked = await openDialog({
        title: t("remainingUi.terminalChooseTitle"),
        // Windows programs are .exe/.cmd/.bat; macOS terminals are `.app`
        // bundles and Linux ones are bare binaries, so don't filter there.
        filters: isWindows
          ? [{ name: "Programs", extensions: ["exe", "cmd", "bat"] }]
          : undefined,
      });
      if (picked) setTerminal("custom", picked);
    }

    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">{t("settings.panelTerminal")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("remainingUi.terminalDescription")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="terminal-select">{t("settings.application")}</Label>
          <Select
            items={selectItems}
            value={selectValue}
            onValueChange={(value) => {
              if (value === DEFAULT) {
                setTerminal("", "");
              } else if (value === CUSTOM) {
                // Flip the mode only; keep terminalPath (and terminalCommand)
                // so switching back and forth doesn't wipe the other value.
                if (!isCustom) form.setFieldValue("terminal", "custom");
              } else if (value === CUSTOM_COMMAND) {
                if (!isCustomCommand)
                  form.setFieldValue("terminal", "custom-command");
              } else if (value) {
                const t = terminals.find((x) => x.id === value);
                if (t) setTerminal(t.id, t.path);
              }
            }}
          >
            <SelectTrigger id="terminal-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
              {terminals.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>{t("remainingUi.terminalCustom")}</SelectItem>
              <SelectItem value={CUSTOM_COMMAND}>{t("remainingUi.terminalCustomCommand")}</SelectItem>
            </SelectContent>
          </Select>
          {detected.isPending && (
            <p className="text-xs text-muted-foreground">
              {t("remainingUi.terminalDetecting")}
            </p>
          )}
          {!showCustom && matched && (
            <PathText
              path={matched.path}
              className="font-mono text-xs text-muted-foreground"
            />
          )}
        </div>
        {showCustom && (
          <div className="space-y-2">
            <Label htmlFor="custom-terminal">{t("settings.programPath")}</Label>
            <div className="flex gap-2">
              <Input
                id="custom-terminal"
                className="flex-1 font-mono"
                placeholder={CUSTOM_PLACEHOLDER}
                autoComplete="off"
                value={terminalPath}
                onChange={(e) => setTerminal("custom", e.target.value)}
              />
              <Button type="button" variant="outline" onClick={choose}>
                {t("remainingUi.terminalChoose")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("remainingUi.terminalLaunchedHint")}
            </p>
          </div>
        )}
        {showCustomCommand && (
          <div className="space-y-2">
            <Label htmlFor="custom-terminal-command">{t("settings.command")}</Label>
            <Input
              id="custom-terminal-command"
              className="font-mono"
              placeholder={CUSTOM_COMMAND_PLACEHOLDER}
              autoComplete="off"
              spellCheck={false}
              value={terminalCommand}
              onChange={(e) =>
                form.setFieldValue("terminalCommand", e.target.value)
              }
            />
            <p className="text-xs text-muted-foreground">
              {t("remainingUi.terminalCommandHelp")}
            </p>
            {missingPathToken && (
              <p
                role="status"
                className="flex items-center gap-1 text-xs text-warning"
              >
                <WarningCircleIcon className="size-3.5 shrink-0" />
                {t("remainingUi.terminalMissingPath")}
              </p>
            )}
          </div>
        )}
      </section>
    );
  },
});
