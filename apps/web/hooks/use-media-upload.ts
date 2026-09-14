"use client";

import { useMutation } from "@tanstack/react-query";
import type { MediaPurpose, MediaUploadResult } from "@dentaltrack/shared";
import { apiUpload } from "@/lib/api-client";

/**
 * Envia um arquivo e devolve a URL pública (F13 · POST /media/upload).
 *
 * Não invalida cache nenhuma de propósito: o upload **não** salva a
 * configuração. Ele só produz a URL — quem grava é o "Salvar alterações" da
 * tela, junto do resto do formulário. Salvar no upload faria um clique em
 * "Cancelar" deixar para trás uma configuração parcialmente aplicada, o que é
 * pior do que exigir o salvar explícito.
 */
export function useMediaUpload() {
  return useMutation({
    mutationFn: ({ file, purpose }: { file: File; purpose: MediaPurpose }) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiUpload<MediaUploadResult>(
        `/media/upload?purpose=${purpose}`,
        formData,
      );
    },
  });
}
