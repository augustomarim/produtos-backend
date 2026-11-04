ALTER TABLE "produtos"
 ADD CONSTRAINT "produtos_codigo_produto_nao_vazio"
 CHECK (length(trim("codigo_produto")) > 0);

ALTER TABLE "produtos"
 ADD CONSTRAINT "produtos_descricao_produto_nao_vazia"
 CHECK (length(trim("descricao_produto")) > 0);