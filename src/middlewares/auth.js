import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  const token = header.slice(7);

  try {
    const usuario = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    if (
      typeof usuario !== "object" ||
      !Number.isInteger(usuario.id) ||
      usuario.id <= 0 ||
      usuario.id > 2147483647
    ) {
      return res.status(401).json({ error: "Token inválido" });
    }
    req.usuario = usuario;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}
