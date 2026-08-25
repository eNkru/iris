import { Route, Routes, useLocation } from "react-router";
import { ErrorBoundary } from "./components/error-boundary";
import { HomePage } from "./routes/home";
import { LoginPage } from "./routes/login";
import { NotFoundPage } from "./routes/not-found";
import { ProductDetailPage } from "./routes/product";
import { SettingsPage } from "./routes/settings";

/**
 * Root App component: React Router route definitions (design.md §Architecture).
 *
 * The layout shell (Providers → BrowserRouter → routes) is composed in
 * `src/main.tsx`. Each route page renders its own `AuthGate` + `AppShell`
 * wrapper (same pattern as the former Next App Router pages).
 *
 * Routes:
 * - `/`                → Home (product list + add form)
 * - `/login`           → Magic-link login
 * - `/products/:id`    → Product detail (chart + edit form)
 * - `/settings`        → User + admin settings
 * - `*`                → Not-found (catch-all, so unknown paths render chrome
 *                       instead of an empty shell)
 *
 * A top-level `ErrorBoundary` wraps the routes so a render-path throw (e.g.
 * inside the Recharts subtree) shows a recoverable fallback instead of
 * unmounting the whole tree to a blank page. The boundary resets on
 * navigation (`location.pathname`) so a bad route can be left behind.
 */
export function App() {
  const location = useLocation();

  return (
    <ErrorBoundary resetKeys={[location.pathname]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
