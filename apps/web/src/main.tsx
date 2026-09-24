import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { SessionProvider } from "./components/session-provider";
import { LanguageProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { App } from "./app";
import "./index.css";

/**
 * Client entry (design.md §Architecture). Mounts the provider stack:
 *
 * QueryClientProvider (server state) → SessionProvider (auth) →
 * LanguageProvider (i18n) → ThemeProvider → BrowserRouter (client routing) →
 * App (routes + app shell).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <LanguageProvider>
          <ThemeProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ThemeProvider>
        </LanguageProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
