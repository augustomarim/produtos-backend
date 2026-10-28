import { Router } from "express";
import prisma from "../prisma.js";

const router = Router();

router.get("/", async (req, res) => {
    try {
    const produtos = await prisma.produto.findMany({
            orderBy: [{ status: "asc" }, { id: "asc" }],
        });
        res.json(produtos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao listar produtos" });
    }
});

export default router;