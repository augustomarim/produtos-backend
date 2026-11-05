import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";

let consulta;
const produto = {
  id: 1,
  codigo_produto: "P-1",
  descricao_produto: "Produto",
  status: "ativo",
  foto_produto: null,
  createdAt: null,
  updatedAt: "2026-11-03T12:00:00.000Z",
};
mock.module("../src/prisma.js", {
  exports: {
    default: {
      produto: {
        async findMany(args) {
          consulta = args;
          return [produto];
        },
        async findUnique() {
          return produto;
        },
        async update({ data }) {
          return { ...produto, ...data, updatedAt: "2026-11-03T13:00:00.000Z" };
        },
      },
    },
  },
});
mock.module("../src/cloudinary.js", { exports: { default: {} } });
test("API lista pela última alteração, preserva datas e retorna status atualizado", async () => {
  const { default: routes } = await import("../src/routes/produtosRoutes.js");
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.usuario = { id: 1 };
    next();
  });
  app.use("/produtos", routes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + "/produtos");
    assert.equal(response.status, 200);
    assert.deepEqual(consulta.where, { usuarioId: 1 });
    assert.deepEqual(consulta.orderBy, [
      { status: "asc" },
      { updatedAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    const dados = await response.json();
    assert.equal(dados[0].createdAt, null);
    assert.equal(dados[0].updatedAt, produto.updatedAt);
    const patch = await fetch(base + "/produtos/1/status", { method: "PATCH" });
    assert.equal(patch.status, 200);
    const atualizado = await patch.json();
    assert.equal(atualizado.status, "inativo");
    assert.equal(atualizado.updatedAt, "2026-11-03T13:00:00.000Z");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
