import {
  BookOpenIcon,
  CompassIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GearIcon,
  GitForkIcon,
  QuestionIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUpdateCheck } from "@/features/updates/useUpdateCheck";
import { formatBinding } from "@/lib/hotkeys/binding";
import { dispatchAction, useEffectiveBindings } from "@/lib/hotkeys/hotkeys";
import type { ActionId } from "@/lib/hotkeys/registry";
import {
  useAiEnabled,
  useSaveSettings,
  useSettings,
} from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import { RecentRepoList } from "./RecentRepoList";

export function WelcomeScreen() {
  const { t } = useTranslation();
  const openSettings = useUiStore((s) => s.openSettings);
  const openHelp = useUiStore((s) => s.openHelp);
  const openExplore = useUiStore((s) => s.openExplore);
  const openMyWork = useUiStore((s) => s.openMyWork);
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const aiEnabled = useAiEnabled();
  const bindings = useEffectiveBindings();
  const updateAvailable = Boolean(useUpdateCheck().data);

  function dismissNudge() {
    if (settings.data) {
      saveSettings.mutate({ ...settings.data, seenGuideNudge: true });
    }
  }
  function openGuide() {
    dismissNudge();
    openHelp();
  }

  // The primary entry points, surfaced as a launcher: label on the left, the
  // live keyboard shortcut on the right (honours user remaps via bindings).
  const actions: {
    id: ActionId;
    labelKey: TranslationKey;
    icon: typeof FolderOpenIcon;
    variant: "default" | "outline";
    onClick: () => void;
  }[] = [
    {
      id: "add-local-repository",
      labelKey: "welcome.openRepository",
      icon: FolderOpenIcon,
      variant: "default",
      onClick: () => dispatchAction("add-local-repository"),
    },
    {
      id: "clone-repository",
      labelKey: "welcome.cloneRepository",
      icon: GitForkIcon,
      variant: "outline",
      onClick: () => dispatchAction("clone-repository"),
    },
    {
      id: "new-repository",
      labelKey: "welcome.createRepository",
      icon: FolderPlusIcon,
      variant: "outline",
      onClick: () => dispatchAction("new-repository"),
    },
    // My work sits with the shortcut-bearing actions above it; Explore, the
    // least-frequent (discovery) action, anchors the bottom.
    {
      id: "open-my-work",
      labelKey: "welcome.myWork",
      icon: TrayIcon,
      variant: "outline",
      onClick: openMyWork,
    },
    {
      id: "open-explore",
      labelKey: "welcome.exploreRepositories",
      icon: CompassIcon,
      variant: "outline",
      onClick: openExplore,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <BrandMark className="size-5" />
          <span className="text-sm font-medium">GitDesktop</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.userGuide")}
            title={`${t("common.userGuide")} (F1)`}
            onClick={openHelp}
          >
            <QuestionIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label={
              updateAvailable ? "Settings — update available" : t("common.settings")
            }
            title={updateAvailable ? "Settings — update available" : t("common.settings")}
            onClick={() => openSettings()}
          >
            <GearIcon />
            {updateAvailable && (
              <span
                aria-hidden
                className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background animate-in fade-in motion-reduce:animate-none"
              />
            )}
          </Button>
        </div>
      </header>

      {/* overflow-hidden contains the content's natural height (vendored Root is
          `relative`-only), so a tall welcome pane can't leak a window scrollbar. */}
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        {/* `my-auto` centers the content while it fits and resolves to zero once
            it doesn't — unlike `justify-center`, which would push the top of an
            overflowing pane out of the scrollable region. */}
        <main className="mx-auto flex min-h-full w-full max-w-4xl flex-col p-8">
          <div className="my-auto flex w-full flex-col gap-6">
            {settings.data && !settings.data.seenGuideNudge && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border bg-muted/40 px-3 py-2">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <BookOpenIcon className="size-4 shrink-0 text-foreground" />
                  {t("welcome.newToGitDesktop")}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="xs" variant="ghost" onClick={dismissNudge}>
                    {t("welcome.dismiss")}
                  </Button>
                  <Button size="xs" onClick={openGuide}>
                    {t("welcome.openGuide")}
                  </Button>
                </span>
              </div>
            )}

            <div className="grid items-center gap-y-8 md:grid-cols-2">
              <div className="flex flex-col gap-6 md:pr-10">
                <div className="space-y-2">
                  <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
                    {t("welcome.headline")}
                  </h1>
                  <p className="text-xs/relaxed text-muted-foreground">
                    {t("welcome.openToStart")}
                    {aiEnabled ? t("welcome.withAi") : "."}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-col gap-2">
                    {actions.map(
                      ({ id, labelKey, icon: Icon, variant, onClick }) => {
                        const binding = bindings.get(id);
                        return (
                          <Button
                            key={id}
                            variant={variant}
                            onClick={onClick}
                            className="w-full justify-between"
                          >
                            <span className="flex items-center gap-2">
                              <Icon className="size-4" />
                              {t(labelKey)}
                            </span>
                            {binding && (
                              <span className="text-[11px] tabular-nums opacity-60">
                                {formatBinding(binding)}
                              </span>
                            )}
                          </Button>
                        );
                      },
                    )}
                  </div>
                  <p className="pt-1 text-[11px] text-muted-foreground">
                    {t("welcome.dragRepo")}
                  </p>
                </div>
              </div>

              <div className="self-stretch md:border-l md:border-border md:pl-10">
                <RecentRepoList />
              </div>
            </div>
          </div>
        </main>
      </ScrollArea>
    </div>
  );
}
