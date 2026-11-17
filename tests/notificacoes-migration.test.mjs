import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migração preserva avisos antigos e permite vários eventos do mesmo produto", async () => {
  const db = new PGlite();
  try {
    const dir = new URL("../prisma/migrations/", import.meta.url);
    const names = (await readdir(dir)).filter((n) => /^\d/.test(n)).sort();
    for (const n of names.filter(
      (n) => n < "20261117190000_historico_notificacoes",
    ))
      await db.exec(await readFile(new URL(`${n}/migration.sql`, dir), "utf8"));
    await db.exec(`INSERT INTO usuarios(id,nome,email,senha) VALUES(1,'Teste','teste@example.test','hash');
  INSERT INTO notificacoes("usuarioId","produtoId",codigo,descricao,acao,campos,origem,revisao,"lidaWeb","lidaMobile") VALUES(1,123,'ANTIGO','Aviso preservado','editado',ARRAY['descricao'],'web',4,true,false)`);
    const antes = (await db.query("SELECT * FROM notificacoes")).rows[0];
    await db.exec(
      await readFile(
        new URL("20261117190000_historico_notificacoes/migration.sql", dir),
        "utf8",
      ),
    );
    assert.deepEqual(
      (await db.query("SELECT * FROM notificacoes")).rows[0],
      antes,
    );
    await db.exec(
      `INSERT INTO notificacoes("usuarioId","produtoId",codigo,descricao,acao,campos,origem) VALUES(1,123,'ANTIGO','Segundo evento','editado',ARRAY['imagem'],'web'),(1,123,'ANTIGO','Terceiro evento','removido',ARRAY[]::text[],'mobile')`,
    );
    assert.equal(
      (await db.query('SELECT * FROM notificacoes WHERE "produtoId"=123')).rows
        .length,
      3,
    );
  } finally {
    await db.close();
  }
});
