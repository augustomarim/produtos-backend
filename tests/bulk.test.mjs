import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { once } from "node:events";
import express from "express";
import { Writable } from "node:stream";
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
  outroBearer,
  uploads = 0,
  failPhoto = false,
  failDelete = false;
const photos = [];
process.env.JWT_SECRET = "local-test-only-bulk-authentication-key";
const client = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === "$transaction")
        return async (callback, options) =>
          prisma.$transaction(async (tx) => {
            const wrapped = {
              $queryRaw: tx.$queryRaw.bind(tx),
              produto: {
                ...tx.produto,
                async deleteMany(args) {
                  if (failDelete) throw new Error("Injected rollback test");
                  return tx.produto.deleteMany(args);
                },
              },
            };
            return callback(wrapped);
          }, options);
      return prisma[key];
    },
  },
);
mock.module("../src/prisma.js", { exports: { default: client } });
mock.module("../src/cloudinary.js", {
  exports: {
    default: {
      uploader: {
        upload_stream(_options, done) {
          const photo = ++uploads;
          return new Writable({
            write(_chunk, _encoding, callback) {
              callback();
            },
            final(callback) {
              done(null, {
                secure_url: `https://res.cloudinary.com/demo/image/upload/v1/produtos/foto-${photo}.png`,
              });
              callback();
            },
          });
        },
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
  await prisma.usuario.createMany({
    data: [
      { id: 1, nome: "Conta A", email: "a@example.test", senha: "senha-teste" },
      { id: 2, nome: "Conta B", email: "b@example.test", senha: "senha-teste" },
      {
        id: 3,
        nome: "Conta vazia",
        email: "c@example.test",
        senha: "senha-teste",
      },
    ],
  });
  const { default: routes } = await import("../src/routes/produtosRoutes.js");
  const { default: auth } = await import("../src/middlewares/auth.js");
  const app = express();
  app.use(express.json());
  app.use("/produtos", auth, routes);
  httpServer = app.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  base = `http://127.0.0.1:${httpServer.address().port}`;
  bearer = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
  outroBearer = jwt.sign({ id: 2 }, process.env.JWT_SECRET);
});
after(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  if (prisma) await prisma.$disconnect();
  if (pgServer) await pgServer.stop();
  await db.close();
});
async function request(
  method,
  path,
  body,
  authenticated = true,
  token = bearer,
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  return {
    status: res.status,
    data: res.status === 204 ? undefined : await res.json(),
  };
}
async function seed(code, status = "ativo", photo = null, usuarioId = 1) {
  return prisma.produto.create({
    data: {
      usuarioId,
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
  assert.equal(res.data.afetados, 1);
  assert.equal(res.data.jaNoStatus, 1);
  assert.equal(res.data.naoEncontrados, 1);
  assert.ok(
    res.data.produtos.every(
      (p) =>
        p.status === "inativo" &&
        (p.id === b.id
          ? Date.parse(p.updatedAt) === antes.getTime()
          : Date.parse(p.updatedAt) > antes.getTime()),
    ),
  );
  assert.ok(res.data.produtos.every((p) => p.foto_miniatura === null));
  const repetir = await request("PATCH", "/produtos/status", {
    ids: [a.id, b.id],
    status: "inativo",
  });
  assert.ok(repetir.data.produtos.every((p) => p.status === "inativo"));
  assert.equal(repetir.data.afetados, 0);
  assert.equal(repetir.data.jaNoStatus, 2);
  assert.deepEqual(
    repetir.data.produtos.map((p) => p.updatedAt),
    res.data.produtos.map((p) => p.updatedAt),
  );
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
      usuarioId: 1,
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

test("paginação global, busca sem acento, contagens, filtros e página fora do limite", async () => {
  await prisma.produto.deleteMany();
  await prisma.produto.createMany({
    data: [
      {
        codigo_produto: "CAFE",
        descricao_produto: "Café catálogo",
        status: "ativo",
      },
      {
        codigo_produto: "CERVEJA",
        descricao_produto: "Cerveja artesanal",
        status: "ativo",
      },
      {
        codigo_produto: "C-AGUA",
        descricao_produto: "Água",
        status: "inativo",
      },
      ...Array.from({ length: 32 }, (_, i) => ({
        codigo_produto: `P-${String(i).padStart(2, "0")}`,
        descricao_produto: `Produto ${i}`,
        status: i % 3 ? "ativo" : "inativo",
      })),
    ].map((p) => ({ ...p, usuarioId: 1 })),
  });
  const get = (path) => request("GET", path, undefined);
  const primeira = await get("/produtos?pagina=1&limite=10");
  assert.equal(primeira.status, 200);
  assert.equal(primeira.data.produtos.length, 10);
  assert.equal(primeira.data.total, 35);
  assert.equal(primeira.data.paginas, 4);
  assert.equal(primeira.data.resumo.total, 35);
  assert.equal(
    primeira.data.resumo.ativos,
    await prisma.produto.count({ where: { status: "ativo" } }),
  );
  const segunda = await get("/produtos?pagina=2&limite=10");
  assert.ok(
    segunda.data.produtos.every(
      (p) => !primeira.data.produtos.some((a) => a.id === p.id),
    ),
  );
  const todas = [];
  for (let pagina = 1; pagina <= 4; pagina++)
    todas.push(
      ...(await get(`/produtos?pagina=${pagina}&limite=10`)).data.produtos,
    );
  const primeiroInativo = todas.findIndex((p) => p.status === "inativo");
  assert.ok(todas.slice(primeiroInativo).every((p) => p.status === "inativo"));
  const cafe = await get("/produtos?pagina=1&limite=10&busca=cafe");
  assert.equal(cafe.data.total, 1);
  assert.equal(cafe.data.produtos[0].descricao_produto, "Café catálogo");
  const c = await get("/produtos?pagina=1&busca=C");
  assert.deepEqual(c.data.produtos.map((p) => p.codigo_produto).sort(), [
    "CAFE",
    "CERVEJA",
  ]);
  const inativos = await get("/produtos?pagina=1&status=inativo");
  assert.ok(inativos.data.produtos.every((p) => p.status === "inativo"));
  assert.equal(inativos.data.total, inativos.data.resumo.inativos);
  const injection = await get(
    "/produtos?pagina=1&busca=" + encodeURIComponent("' OR true --"),
  );
  assert.equal(injection.data.total, 0);
  const literal = await get("/produtos?pagina=1&busca=%25");
  assert.equal(literal.data.total, 0);
  const ultima = await get("/produtos?pagina=99&limite=10");
  assert.equal(ultima.data.pagina, 4);
  assert.equal(ultima.data.produtos.length, 5);
  await prisma.produto.deleteMany({
    where: { id: { in: ultima.data.produtos.map((p) => p.id) } },
  });
  const reajustada = await get("/produtos?pagina=4&limite=10");
  assert.equal(reajustada.data.pagina, 3);
  assert.equal(reajustada.data.total, 30);
  for (const params of [
    "pagina=0",
    "pagina=abc",
    "pagina=1&limite=101",
    "pagina=1&status=errado",
    "pagina=1&ordem=errada",
  ])
    assert.equal((await get("/produtos?" + params)).status, 400);
  const legado = await get("/produtos");
  assert.ok(Array.isArray(legado.data));
  assert.equal(legado.data.length, 30);
});

test("duas contas têm catálogos independentes, códigos iguais e contagens privadas", async () => {
  await prisma.produto.deleteMany();
  const create = (token, code, extras = {}) =>
    request(
      "POST",
      "/produtos",
      { codigo_produto: code, descricao_produto: "Privado", ...extras },
      true,
      token,
    );
  const a = await create(bearer, "MESMO-CODIGO", {
    usuarioId: 2,
    usuario: { connect: { id: 2 } },
  });
  const b = await create(outroBearer, "MESMO-CODIGO");
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(
    (await prisma.produto.findUnique({ where: { id: a.data.id } })).usuarioId,
    1,
  );
  assert.equal(
    (await prisma.produto.findUnique({ where: { id: b.data.id } })).usuarioId,
    2,
  );
  assert.equal((await create(bearer, "MESMO-CODIGO")).status, 409);
  assert.equal((await create(outroBearer, "MESMO-CODIGO")).status, 409);
  await seed("APENAS-B", "inativo", null, 2);
  for (const [token, total] of [
    [bearer, 1],
    [outroBearer, 2],
  ]) {
    const legacy = await request("GET", "/produtos", undefined, true, token);
    assert.equal(legacy.data.length, total);
    const paged = await request(
      "GET",
      "/produtos?pagina=1&limite=10",
      undefined,
      true,
      token,
    );
    assert.equal(paged.data.total, total);
    assert.equal(paged.data.resumo.total, total);
    assert.equal(paged.data.resumo.ativos, 1);
    assert.equal(paged.data.resumo.inativos, total - 1);
  }
  const busca = await request(
    "GET",
    "/produtos?pagina=1&busca=APENAS-B",
    undefined,
    true,
    bearer,
  );
  assert.equal(busca.data.total, 0);
  const vazia = await request(
    "GET",
    "/produtos?pagina=1",
    undefined,
    true,
    jwt.sign({ id: 3 }, process.env.JWT_SECRET),
  );
  assert.deepEqual(vazia.data.resumo, { total: 0, ativos: 0, inativos: 0 });
  assert.equal(vazia.data.total, 0);
  const spoof = await request(
    "GET",
    "/produtos?pagina=1&usuarioId=2",
    undefined,
    true,
    bearer,
  );
  assert.equal(spoof.data.total, 1);
});

test("acesso por ID alheio não consulta, altera, remove nem envia/apaga foto", async () => {
  const alheio = await seed(
    "PROTEGIDO",
    "ativo",
    "https://res.cloudinary.com/demo/image/upload/v1/produtos/protegido.png",
    2,
  );
  const antes = await prisma.produto.findUnique({ where: { id: alheio.id } });
  const destruicoes = photos.length,
    envios = uploads;
  for (const [method, path, body] of [
    ["GET", `/produtos/${alheio.id}`],
    [
      "PUT",
      `/produtos/${alheio.id}`,
      { descricao_produto: "Invadido", usuarioId: 1 },
    ],
    ["PATCH", `/produtos/${alheio.id}/status`],
    ["DELETE", `/produtos/${alheio.id}/foto`],
    ["DELETE", `/produtos/${alheio.id}`],
  ]) {
    const r = await request(method, path, body);
    assert.equal(r.status, 404, method + path);
    assert.deepEqual(r.data, { error: "Produto não encontrado" });
  }
  const foto = new FormData();
  foto.set(
    "foto_produto",
    new Blob(["fake-image"], { type: "image/png" }),
    "imagem.png",
  );
  assert.equal(
    (await request("PUT", `/produtos/${alheio.id}`, foto)).status,
    404,
  );
  assert.equal(uploads, envios);
  assert.equal(photos.length, destruicoes);
  assert.deepEqual(
    await prisma.produto.findUnique({ where: { id: alheio.id } }),
    antes,
  );
  // A conta B também não acessa um registro da conta A.
  const proprio = await seed("PROTEGIDO-A");
  assert.equal(
    (
      await request(
        "DELETE",
        `/produtos/${proprio.id}`,
        undefined,
        true,
        outroBearer,
      )
    ).status,
    404,
  );
});

test("lotes mistos só afetam produtos do dono e não revelam IDs ou fotos de outra conta", async () => {
  const a = await seed(
    "LOTE-A",
    "ativo",
    "https://res.cloudinary.com/demo/image/upload/v1/produtos/lote-a.png",
  );
  const b = await seed(
    "LOTE-B",
    "ativo",
    "https://res.cloudinary.com/demo/image/upload/v1/produtos/lote-b.png",
    2,
  );
  const original = await prisma.produto.findUnique({ where: { id: b.id } });
  const status = await request("PATCH", "/produtos/status", {
    ids: [a.id, b.id, 2147483647],
    status: "inativo",
    usuarioId: 2,
  });
  assert.equal(status.data.afetados, 1);
  assert.equal(status.data.naoEncontrados, 2);
  assert.deepEqual(
    status.data.produtos.map((p) => p.id),
    [a.id],
  );
  assert.deepEqual(
    await prisma.produto.findUnique({ where: { id: b.id } }),
    original,
  );
  const foreignOnly = await request("PATCH", "/produtos/status", {
    ids: [b.id],
    status: "inativo",
  });
  assert.equal(foreignOnly.data.afetados, 0);
  assert.equal(foreignOnly.data.jaNoStatus, 0);
  assert.deepEqual(foreignOnly.data.produtos, []);
  const excluido = await request("DELETE", "/produtos", { ids: [a.id, b.id] });
  assert.equal(excluido.data.afetados, 1);
  assert.deepEqual(excluido.data.idsExcluidos, [a.id]);
  assert.ok(photos.includes("produtos/lote-a"));
  assert.ok(!photos.includes("produtos/lote-b"));
  assert.deepEqual(
    await prisma.produto.findUnique({ where: { id: b.id } }),
    original,
  );
});

test("dono mantém CRUD e fotos; cliente não pode transferir produto", async () => {
  const form = new FormData();
  form.set("codigo_produto", "FOTO-PROPRIA");
  form.set("descricao_produto", "Meu produto");
  form.set("usuarioId", "2");
  form.set(
    "foto_produto",
    new Blob(["fake-image"], { type: "image/png" }),
    "foto.png",
  );
  const novo = await request("POST", "/produtos", form);
  assert.equal(novo.status, 201);
  const id = novo.data.id;
  assert.ok(novo.data.foto_produto);
  assert.equal(
    (await prisma.produto.findUnique({ where: { id } })).usuarioId,
    1,
  );
  assert.equal((await request("GET", `/produtos/${id}`)).status, 200);
  const editar = await request("PUT", `/produtos/${id}`, {
    descricao_produto: "Nome atualizado",
    usuarioId: 2,
  });
  assert.equal(editar.status, 200);
  assert.equal(
    (await prisma.produto.findUnique({ where: { id } })).usuarioId,
    1,
  );
  const substituir = new FormData();
  substituir.set(
    "foto_produto",
    new Blob(["fake-2"], { type: "image/png" }),
    "nova.png",
  );
  const nova = await request("PUT", `/produtos/${id}`, substituir);
  assert.equal(nova.status, 200);
  assert.notEqual(nova.data.foto_produto, novo.data.foto_produto);
  const remover = await request("DELETE", `/produtos/${id}/foto`);
  assert.equal(remover.status, 200);
  assert.equal(remover.data.foto_produto, null);
  assert.equal((await request("DELETE", `/produtos/${id}`)).status, 204);
});

test("tokens assinados sem identidade válida são rejeitados", async () => {
  for (const payload of [
    {},
    { id: "1" },
    { id: 0 },
    { id: -1 },
    { id: 1.5 },
    { id: 2147483648 },
  ]) {
    const r = await request(
      "GET",
      "/produtos",
      undefined,
      true,
      jwt.sign(payload, process.env.JWT_SECRET),
    );
    assert.equal(r.status, 401);
  }
});
