"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { reportClientError } from "@/lib/client-errors";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, { source: "app-error-boundary", digest: error.digest });
  }, [error]);

  return (
    <ErrorState
      error={error}
      onRetry={reset}
      title="Esta página encontrou um problema"
      className="mx-auto mt-8 max-w-2xl"
    />
  );
}
