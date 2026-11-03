import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

test('migração de datas preserva produtos antigos e ordena alterações recentes', async () => {
  const db = new PGlite();
  try {
    await db.exec(await migration('20261028201932_init'));
    await db.exec(await migration('20261103165826_add_refresh_tokens'));
    await db.query(`INSERT INTO produtos (codigo_produto, descricao_produto, foto_produto) VALUES ('ANTIGO','Produto existente','https://example.test/foto.jpg')`);
    await db.exec(await migration('20261103210000_product_dates'));
    const antigo = (await db.query(`SELECT * FROM produtos WHERE codigo_produto = 'ANTIGO'`)).rows[0];
    assert.equal(antigo.descricao_produto, 'Produto existente');
    assert.equal(antigo.foto_produto, 'https://example.test/foto.jpg');
    assert.equal(antigo.createdAt, null);
    assert.equal(antigo.updatedAt, null);

    await db.query(`INSERT INTO produtos (codigo_produto, descricao_produto) VALUES ('NOVO','Produto novo')`);
    const novo = (await db.query(`SELECT * FROM produtos WHERE codigo_produto = 'NOVO'`)).rows[0];
    assert.ok(novo.createdAt instanceof Date);
    assert.ok(novo.updatedAt instanceof Date);
    let ordem = (await db.query(`SELECT codigo_produto FROM produtos ORDER BY "updatedAt" DESC NULLS LAST, id DESC`)).rows;
    assert.deepEqual(ordem.map(p => p.codigo_produto), ['NOVO','ANTIGO']);

    // Prisma @updatedAt writes this value on every successful update.
    const alteracao = new Date(Date.now() + 60_000);
    await db.query(`UPDATE produtos SET descricao_produto = 'Editado', "updatedAt" = $1 WHERE codigo_produto = 'ANTIGO'`, [alteracao]);
    ordem = (await db.query(`SELECT codigo_produto FROM produtos ORDER BY "updatedAt" DESC NULLS LAST, id DESC`)).rows;
    assert.deepEqual(ordem.map(p => p.codigo_produto), ['ANTIGO','NOVO']);
    const editado = (await db.query(`SELECT * FROM produtos WHERE codigo_produto = 'ANTIGO'`)).rows[0];
    assert.equal(editado.createdAt, null);
    assert.equal(editado.updatedAt.getTime(), alteracao.getTime());
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM produtos`)).rows[0].n, 2);
  } finally { await db.close(); }
});
