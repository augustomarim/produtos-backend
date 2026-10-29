import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = Router();

const registerSchema = z.object({
  nome: z.string({ message: "Nome é obrigatório" }).trim().min(1, "Nome é obrigatório"),
  email: z.string({ message: "Email é obrigatório" }).trim().toLowerCase().email("Email inválido"),
  senha: z.string({ message: "Senha é obrigatória" }).min(6, "Senha deve ter pelo menos 6 caracteres"),
});

const loginSchema = z.object({
  email: z.string({ message: "Email é obrigatório" }).trim().toLowerCase().email("Email inválido"),
  senha: z.string({ message: "Senha é obrigatória" }).min(6, "Senha deve ter pelo menos 6 caracteres"),
});

router.post("/register", async (req, res) => {
  const result = registerSchema.safeParse(req.body ?? {});
  if (!result.success) {
    const errorMessages = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
    }));
    return res.status(400).json({ errors: errorMessages });
  }

  const { nome, email, senha } = result.data;

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const usuario = await prisma.usuario.create({
        data: { nome, email, senha: senhaHash },
        select: { id: true, nome: true, email: true },
    });
    res.status(201).json(usuario);
  } catch (error) {
    if (error.code === "P2002") {
        return res.status(400).json({ error: "Email já está em uso" });
    }
    console.error(error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

export default router;
