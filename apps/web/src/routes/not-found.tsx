import { useNavigate } from "react-router";
import { AppShell } from "../components/app-shell";
import { AuthGate } from "../components/auth-gate";
import { Button, Card, PageHeader } from "../components/ui";
import { useI18n } from "../lib/i18n";

/**
 * Catch-all 404 route. Wraps in `AuthGate` + `AppShell` so an unknown path for
 * an authenticated user still renders the app chrome (nav/footer) and offers a
 * way back; an unauthenticated user is redirected to /login by AuthGate just
 * like any other protected route.
 */
export function NotFoundPage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <AuthGate>
      <AppShell>
        <PageHeader title={t("notFound.title")} description={t("notFound.description")} />
        <Card className="max-w-md">
          <Button onClick={() => navigate("/")}>{t("notFound.backHome")}</Button>
        </Card>
      </AppShell>
    </AuthGate>
  );
}
