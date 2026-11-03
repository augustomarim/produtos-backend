import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import prisma from "../prisma.js";

const DURACAO_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export function gerarAccessToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );
}

export function calcularHash(token) {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

export async function criarRefreshToken(usuarioId, db = prisma) {
  const token = randomBytes(32).toString("hex");

  const expiresAt = new Date(
    Date.now() + DURACAO_REFRESH_MS,
  );

  await db.refreshToken.create({
    data: {
      tokenHash: calcularHash(token),
      usuarioId,
      expiresAt,
    },
  });

  return { token, expiresAt };
}