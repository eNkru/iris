"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card } from "./ui";
import { useI18n } from "../lib/i18n";

/**
 * Top-level render error boundary (frontend/components.md).
 *
 * Data-fetch errors are handled in-component via TanStack Query `isError` +
 * `ErrorBox`; this boundary catches the *render* path — a thrown error in a
 * presentational component (e.g. the Recharts subtree) would otherwise
 * unmount the whole tree and leave a blank page with no nav and no recovery.
 *
 * Renders a localized fallback Card with a Reload button. `resetKeys` clears
 * the boundary when it changes (e.g. on navigation) so the user can recover
 * without a manual reload.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  /** When this value changes, the boundary resets (recover on navigation). */
  resetKeys?: unknown[];
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Structured console warning — the browser already surfaces the throw;
    // there is no server logger on the client. Kept minimal on purpose.
    console.error("Uncaught render error", { error, info });
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error !== null && prevProps.resetKeys !== this.props.resetKeys) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error }: { error: Error }) {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-16 dark:bg-stone-950">
      <Card className="max-w-md space-y-4">
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-50">
          {t("errorBoundary.title")}
        </h1>
        <p className="text-sm leading-relaxed text-stone-500 dark:text-stone-400">
          {t("errorBoundary.description")}
        </p>
        {import.meta.env.DEV && error.message ? (
          <pre className="overflow-auto rounded-lg bg-stone-100 p-3 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {error.message}
          </pre>
        ) : null}
        <Button onClick={() => window.location.reload()}>
          {t("errorBoundary.reload")}
        </Button>
      </Card>
    </main>
  );
}
