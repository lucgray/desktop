import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusDetailChip } from "@/components/status-detail-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  useGlDeleteVariable,
  useGlSetVariable,
  useGlVariables,
} from "@/lib/git/queries";
import type { GitLabVariable } from "@/lib/git/types";
import { useTranslation } from "@/lib/i18n";
import { toastError } from "@/lib/toast";
import { AsyncListBody, InlineConfirm } from "./parts";

function validKey(k: string): boolean {
  return /^[A-Za-z0-9_]{1,255}$/.test(k);
}

/** GitLab CI/CD variables — one store (vs GitHub's secrets/variables split):
 *  `masked` hides a value in job logs, `protected` limits it to protected
 *  refs. Values stay readable to maintainers, so they edit in place. */
export function GitLabVariablesSection({
  repoPath,
  open,
}: {
  repoPath: string;
  open: boolean;
}) {
  const { t } = useTranslation();
  const variables = useGlVariables(repoPath, open);
  const setVariable = useGlSetVariable(repoPath);
  const deleteVariable = useGlDeleteVariable(repoPath);

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [isProtected, setIsProtected] = useState(false);
  const [isMasked, setIsMasked] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Creates are always unscoped ("*"), so only an unscoped duplicate blocks.
  const keyTaken = (variables.data ?? []).some(
    (v) => v.key === key.trim() && v.environmentScope === "*",
  );
  const canAdd =
    validKey(key.trim()) &&
    value.length > 0 &&
    !keyTaken &&
    !setVariable.isPending;
  const keyWarning = key.trim()
    ? keyTaken
      ? t("repoSettings.variableKeyExists")
      : validKey(key.trim())
        ? null
        : t("repoSettings.variableKeyFormat")
    : null;

  // Awaited, not per-call callbacks: this subtree unmounts when the dialog
  // closes or the rail crossfades to another section, and react-query drops
  // per-call callbacks on unmount — the outcome would never reach the user.
  async function addVariable() {
    try {
      await setVariable.mutateAsync({
        key: key.trim(),
        value,
        protected: isProtected,
        masked: isMasked,
        create: true,
        scope: "*",
      });
      toast.success(t("repoSettings.variableAdded", { key: key.trim() }));
      setKey("");
      setValue("");
      setIsProtected(false);
      setIsMasked(false);
    } catch (e) {
      toastError(e);
    }
  }

  async function handleSave(variable: GitLabVariable, newValue: string) {
    try {
      await setVariable.mutateAsync({
        key: variable.key,
        value: newValue,
        protected: variable.protected,
        masked: variable.masked,
        create: false,
        scope: variable.environmentScope,
      });
      toast.success(t("repoSettings.variableUpdated", { key: variable.key }));
    } catch (e) {
      toastError(e);
    }
  }

  async function handleRemove(variable: GitLabVariable) {
    try {
      await deleteVariable.mutateAsync({
        key: variable.key,
        scope: variable.environmentScope,
      });
      toast.success(t("repoSettings.variableDeleted", { key: variable.key }));
      setConfirming(null);
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-2 rounded-md border p-3">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("repoSettings.variableKeyPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("repoSettings.valuePlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <Button size="sm" disabled={!canAdd} onClick={addVariable}>
            {setVariable.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            {t("repoSettings.add")}
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <Label className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={isProtected}
              onCheckedChange={(v) => setIsProtected(v === true)}
            />
            {t("repoSettings.protectedVariable")}
          </Label>
          <Label className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={isMasked}
              onCheckedChange={(v) => setIsMasked(v === true)}
            />
            {t("repoSettings.maskedVariable")}
          </Label>
        </div>
        {keyWarning && <p className="text-[11px] text-warning">{keyWarning}</p>}
      </div>

      <AsyncListBody
        loading={variables.isPending}
        error={variables.error}
        empty={variables.data?.length === 0}
        emptyLabel={t("repoSettings.noCiVariables")}
        skeletonClassName="h-11 w-full"
        errorTitle={t("repoSettings.loadVariablesFailed")}
        errorHint={t("repoSettings.manageCiVariablesMaintainer")}
      >
        {variables.data?.map((v) => {
          // A key can repeat at different environment scopes — address both.
          const rowId = `${v.key}\u0000${v.environmentScope}`;
          return (
            <VariableRow
              key={rowId}
              variable={v}
              saving={setVariable.isPending}
              onSave={(newValue) => handleSave(v, newValue)}
              confirming={confirming === rowId}
              pending={deleteVariable.isPending}
              onConfirm={() => setConfirming(rowId)}
              onCancel={() => setConfirming(null)}
              onRemove={() => handleRemove(v)}
            />
          );
        })}
      </AsyncListBody>
    </div>
  );
}

function VariableRow({
  variable,
  saving,
  onSave,
  confirming,
  pending,
  onConfirm,
  onCancel,
  onRemove,
}: {
  variable: GitLabVariable;
  saving: boolean;
  onSave: (value: string) => void;
  confirming: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(variable.value);
  const dirty = draft !== variable.value;

  return (
    <div className="space-y-1.5 rounded-md border p-2 text-xs">
      <div className="flex items-center gap-2">
        <p
          className="min-w-0 flex-1 truncate font-mono font-medium"
          title={variable.key}
        >
          {variable.key}
        </p>
        {variable.environmentScope !== "*" && (
          <StatusDetailChip
            variant="secondary"
            label={variable.environmentScope}
            detail={t("repoSettings.environmentScopeManagedGitLab")}
          />
        )}
        {variable.protected && <Badge variant="secondary">{t("repoSettings.protectedBadge")}</Badge>}
        {variable.masked && <Badge variant="secondary">{t("repoSettings.maskedBadge")}</Badge>}
        {confirming ? (
          <InlineConfirm
            prompt={t("repoSettings.deleteQuestion")}
            actLabel={t("repoSettings.delete")}
            pending={pending}
            onCancel={onCancel}
            onAct={onRemove}
          />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={onConfirm}
            title={t("repoSettings.delete")}
          >
            <XIcon />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 flex-1 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => onSave(draft)}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
