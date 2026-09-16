"use client";

import { type ReactNode, useRef, useState } from "react";
import {
  acceptAttribute,
  acceptedFormatsLabel,
  MEDIA_MAX_BYTES,
  type MediaPurpose,
  type MediaUploadResult,
} from "@dentaltrack/shared";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMediaUpload } from "@/hooks/use-media-upload";
import { cn } from "@/lib/utils";

/**
 * Botão de enviar arquivo, com o `<input type="file">` escondido atrás dele.
 *
 * O input fica `sr-only` **e** `aria-hidden`: quem usa leitor de tela ouve o
 * botão, que tem nome acessível, e não dois controles para a mesma ação. É o
 * botão que dispara o seletor de arquivo.
 *
 * O tamanho é conferido **antes** de subir. O servidor confere de novo — ele é
 * a fronteira de verdade — mas mandar 20 MB pela rede para receber um 413
 * gasta o tempo e os dados de quem está numa conexão ruim, que é exatamente
 * quem mais sente.
 */
export function MediaUploadButton({
  purpose,
  onUploaded,
  label = "Enviar arquivo",
  variant = "secondary",
  className,
  children,
}: {
  purpose: MediaPurpose;
  onUploaded: (result: MediaUploadResult) => void;
  label?: string;
  variant?: "secondary" | "outline" | "default";
  className?: string;
  /** Gatilho alternativo (o quadrado da logo, por exemplo). */
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMediaUpload();
  const [localError, setLocalError] = useState<string | null>(null);

  const max = MEDIA_MAX_BYTES[purpose];
  const error =
    localError ??
    (upload.isError
      ? upload.error instanceof Error
        ? upload.error.message
        : "Não foi possível enviar o arquivo."
      : null);

  function pick() {
    setLocalError(null);
    upload.reset();
    inputRef.current?.click();
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Limpa o valor para que escolher o **mesmo** arquivo de novo (depois de um
    // erro) dispare o change outra vez — sem isto, a segunda tentativa é muda.
    event.target.value = "";
    if (!file) return;

    if (file.size > max) {
      setLocalError(`Arquivo muito grande. Aceitamos ${acceptedFormatsLabel(purpose)}.`);
      return;
    }

    upload.mutate(
      { file, purpose },
      { onSuccess: (result) => onUploaded(result) },
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={acceptAttribute(purpose)}
        onChange={onChange}
      />
      {children ? (
        <button
          type="button"
          onClick={pick}
          disabled={upload.isPending}
          aria-label={label}
          className="contents"
        >
          {children}
        </button>
      ) : (
        <Button
          type="button"
          variant={variant}
          size="sm"
          onClick={pick}
          disabled={upload.isPending}
        >
          {upload.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {upload.isPending ? "Enviando…" : label}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-[12px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
