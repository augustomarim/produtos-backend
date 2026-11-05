BEGIN;
-- Produtos antigos não possuem autoria registrada. A limpeza foi autorizada;
-- não é possível atribuí-los com segurança a qualquer conta existente.
ALTER TABLE "produtos" ADD COLUMN "usuarioId" INTEGER;
DELETE FROM "produtos" WHERE "usuarioId" IS NULL;
ALTER TABLE "produtos" ALTER COLUMN "usuarioId" SET NOT NULL;
DROP INDEX "produtos_codigo_produto_key";
DROP INDEX "produtos_updatedAt_id_idx";
CREATE UNIQUE INDEX "produtos_usuarioId_codigo_produto_key" ON "produtos"("usuarioId", "codigo_produto");
CREATE INDEX "produtos_usuarioId_status_updatedAt_id_idx" ON "produtos"("usuarioId", "status", "updatedAt" DESC, "id" DESC);
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
