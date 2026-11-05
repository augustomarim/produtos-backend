import { Prisma } from "@prisma/client";
import { z } from "zod";
export const consultaProdutosSchema = z.object({
  pagina: z.coerce.number().int().min(1).max(1000000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  busca: z.string().trim().max(120).default(""),
  status: z.enum(["todos", "ativo", "inativo"]).default("todos"),
  ordem: z.enum(["atualizados", "criados", "codigo"]).default("atualizados"),
});
export async function consultarProdutosPaginados(prisma, consulta, usuarioId) {
  const termo = consulta.busca
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  const acentos = "áàâãäåéèêëíìîïóòôõöúùûüçñ";
  const simples = "aaaaaaeeeeiiiiooooouuuucn";
  const status =
    consulta.status === "todos"
      ? Prisma.sql`TRUE`
      : Prisma.sql`"status" = ${consulta.status}::"StatusProduto"`;
  const where = Prisma.sql`"usuarioId" = ${usuarioId} AND ${status} AND strpos(translate(lower("descricao_produto"), ${acentos}, ${simples}), ${termo}) > 0`;
  const ordens = {
    atualizados: Prisma.sql`"status" ASC, "updatedAt" DESC NULLS LAST, "id" DESC`,
    criados: Prisma.sql`"status" ASC, "createdAt" DESC NULLS LAST, "id" DESC`,
    codigo: Prisma.sql`"status" ASC, lower("codigo_produto") ASC, "id" DESC`,
  };
  return prisma.$transaction(
    async (tx) => {
      const [resumo] =
        await tx.$queryRaw`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "status" = 'ativo')::int AS ativos FROM "produtos" WHERE "usuarioId" = ${usuarioId}`;
      const [contagem] =
        await tx.$queryRaw`SELECT COUNT(*)::int AS total FROM "produtos" WHERE ${where}`;
      const paginas = Math.max(1, Math.ceil(contagem.total / consulta.limite));
      const pagina = Math.min(consulta.pagina, paginas);
      const produtos =
        await tx.$queryRaw`SELECT * FROM "produtos" WHERE ${where} ORDER BY ${ordens[consulta.ordem]} LIMIT ${consulta.limite} OFFSET ${(pagina - 1) * consulta.limite}`;
      return {
        produtos,
        total: contagem.total,
        pagina,
        paginas,
        limite: consulta.limite,
        resumo: { ...resumo, inativos: resumo.total - resumo.ativos },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
