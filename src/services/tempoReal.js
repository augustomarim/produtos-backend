import { EventEmitter } from "node:events";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
const eventos = new EventEmitter();
export function publicarAposResposta(req, res, next) {
  res.once("finish", () => {
    if (
      res.statusCode >= 200 &&
      res.statusCode < 300 &&
      req.eventosNotificacao?.length
    )
      eventos.emit("alteracao", {
        usuarioId: req.usuario.id,
        itens: req.eventosNotificacao,
      });
  });
  next();
}
export function criarTicket(req) {
  const agora = Math.floor(Date.now() / 1000);
  const sessaoExpiraEm = Math.min(req.usuario.exp || agora + 900, agora + 900);
  return jwt.sign(
    {
      id: req.usuario.id,
      plataforma: req.get("X-App-Origin"),
      finalidade: "notificacoes",
      sessaoExpiraEm,
    },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: 60 },
  );
}
function publico(n, plataforma) {
  return {
    id: n.id,
    produtoId: n.produtoId,
    codigo: n.codigo,
    descricao: n.descricao,
    acao: n.acao,
    campos: n.campos,
    origem: n.origem,
    revisao: n.revisao,
    ocorreuEm: n.ocorreuEm,
    lida: plataforma === "web" ? n.lidaWeb : n.lidaMobile,
  };
}
export function iniciarTempoReal(server) {
  const io = new Server(server, {
    cors: { origin: true, methods: ["GET", "POST"] },
    maxHttpBufferSize: 16384,
  });
  io.use((socket, next) => {
    try {
      const dados = jwt.verify(
        socket.handshake.auth?.ticket,
        process.env.JWT_SECRET,
        { algorithms: ["HS256"] },
      );
      if (
        typeof dados !== "object" ||
        dados.finalidade !== "notificacoes" ||
        !Number.isSafeInteger(dados.id) ||
        dados.id < 1 ||
        !["web", "mobile"].includes(dados.plataforma) ||
        !Number.isFinite(dados.sessaoExpiraEm) ||
        dados.sessaoExpiraEm * 1000 <= Date.now()
      )
        throw new Error();
      socket.data.usuarioId = dados.id;
      socket.data.plataforma = dados.plataforma;
      socket.data.expiraEm = dados.sessaoExpiraEm * 1000;
      next();
    } catch {
      next(new Error("Conexão não autorizada. Renove sua sessão."));
    }
  });
  io.on("connection", (socket) => {
    socket.join(`usuario:${socket.data.usuarioId}:${socket.data.plataforma}`);
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(1, socket.data.expiraEm - Date.now()),
    );
    timer.unref?.();
    socket.once("disconnect", () => clearTimeout(timer));
  });
  const transmitir = ({ usuarioId, itens }) => {
    for (const plataforma of ["web", "mobile"])
      io.to(`usuario:${usuarioId}:${plataforma}`).emit(
        "notificacoes",
        itens.map((n) => publico(n, plataforma)),
      );
  };
  eventos.on("alteracao", transmitir);
  io.engine.on("close", () => eventos.off("alteracao", transmitir));
  return io;
}
