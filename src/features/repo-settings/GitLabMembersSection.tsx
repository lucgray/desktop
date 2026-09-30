import { UserPlusIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { ForgeUserAvatar } from "@/components/forge-user-avatar";
import { StatusDetailChip } from "@/components/status-detail-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  useGlAddMember,
  useGlMembers,
  useGlRemoveMember,
  useGlUpdateMember,
} from "@/lib/git/queries";
import type { GitLabMember } from "@/lib/git/types";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { AsyncListBody, InlineConfirm } from "./parts";

/** The roles the app offers (the classic five — Planner is newer and not
 *  accepted by older self-managed instances; it still DISPLAYS if present). */
const ROLES: { value: number; key: TranslationKey }[] = [
  { value: 10, key: "repoSettings.roleGuest" },
  { value: 20, key: "repoSettings.roleReporter" },
  { value: 30, key: "repoSettings.roleDeveloper" },
  { value: 40, key: "repoSettings.roleMaintainer" },
  { value: 50, key: "repoSettings.roleOwner" },
];

function roleLabel(level: number, t: ReturnType<typeof useTranslation>["t"]): string {
  if (level === 15) return t("repoSettings.rolePlanner");
  const role = ROLES.find((r) => r.value === level);
  return role ? t(role.key) : t("repoSettings.roleLevel", { level });
}

function validUsername(u: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(u);
}

/** The GitLab counterpart of {@link CollaboratorsSection}: numeric access
 *  levels instead of role names, and members inherited from a group show
 *  read-only (they're managed on the group, not the project). */
export function GitLabMembersSection({
  repoPath,
  open,
}: {
  repoPath: string;
  open: boolean;
}) {
  const { t } = useTranslation();
  const members = useGlMembers(repoPath, open);
  const add = useGlAddMember(repoPath);
  const update = useGlUpdateMember(repoPath);
  const remove = useGlRemoveMember(repoPath);

  const [username, setUsername] = useState("");
  const [level, setLevel] = useState(30);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const canAdd = validUsername(username.trim()) && !add.isPending;

  const memberRows = members.data ?? [];

  // Awaited, not per-call callbacks: this subtree unmounts when the dialog
  // closes or the rail crossfades to another section, and react-query drops
  // per-call callbacks on unmount — the outcome would never reach the user.
  async function addMember() {
    try {
      await add.mutateAsync({ username: username.trim(), accessLevel: level });
      toast.success(t("repoSettings.memberAdded"));
      setUsername("");
    } catch (e) {
      toastError(e);
    }
  }

  async function handleRole(member: GitLabMember, accessLevel: number) {
    try {
      await update.mutateAsync({ userId: member.id, accessLevel });
      toast.success(t("repoSettings.memberRoleUpdated", { username: member.username, role: roleLabel(accessLevel, t) }));
    } catch (e) {
      toastError(e);
    }
  }

  async function handleRemove(member: GitLabMember) {
    try {
      await remove.mutateAsync(member.id);
      toast.success(t("repoSettings.memberRemoved", { username: member.username }));
      setConfirming(null);
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="rounded-md border p-3">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("repoSettings.gitLabUsername")}
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAdd) void addMember();
            }}
          />
          <Select
            value={String(level)}
            onValueChange={(v) => v && setLevel(Number(v))}
            itemToStringLabel={(v) => roleLabel(Number(v), t)}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={String(r.value)}>
                  {t(r.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!canAdd} onClick={addMember}>
            {add.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <UserPlusIcon data-icon="inline-start" />
            )}
            {t("repoSettings.add")}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("repoSettings.gitLabMemberGrantHelp")}
        </p>
      </div>

      <AsyncListBody
        loading={members.isPending}
        error={members.error}
        empty={members.data?.length === 0}
        emptyLabel={t("repoSettings.noMembersYet")}
        skeletonClassName="h-11 w-full"
        errorTitle={t("repoSettings.loadMembersFailed")}
        errorHint={t("repoSettings.manageMembersMaintainer")}
      >
        <div
          role="listbox"
          aria-label={t("repoSettings.members")}
          tabIndex={0}
          className="space-y-2 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onKeyDown={listKeyboardNav({
            items: memberRows,
            activeIndex,
            onActivate: (_m, to) => setActiveIndex(to),
            rowKey: (m) => m.id,
            rowAttr: "data-member",
          })}
        >
          {memberRows.map((m, i) => (
            <MemberRow
              key={m.id}
              member={m}
              active={i === activeIndex}
              onFocus={() => setActiveIndex(i)}
              updating={update.isPending}
              onRole={(accessLevel) => handleRole(m, accessLevel)}
              confirming={confirming === m.id}
              pending={remove.isPending}
              onConfirm={() => setConfirming(m.id)}
              onCancel={() => setConfirming(null)}
              onRemove={() => handleRemove(m)}
            />
          ))}
        </div>
      </AsyncListBody>

      <p className="text-[11px] text-muted-foreground">
        {t("repoSettings.inheritedMembersHelp")}
      </p>
    </div>
  );
}

function MemberRow({
  member,
  active,
  onFocus,
  updating,
  onRole,
  confirming,
  pending,
  onConfirm,
  onCancel,
  onRemove,
}: {
  member: GitLabMember;
  active: boolean;
  onFocus: () => void;
  updating: boolean;
  onRole: (level: number) => void;
  confirming: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="option"
      aria-selected={active}
      data-member={member.id}
      tabIndex={-1}
      onFocus={onFocus}
      className={cn(
        "flex items-center gap-2 rounded-md border p-2 text-xs outline-none",
        active && "ring-1 ring-ring",
      )}
    >
      <ForgeUserAvatar
        login={member.username}
        avatarUrl={member.avatarUrl}
        decorative
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={member.username}>
          {member.username}
        </p>
      </div>
      {!member.direct ? (
        <StatusDetailChip
          variant="secondary"
          label={`${roleLabel(member.accessLevel, t)} · ${t("repoSettings.inherited")}`}
          detail={t("repoSettings.managedOnGroup")}
        />
      ) : confirming ? (
        <InlineConfirm
          prompt={t("repoSettings.removeQuestion")}
          actLabel={t("repoSettings.remove")}
          pending={pending}
          onCancel={onCancel}
          onAct={onRemove}
        />
      ) : (
        <>
          <Select
            value={String(member.accessLevel)}
            disabled={updating}
            onValueChange={(v) => v && onRole(Number(v))}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue>{roleLabel(member.accessLevel, t)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={String(r.value)}>
                  {t(r.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={onConfirm}
            title={t("repoSettings.remove")}
          >
            <XIcon />
          </Button>
        </>
      )}
    </div>
  );
}
