CREATE TABLE "notificacoes" (
  "id" SERIAL PRIMARY KEY,
  "usuarioId" INTEGER NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
  "produtoId" INTEGER NOT NULL,
  "codigo" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "acao" TEXT NOT NULL,
  "campos" TEXT[] NOT NULL,
  "origem" TEXT NOT NULL,
  "revisao" INTEGER NOT NULL DEFAULT 1,
  "lidaWeb" BOOLEAN NOT NULL DEFAULT false,
  "lidaMobile" BOOLEAN NOT NULL DEFAULT false,
  "ocorreuEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "notificacoes_usuarioId_produtoId_key" ON "notificacoes"("usuarioId","produtoId");
CREATE INDEX "notificacoes_usuarioId_ocorreuEm_id_idx" ON "notificacoes"("usuarioId","ocorreuEm" DESC,"id" DESC);
