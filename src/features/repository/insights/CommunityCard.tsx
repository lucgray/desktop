import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import type { CommunityInsights } from "@/lib/git/types";
import { useTranslation } from "@/lib/i18n";
import { fmt, Stat } from "./primitives";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircleIcon
          weight="fill"
          className="size-3.5 shrink-0 text-success"
        />
      ) : (
        <XCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className={ok ? undefined : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

export function CommunityCard({ data }: { data: CommunityInsights }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-8">
        <Stat label="Stars">{fmt(data.stargazersCount)}</Stat>
        <Stat label="Forks">{fmt(data.forksCount)}</Stat>
        <Stat label="Watchers">{fmt(data.watchersCount)}</Stat>
        <Stat label={t("insightsUi.openIssues")}>{fmt(data.openIssuesCount)}</Stat>
      </dl>
      <div>
        <p className="mb-1 text-xs">
          {t("insightsUi.communityHealth")}{" "}
          <span className="font-medium tabular-nums">
            {data.healthPercentage}%
          </span>
          {data.license && (
            <span className="text-muted-foreground"> · {data.license}</span>
          )}
        </p>
        <ul className="space-y-0.5">
          <Check ok={data.hasReadme} label="README" />
          <Check ok={data.hasLicense} label="License" />
          <Check ok={data.hasCodeOfConduct} label={t("insightsUi.codeOfConduct")} />
          <Check ok={data.hasContributing} label={t("insightsUi.contributingGuide")} />
          <Check ok={data.hasIssueTemplate} label={t("insightsUi.issueTemplates")} />
          <Check
            ok={data.hasPullRequestTemplate}
            label={t("insightsUi.pullRequestTemplate")}
          />
        </ul>
      </div>
    </div>
  );
}
