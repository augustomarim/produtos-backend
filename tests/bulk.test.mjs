import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { once } from "node:events";
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// Real Prisma + isolated PostgreSQL protocol. No Neon or external credentials.
const db = new PGlite();
let prisma,
  pgServer,
  httpServer,
  base,
  bearer,
  failPhoto = false,
  failDelete = false;
const photos = [];
process.env.JWT_SECRET = "local-test-only-bulk-authentication-key";
const client = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === "$transaction")
        return async (callback) =>
          prisma.$transaction(async (tx) => {
            const wrapped = {
              $queryRaw: tx.$queryRaw.bind(tx),
              produto: {
                async deleteMany(args) {
                  if (failDelete) throw new Error("Injected rollback test");
                  return tx.produto.deleteMany(args);
                },
              },
            };
            return callback(wrapped);
          });
      return prisma[key];
    },
  },
);
mock.module("../src/prisma.js", { exports: { default: client } });
mock.module("../src/cloudinary.js", {
  exports: {
    default: {
      uploader: {
        async destroy(id) {
          photos.push(id);
          if (failPhoto && id.endsWith("falha"))
            throw new Error("Injected photo failure");
          return { result: "ok" };
        },
      },
    },
  },
});

before(async () => {
  await db.waitReady;
  const dir = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => /^\d/.test(n)).sort()) {
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, dir), "utf8"),
    );
  }
  pgServer = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0 });
  await pgServer.start();
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: `postgresql://postgres@${pgServer.getServerConn()}/postgres?connection_limit=1&sslmode=disable`,
      },
    },
  });
  await prisma.$connect();
  const { default: routes } = await import("../src/routes/produtosRoutes.js");
  const { default: auth } = await import("../src/middlewares/auth.js");
  const app = express();
  app.use(express.json());
  app.use("/produtos", auth, routes);
  httpServer = app.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  base = `http://127.0.0.1:${httpServer.address().port}`;
  bearer = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
});
after(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  if (prisma) await prisma.$disconnect();
  if (pgServer) await pgServer.stop();
  await db.close();
});
async function request(method, path, body, authenticated = true) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function seed(code, status = "ativo", photo = null) {
  return prisma.produto.create({
    data: {
      codigo_produto: code,
      descricao_produto: code,
      status,
      foto_produto: photo,
    },
  });
}

test("rotas de lote exigem autenticação", async () => {
  for (const [method, path] of [
    ["PATCH", "/produtos/status"],
    ["DELETE", "/produtos"],
  ])
    assert.equal(
      (await request(method, path, { ids: [1], status: "inativo" }, false))
        .status,
      401,
    );
});
test("validação: vazios, tipos, limites e status não alteram banco", async () => {
  const invalidos = [
    {},
    { ids: [] },
    { ids: [0] },
    { ids: [-1] },
    { ids: [1.5] },
    { ids: ["1"] },
    { ids: [2147483648] },
    { ids: Array.from({ length: 101 }, (_, i) => i + 1) },
  ];
  for (const body of invalidos) {
    assert.equal(
      (
        await request("PATCH", "/produtos/status", {
          ...body,
          status: "inativo",
        })
      ).status,
      400,
    );
    assert.equal((await request("DELETE", "/produtos", body)).status, 400);
  }
  assert.equal(
    (await request("PATCH", "/produtos/status", { ids: [1], status: "xyz" }))
      .status,
    400,
  );
  assert.equal(await prisma.produto.count(), 0);
});
test("status explícito de seleção mista, deduplicação, IDs ausentes e updatedAt real", async () => {
  const a = await seed("A"),
    b = await seed("B", "inativo");
  const antes = new Date("2020-01-01T00:00:00Z");
  await prisma.produto.updateMany({
    where: { id: { in: [a.id, b.id] } },
    data: { updatedAt: antes },
  });
  const res = await request("PATCH", "/produtos/status", {
    ids: [a.id, b.id, a.id, 2147483647],
    status: "inativo",
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.solicitados, 3);
  assert.equal(res.data.afetados, 2);
  assert.ok(
    res.data.produtos.every(
      (p) =>
        p.status === "inativo" && Date.parse(p.updatedAt) > antes.getTime(),
    ),
  );
  assert.ok(res.data.produtos.every((p) => p.foto_miniatura === null));
  const repetir = await request("PATCH", "/produtos/status", {
    ids: [a.id, b.id],
    status: "inativo",
  });
  assert.ok(repetir.data.produtos.every((p) => p.status === "inativo"));
  const ativar = await request("PATCH", "/produtos/status", {
    ids: [a.id, b.id],
    status: "ativo",
  });
  assert.ok(ativar.data.produtos.every((p) => p.status === "ativo"));
});
test("exclusão em lote ignora ausentes e preserva produto não selecionado", async () => {
  const a = await seed(
    "EXCLUIR-A",
    "ativo",
    "https://res.cloudinary.com/demo/image/upload/v1/produtos/a.png",
  );
  const b = await seed("EXCLUIR-B");
  const manter = await seed("MANTER");
  const res = await request("DELETE", "/produtos", {
    ids: [a.id, b.id, a.id, 2147483647],
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.solicitados, 3);
  assert.equal(res.data.afetados, 2);
  assert.deepEqual(
    res.data.idsExcluidos.sort((a, b) => a - b),
    [a.id, b.id],
  );
  assert.equal(res.data.fotosNaoRemovidas, 0);
  assert.ok(await prisma.produto.findUnique({ where: { id: manter.id } }));
  assert.equal(await prisma.produto.findUnique({ where: { id: a.id } }), null);
  assert.ok(photos.includes("produtos/a"));
  const again = await request("DELETE", "/produtos", { ids: [a.id, b.id] });
  assert.equal(again.data.afetados, 0);
});
test("falha de armazenamento é informada sem desfazer exclusão já confirmada", async () => {
  const a = await seed(
    "FOTO-FALHA",
    "ativo",
    "https://res.cloudinary.com/demo/image/upload/v1/produtos/falha.png",
  );
  const b = await seed(
    "FOTO-OK",
    "ativo",
    "https://res.cloudinary.com/demo/image/upload/v1/produtos/ok.png",
  );
  failPhoto = true;
  try {
    const res = await request("DELETE", "/produtos", { ids: [a.id, b.id] });
    assert.equal(res.status, 200);
    assert.equal(res.data.afetados, 2);
    assert.equal(res.data.fotosNaoRemovidas, 1);
    assert.ok(photos.includes("produtos/ok"));
  } finally {
    failPhoto = false;
  }
});
test("falha SQL faz rollback e não tenta apagar fotos", async () => {
  const a = await seed(
    "ROLLBACK",
    "ativo",
    "https://res.cloudinary.com/demo/image/upload/v1/produtos/rollback.png",
  );
  const antes = photos.length;
  failDelete = true;
  try {
    const res = await request("DELETE", "/produtos", { ids: [a.id] });
    assert.equal(res.status, 500);
    assert.ok(await prisma.produto.findUnique({ where: { id: a.id } }));
    assert.equal(photos.length, antes);
  } finally {
    failDelete = false;
  }
});

test("limite inclusivo de 100 produtos em uma atualização e exclusão", async () => {
  await prisma.produto.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({
      codigo_produto: `LIMITE-${i}`,
      descricao_produto: `Limite ${i}`,
    })),
  });
  const registros = await prisma.produto.findMany({
    where: { codigo_produto: { startsWith: "LIMITE-" } },
    select: { id: true },
  });
  const ids = registros.map((p) => p.id);
  const status = await request("PATCH", "/produtos/status", {
    ids,
    status: "inativo",
  });
  assert.equal(status.status, 200);
  assert.equal(status.data.afetados, 100);
  const excluir = await request("DELETE", "/produtos", { ids });
  assert.equal(excluir.status, 200);
  assert.equal(excluir.data.afetados, 100);
  assert.equal(await prisma.produto.count({ where: { id: { in: ids } } }), 0);
});
