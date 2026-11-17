import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import { validar } from "../validacao.js";
import { criarTicket } from "../services/tempoReal.js";
const router = Router();
function campoLeitura(req, res) {
  const origem = req.get("X-App-Origin");
  if (origem !== "web" && origem !== "mobile") {
    res.status(400).json({ error: "Informe a origem web ou mobile." });
    return null;
  }
  return origem === "web" ? "lidaWeb" : "lidaMobile";
}
const leituraSchema = z.object({
  notificacoes: z
    .array(
      z.object({
        id: z.number().int().positive().max(2147483647),
        revisao: z.number().int().positive().max(2147483647),
      }),
    )
    .min(1)
    .max(100),
});
router.get("/conexao", (req, res) => {
  if (!campoLeitura(req, res)) return;
  res.set("Cache-Control", "no-store").json({ ticket: criarTicket(req) });
});
router.get("/", async (req, res) => {
  const campo = campoLeitura(req, res);
  if (!campo) return;
  try {
    const usuarioId = req.usuario.id;
    const destino = { usuarioId };
    const paginaSolicitada = Number(req.query.pagina ?? 1);
    if (
      !Number.isInteger(paginaSolicitada) ||
      paginaSolicitada < 1 ||
      paginaSolicitada > 1000000
    )
      return res.status(400).json({ error: "Página inválida." });
    const resultado = await prisma.$transaction(
      async (tx) => {
        const total = await tx.notificacao.count({ where: destino });
        const paginas = Math.max(1, Math.ceil(total / 50));
        const pagina = Math.min(paginaSolicitada, paginas);
        const itens = await tx.notificacao.findMany({
          where: destino,
          orderBy: [{ ocorreuEm: "desc" }, { id: "desc" }],
          take: 50,
          skip: (pagina - 1) * 50,
        });
        const naoLidas = await tx.notificacao.count({
          where: {
            ...destino,
            origem: req.get("X-App-Origin") === "web" ? "mobile" : "web",
            [campo]: false,
          },
        });
        return {
          notificacoes: itens.map((n) => ({
            id: n.id,
            produtoId: n.produtoId,
            codigo: n.codigo,
            descricao: n.descricao,
            acao: n.acao,
            campos: n.campos,
            origem: n.origem,
            revisao: n.revisao,
            ocorreuEm: n.ocorreuEm,
            lida:
              n[campo] ||
              n.origem !==
                (req.get("X-App-Origin") === "web" ? "mobile" : "web"),
          })),
          naoLidas,
          total,
          pagina,
          paginas,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
    res.set("Cache-Control", "no-store").json(resultado);
  } catch {
    res
      .status(500)
      .json({ error: "Não foi possível consultar as notificações." });
  }
});
router.patch("/lidas", async (req, res) => {
  const campo = campoLeitura(req, res);
  if (!campo) return;
  const dados = validar(leituraSchema, req.body, res);
  if (!dados) return;
  try {
    const resultado = await prisma.notificacao.updateMany({
      where: {
        usuarioId: req.usuario.id,
        OR: dados.notificacoes.map(({ id, revisao }) => ({ id, revisao })),
      },
      data: { [campo]: true },
    });
    res.json({ afetadas: resultado.count });
  } catch {
    res
      .status(500)
      .json({ error: "Não foi possível marcar as notificações como lidas." });
  }
});
export default router;
