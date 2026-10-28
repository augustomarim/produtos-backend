-- CreateEnum
CREATE TYPE "StatusProduto" AS ENUM ('ativo', 'inativo');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" SERIAL NOT NULL,
    "codigo_produto" TEXT NOT NULL,
    "descricao_produto" TEXT NOT NULL,
    "status" "StatusProduto" NOT NULL DEFAULT 'ativo',
    "foto_produto" TEXT,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "produtos_codigo_produto_key" ON "produtos"("codigo_produto");
