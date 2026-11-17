-- Preserva os avisos existentes; cada operação futura terá seu próprio registro.
DROP INDEX "notificacoes_usuarioId_produtoId_key";
CREATE INDEX "notificacoes_usuarioId_produtoId_idx" ON "notificacoes"("usuarioId", "produtoId");
CREATE INDEX "notificacoes_usuarioId_origem_ocorreuEm_id_idx" ON "notificacoes"("usuarioId", "origem", "ocorreuEm" DESC, "id" DESC);
