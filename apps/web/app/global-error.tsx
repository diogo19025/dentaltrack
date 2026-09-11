"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { reportClientError } from "@/lib/client-errors";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, {
      source: "global-error-boundary",
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="pt-BR">
      <body>
        <main className="grid min-h-screen place-items-center bg-background p-6">
          <ErrorState
            error={error}
            onRetry={reset}
            title="Não foi possível abrir o aplicativo"
            className="w-full max-w-xl"
          />
        </main>
      </body>
    </html>
  );
}
