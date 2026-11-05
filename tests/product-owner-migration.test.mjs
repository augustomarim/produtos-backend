import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migração remove produtos sem dono, preserva contas/sessões e impõe dono/código por conta", async () => {
  const db = new PGlite();
  try {
    const dir = new URL("../prisma/migrations/", import.meta.url);
    const names = (await readdir(dir)).filter((n) => /^\d/.test(n)).sort();
    for (const name of names.slice(0, -1))
      await db.exec(
        await readFile(new URL(`${name}/migration.sql`, dir), "utf8"),
      );
    await db.exec(`INSERT INTO usuarios (id,nome,email,senha) VALUES (1,'A','a@example.test','hash'),(2,'B','b@example.test','hash');
      INSERT INTO refresh_tokens (id,"tokenHash","usuarioId","expiresAt") VALUES (1,'hash-local',1,CURRENT_TIMESTAMP+INTERVAL '1 day');
      INSERT INTO produtos (codigo_produto,descricao_produto,foto_produto) VALUES ('ORFAO','Sem autoria','https://example.test/antiga.png');`);
    await db.exec(
      await readFile(new URL(`${names.at(-1)}/migration.sql`, dir), "utf8"),
    );
    assert.equal((await db.query("SELECT * FROM produtos")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM usuarios")).rows.length, 2);
    assert.equal(
      (await db.query("SELECT * FROM refresh_tokens")).rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        `INSERT INTO produtos (codigo_produto,descricao_produto) VALUES ('SEM-DONO','Erro')`,
      ),
    );
    await assert.rejects(
      db.query(
        `INSERT INTO produtos (codigo_produto,descricao_produto,"usuarioId") VALUES ('INVALIDO','Erro',99)`,
      ),
    );
    await db.exec(
      `INSERT INTO produtos (codigo_produto,descricao_produto,"usuarioId") VALUES ('IGUAL','A',1),('IGUAL','B',2)`,
    );
    await assert.rejects(
      db.query(
        `INSERT INTO produtos (codigo_produto,descricao_produto,"usuarioId") VALUES ('IGUAL','Duplicado',1)`,
      ),
    );
    assert.equal((await db.query("SELECT * FROM produtos")).rows.length, 2);
  } finally {
    await db.close();
  }
});
