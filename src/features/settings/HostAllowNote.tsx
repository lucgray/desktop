import { WarningIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isHostAllowed, normalizeHost } from "@/lib/ai/allowed-hosts";
import { useTranslation } from "@/lib/i18n";

/**
 * The note under a custom provider URL. When the URL points at a host that isn't
 * built-in / local / already allowed, it surfaces *why* the host matters and a
 * one-click **Allow host** that adds it to the allowlist — turning a silent block
 * into a guided fix. Otherwise it shows the muted default note.
 *
 * `consequence` is the clause after "isn't an allowed host yet — " and states
 * what follows in this context: on the AI provider fields the request is blocked
 * (the default), while the MCP registration seams block saving/importing/adding
 * the server until the host is allowed, so each caller passes its own wording.
 */
export function HostAllowNote({
  url,
  allowedHosts,
  onAllowHost,
  defaultNote,
  consequence,
}: {
  url: string;
  allowedHosts: string[];
  onAllowHost: (url: string) => void;
  defaultNote: ReactNode;
  consequence?: ReactNode;
}) {
  const { t } = useTranslation();
  const host = normalizeHost(url);
  if (!host || isHostAllowed(url, allowedHosts)) {
    return <p className="text-xs text-muted-foreground">{defaultNote}</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-warning">
      <WarningIcon className="size-4 shrink-0" />
      <span>
        <code className="font-mono">{host}</code> {t("mcpUi.hostNotAllowed")}{" "}
        {consequence ?? t("mcpUi.defaultBlocked")}
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => onAllowHost(url)}
      >
        {t("mcpUi.allowHost")}
      </Button>
    </p>
  );
}
