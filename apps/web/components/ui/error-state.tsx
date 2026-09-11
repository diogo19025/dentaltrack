"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function ErrorState({
  error,
  onRetry,
  title = "Não foi possível carregar",
  compact = false,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
  className?: string;
}) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius)] border border-destructive/25 bg-destructive/5",
        compact ? "p-3" : "p-6",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-5 flex-none text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {errorMessage(error)}
        </p>
        {requestId && (
          <p className="tabular mt-1 break-all text-[11px] text-muted-foreground">
            Código para o suporte: {requestId}
          </p>
        )}
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw className="size-4" />
          Tentar de novo
        </Button>
      )}
    </div>
  );
}
