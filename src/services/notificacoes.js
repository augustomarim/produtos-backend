export function origemDoCliente(req) {
  const origem = req.get("X-App-Origin");
  return origem === "web" || origem === "mobile" ? origem : "api";
}
export function camposAlterados(anterior, atual) {
  const campos = [];
  if (anterior.codigo_produto !== atual.codigo_produto) campos.push("codigo");
  if (anterior.descricao_produto !== atual.descricao_produto)
    campos.push("descricao");
  if (anterior.foto_produto !== atual.foto_produto) campos.push("imagem");
  if (anterior.status !== atual.status)
    campos.push(atual.status === "ativo" ? "ativado" : "inativado");
  return campos;
}
export async function registrarNotificacao(
  tx,
  req,
  produto,
  acao,
  campos = [],
) {
  const origem = origemDoCliente(req);
  const data = {
    codigo: produto.codigo_produto,
    descricao: produto.descricao_produto,
    acao,
    campos,
    origem,
    ocorreuEm: new Date(),
    lidaWeb: origem !== "mobile",
    lidaMobile: origem !== "web",
  };
  // Cada operação é um evento independente; nunca substitui o histórico.
  const evento = await tx.notificacao.create({
    data: { ...data, usuarioId: req.usuario.id, produtoId: produto.id },
  });
  (req.eventosNotificacao ??= []).push(evento);
}
// Serializa leitura, alteração e registro do evento. O evento e o produto confirmam juntos.
export async function comProdutoTravado(prisma, req, id, operacao) {
  return prisma.$transaction(async (tx) => {
    const [atual] =
      await tx.$queryRaw`SELECT * FROM "produtos" WHERE "id" = ${id} AND "usuarioId" = ${req.usuario.id} FOR UPDATE`;
    if (!atual)
      throw Object.assign(new Error("Produto não encontrado"), {
        code: "P2025",
      });
    return operacao(tx, atual);
  });
}
