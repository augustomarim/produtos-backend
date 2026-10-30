import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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

    const token = jwt.sign({ id: usuario.id, email: usuario.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.json({ token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email }
     });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

export default router;
