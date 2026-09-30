import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { trackCaughtError } from "@/lib/analytics";
import { useTranslation } from "@/lib/i18n";

interface State {
  error: Error | null;
}

class ErrorBoundaryImpl extends Component<{ children: ReactNode; labels: { failed: string; retry: string; reload: string } }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Runs before React re-dispatches the same error to window.onerror, so this
    // (fatal) report registers the error and the global handler skips it.
    trackCaughtError(error, true);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 p-8">
          <p className="text-sm font-medium">{this.props.labels.failed}</p>
          <p className="max-w-lg text-center text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              {this.props.labels.retry}
            </Button>
            {/* Escape hatch when the error is deterministic and "Try again" just
                re-renders into the same crash — a full reload resets everything. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              {this.props.labels.reload}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundaryImpl labels={{
      failed: t("sharedUi.somethingWentWrong"),
      retry: t("sharedUi.tryAgain"),
      reload: t("sharedUi.reload"),
    }}>
      {children}
    </ErrorBoundaryImpl>
  );
}
