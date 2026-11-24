import "@fontsource-variable/sofia-sans/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { ApiError } from "./lib/api";
import { useLang } from "./lib/i18n";
import { OverlayProvider } from "./lib/overlays";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

/** Re-render the whole app when the language changes and refetch server texts */
function LangRoot() {
  const lang = useLang();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void queryClient.invalidateQueries();
  }, [lang]);
  return <App key={lang} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OverlayProvider>
          <LangRoot />
          <Toaster
            position="top-center"
            toastOptions={{
              classNames: {
                toast: "!rounded-xl !border-line !bg-surface !text-ink !shadow-pop !font-sans",
                description: "!text-muted",
                actionButton: "!bg-brand !text-brand-ink !font-semibold",
              },
            }}
            offset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
          />
        </OverlayProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
