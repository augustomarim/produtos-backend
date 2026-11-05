import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import cloudinary from "../cloudinary.js";
import multer from "multer";
import { validar } from "../validacao.js";
import {
  consultaProdutosSchema,
  consultarProdutosPaginados,
} from "../consultarProdutos.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB
  fileFilter: (req, file, cb) => {
    const permitidos = ["image/jpeg", "image/png", "image/webp"];
    if (permitidos.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Formato de arquivo não suportado"));
  },
});

function receberFoto(req, res, next) {
  upload.single("foto_produto")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "A imagem deve ter no máximo 5MB" });
    }
    return res.status(400).json({ error: err.message });
  });
}

function sendFotoToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "produtos", resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });
}

function extrairPublicId(url) {
  if (!url) return null;
  const partes = url.split("/");
  const pasta = partes[partes.length - 2];
  const arquivo = partes[partes.length - 1];
  const nomeSemExtensao = arquivo.substring(0, arquivo.lastIndexOf("."));
  return `${pasta}/${nomeSemExtensao}`;
}

async function apagarFotoDoCloudinary(url) {
  const publicId = extrairPublicId(url);
  if (!publicId) return true;

  try {
    const resposta = await cloudinary.uploader.destroy(publicId);
    const removida =
      resposta.result === "ok" || resposta.result === "not found";
    if (!removida)
      console.warn("Cloudinary não removeu uma foto associada ao produto.");
    return removida;
  } catch (error) {
    console.error(
      "Falha ao apagar imagem do Cloudinary:",
      error.code || error.name,
    );
    return false;
  }
}

function comMiniatura(produto) {
  const foto = produto.foto_produto;
  const foto_miniatura =
    foto && foto.includes("/upload/")
      ? foto.replace("/upload/", "/upload/c_fill,w_150,h_150,q_auto,f_auto/")
      : null;
  return { ...produto, foto_miniatura };
}

const camposObrigatorios = {
  codigo_produto: z
    .string({ message: "Código do produto é obrigatório" })
    .trim()
    .min(1, "Código do produto é obrigatório"),
  descricao_produto: z
    .string({ message: "Descrição do produto é obrigatória" })
    .trim()
    .min(1, "Descrição do produto é obrigatória"),
};

const criarProdutoSchema = z.object(camposObrigatorios);

const atualizarProdutoSchema = z
  .object({
    ...camposObrigatorios,
    status: z.enum(["ativo", "inativo"], {
      errorMap: () => ({ message: "Status deve ser 'ativo' ou 'inativo'" }),
    }),
  })
  .partial();

const idsSchema = z
  .array(
    z
      .number({ message: "ID inválido" })
      .int("ID inválido")
      .positive("ID inválido")
      .max(2147483647, "ID inválido"),
    { message: "Envie a lista de IDs" },
  )
  .min(1, "Selecione pelo menos um produto")
  .max(100, "Selecione no máximo 100 produtos por vez")
  .transform((ids) => [...new Set(ids)]);

const excluirLoteSchema = z.object({ ids: idsSchema });

const statusLoteSchema = z.object({
  ids: idsSchema,
  status: z.enum(["ativo", "inativo"], {
    errorMap: () => ({ message: "Status deve ser 'ativo' ou 'inativo'" }),
  }),
});

function lerId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    res.status(400).json({ error: "ID inválido" });
    return null;
  }
  return id;
}

function tratarErro(error, res) {
  if (error.code === "P2002") {
    return res
      .status(409)
      .json({ error: "Já existe um produto com este código na sua conta" });
  }
  if (error.code === "P2003") {
    return res
      .status(401)
      .json({ error: "Conta indisponível. Entre novamente." });
  }
  if (error.code === "P2025") {
    return res.status(404).json({ error: "Produto não encontrado" });
  }
  console.error(error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

router.get("/", async (req, res) => {
  const paginada = ["pagina", "limite", "busca", "status", "ordem"].some(
    (campo) => req.query[campo] !== undefined,
  );
  const consulta = paginada
    ? validar(consultaProdutosSchema, req.query, res)
    : null;
  if (paginada && !consulta) return;
  try {
    if (paginada) {
      const resultado = await consultarProdutosPaginados(
        prisma,
        consulta,
        req.usuario.id,
      );
      return res.json({
        ...resultado,
        produtos: resultado.produtos.map(comMiniatura),
      });
    }
    const produtos = await prisma.produto.findMany({
      where: { usuarioId: req.usuario.id },
      orderBy: [
        { status: "asc" },
        { updatedAt: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ],
    });
    res.json(produtos.map(comMiniatura));
  } catch (error) {
    tratarErro(error, res);
  }
});

router.get("/:id", async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;

  try {
    const produto = await prisma.produto.findUnique({
      where: { id, usuarioId: req.usuario.id },
    });
    if (!produto) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }
    res.json(comMiniatura(produto));
  } catch (error) {
    tratarErro(error, res);
  }
});

router.post("/", receberFoto, async (req, res) => {
  const produtoData = validar(criarProdutoSchema, req.body, res);
  if (!produtoData) return;

  let fotoEnviada = null;

  try {
    if (req.file) {
      const result = await sendFotoToCloudinary(req.file.buffer);
      fotoEnviada = result.secure_url;
      produtoData.foto_produto = fotoEnviada;
    }
    const produto = await prisma.produto.create({
      data: { ...produtoData, usuarioId: req.usuario.id },
    });
    res.status(201).json(comMiniatura(produto));
  } catch (error) {
    if (fotoEnviada) await apagarFotoDoCloudinary(fotoEnviada);
    tratarErro(error, res);
  }
});

router.put("/:id", receberFoto, async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;

  const produtoData = validar(atualizarProdutoSchema, req.body, res);
  if (!produtoData) return;

  if (Object.keys(produtoData).length === 0 && !req.file) {
    return res
      .status(400)
      .json({ error: "Nenhum dado fornecido para atualização" });
  }

  let fotoNova = null;

  try {
    const atual = await prisma.produto.findUnique({
      where: { id, usuarioId: req.usuario.id },
    });
    if (!atual) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }
    if (req.file) {
      const result = await sendFotoToCloudinary(req.file.buffer);
      fotoNova = result.secure_url;
      produtoData.foto_produto = fotoNova;
    }
    const produto = await prisma.produto.update({
      where: { id, usuarioId: req.usuario.id },
      data: produtoData,
    });
    if (fotoNova && atual.foto_produto) {
      await apagarFotoDoCloudinary(atual.foto_produto);
    }
    res.json(comMiniatura(produto));
  } catch (error) {
    if (fotoNova) await apagarFotoDoCloudinary(fotoNova);
    tratarErro(error, res);
  }
});

router.patch("/status", async (req, res) => {
  const dados = validar(statusLoteSchema, req.body, res);
  if (!dados) return;

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const existentes = await tx.$queryRaw`
                SELECT * FROM "produtos" WHERE "usuarioId" = ${req.usuario.id} AND "id" = ANY(${dados.ids}::int[])
                ORDER BY "id" FOR UPDATE
            `;
      const idsAlterar = existentes
        .filter((p) => p.status !== dados.status)
        .map((p) => p.id);
      const atualizados = idsAlterar.length
        ? await tx.produto.updateManyAndReturn({
            where: { usuarioId: req.usuario.id, id: { in: idsAlterar } },
            data: { status: dados.status },
          })
        : [];
      const mapa = new Map(atualizados.map((p) => [p.id, p]));
      return {
        afetados: atualizados.length,
        jaNoStatus: existentes.length - atualizados.length,
        naoEncontrados: dados.ids.length - existentes.length,
        produtos: existentes.map((p) => mapa.get(p.id) || p),
      };
    });
    res.json({
      solicitados: dados.ids.length,
      ...resultado,
      produtos: resultado.produtos.map(comMiniatura),
    });
  } catch (error) {
    tratarErro(error, res);
  }
});

router.patch("/:id/status", async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;

  try {
    const produto = await prisma.produto.findUnique({
      where: { id, usuarioId: req.usuario.id },
    });
    if (!produto) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }
    const updatedProduto = await prisma.produto.update({
      where: { id, usuarioId: req.usuario.id },
      data: { status: produto.status === "ativo" ? "inativo" : "ativo" },
    });
    res.json(comMiniatura(updatedProduto));
  } catch (error) {
    tratarErro(error, res);
  }
});

router.delete("/", async (req, res) => {
  const dados = validar(excluirLoteSchema, req.body, res);
  if (!dados) return;
  try {
    const excluidos = await prisma.$transaction(async (tx) => {
      // Lock the selected rows before capturing their photos. This avoids
      // racing a photo replacement between the read and the delete.
      // The tagged query binds the ID array as a parameter, never SQL text.
      const produtos = await tx.$queryRaw`
                SELECT "id", "foto_produto" FROM "produtos"
                WHERE "usuarioId" = ${req.usuario.id} AND "id" = ANY(${dados.ids}::int[])
                ORDER BY "id" FOR UPDATE
            `;
      if (produtos.length) {
        await tx.produto.deleteMany({
          where: {
            usuarioId: req.usuario.id,
            id: { in: produtos.map((p) => p.id) },
          },
        });
      }
      return produtos;
    });

    // External storage cannot participate in the database transaction.
    // Delete photos only after commit, in batches of at most five requests.
    const fotos = [
      ...new Set(excluidos.map((p) => p.foto_produto).filter(Boolean)),
    ];
    let fotosNaoRemovidas = 0;
    for (let i = 0; i < fotos.length; i += 5) {
      const resultados = await Promise.allSettled(
        fotos.slice(i, i + 5).map(apagarFotoDoCloudinary),
      );
      fotosNaoRemovidas += resultados.filter(
        (r) => r.status === "rejected" || r.value === false,
      ).length;
    }
    res.json({
      solicitados: dados.ids.length,
      afetados: excluidos.length,
      idsExcluidos: excluidos.map((p) => p.id),
      fotosNaoRemovidas,
    });
  } catch (error) {
    tratarErro(error, res);
  }
});

router.delete("/:id", async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;

  try {
    const removido = await prisma.produto.delete({
      where: { id, usuarioId: req.usuario.id },
    });
    if (removido.foto_produto) {
      await apagarFotoDoCloudinary(removido.foto_produto);
    }
    res.status(204).send();
  } catch (error) {
    tratarErro(error, res);
  }
});

router.delete("/:id/foto", async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;

  try {
    const atual = await prisma.produto.findUnique({
      where: { id, usuarioId: req.usuario.id },
    });
    if (!atual) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }
    if (!atual.foto_produto) {
      return res.json(comMiniatura(atual));
    }

    const produto = await prisma.produto.update({
      where: { id, usuarioId: req.usuario.id },
      data: { foto_produto: null },
    });
    await apagarFotoDoCloudinary(atual.foto_produto);
    res.json(comMiniatura(produto));
  } catch (error) {
    tratarErro(error, res);
  }
});

export default router;
