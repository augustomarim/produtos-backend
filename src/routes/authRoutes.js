import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import bcrypt from "bcryptjs";
import {
  gerarAccessToken,
  criarRefreshToken,
  calcularHash,
} from "../services/tokens.js";
import { validar } from "../validacao.js";

const router = Router();

const registerSchema = z.object({
  nome: z.string({ message: "Nome é obrigatório" }).trim().min(1, "Nome é obrigatório"),
  email: z.string({ message: "Email é obrigatório" }).trim().toLowerCase().email("Email inválido"),
  senha: z.string({ message: "Senha é obrigatória" }).min(6, "Senha deve ter pelo menos 6 caracteres"),
});

const loginSchema = z.object({
  email: z.string({ message: "Email é obrigatório" }).trim().toLowerCase().email("Email inválido"),
  senha: z.string({ message: "Senha é obrigatória" }).min(1, "Senha é obrigatória"),
});

router.post("/register", async (req, res) => {
  const dados = validar(registerSchema, req.body, res);
  if (!dados) return;

  const { nome, email, senha } = dados;

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const usuario = await prisma.usuario.create({
        data: { nome, email, senha: senhaHash },
        select: { id: true, nome: true, email: true },
    });
    res.status(201).json(usuario);
  } catch (error) {
    if (error.code === "P2002") {
        return res.status(409).json({ error: "Email já está em uso" });
    }
    console.error(error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

router.post("/login", async (req, res) => {
  const dados = validar(loginSchema, req.body, res);
  if (!dados) return;
  const { email, senha } = dados;

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    const senhaValida = usuario ? await bcrypt.compare(senha, usuario.senha) : false;

    if (!usuario || !senhaValida) {
        return res.status(401).json({ error: "Email ou senha inválidos" });
    }

    const token = gerarAccessToken(usuario);

    const refresh = await criarRefreshToken(usuario.id);

    res.json({
    token,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

const refreshSchema = z.object({
  refreshToken: z.string().regex(/^[a-f0-9]{64}$/),
});

router.post("/refresh", async (req, res) => {
  const dados = validar(refreshSchema, req.body, res);
  if (!dados) return;

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const agora = new Date();

      const registro = await tx.refreshToken.findUnique({
        where: {
          tokenHash: calcularHash(dados.refreshToken),
        },
        include: {
          usuario: true,
        },
      });

      if (
        !registro ||
        registro.revokedAt ||
        registro.expiresAt <= agora
      ) {
        return null;
      }

      // Só uma requisição pode consumir este token.
      const revogacao = await tx.refreshToken.updateMany({
        where: {
          id: registro.id,
          revokedAt: null,
          expiresAt: { gt: agora },
        },
        data: {
          revokedAt: agora,
        },
      });

      if (revogacao.count !== 1) {
        return null;
      }

      const refresh = await criarRefreshToken(
        registro.usuarioId,
        tx,
      );

      return {
        token: gerarAccessToken(registro.usuario),
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      };
    });

    if (!resultado) {
      return res.status(401).json({
        error: "Refresh token inválido ou expirado",
      });
    }

    return res.json(resultado);
  } catch (error) {
    console.error("Falha ao renovar sessão:", error.code || error.name);

    return res.status(500).json({
      error: "Erro interno do servidor",
    });
  }
});

router.post("/logout", async (req, res) => {
  const dados = validar(refreshSchema, req.body, res);
  if (!dados) return;

  try {
    await prisma.refreshToken.updateMany({
      where: {
        tokenHash: calcularHash(dados.refreshToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return res.status(204).send();
  } catch (error) {
    console.error(
      "Falha ao encerrar sessão:",
      error.code || error.name,
    );

    return res.status(500).json({
      error: "Erro interno do servidor",
    });
  }
});

export default router;
