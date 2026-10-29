import { Router } from "express";
import {z} from "zod";
import prisma from "../prisma.js";

const router = Router();

const produtoSchema = z.object({
    codigo_produto: z.string({context: "Código do produto é obrigatório"}).trim().min(1, {context: "Código do produto é obrigatório"}),
    descricao_produto: z.string({context: "Descrição do produto é obrigatória"}).trim().min(1, {context: "Descrição do produto é obrigatória"}),
    status: z.enum(["ativo", "inativo"], {errorMap: () => ({message: "Status do produto deve ser 'ativo' ou 'inativo'"}),}).optional(),
    foto_produto: z.string().nullable().optional(),
});

function validateProduto(schema, data, res) {
    const result = schema.safeParse(data);
    if (!result.success) {
        const errorMessages = result.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
        }));
        res.status(400).json({errorMessages});
        return null;
    }
    return result.data;
}

function lerId(req, res) {
    const id = Number(req.params.id);
    if(!Number.isInteger(id)){
        res.status(400).json({error: "ID inválido"});
        return null;
    }
    return id;
    }

function tratarErro(error, res) {
    if (error.code === "P2002") {
        return res.status(409).json({ error: "Código do produto já existe" });
    }
    if (error.code === "P2025") {
        return res.status(404).json({ error: "Produto não encontrado" });
    }
    console.error(error);
    return res.status(500).json({ error: "Erro interno do servidor" });
}

router.get("/", async (req, res) => {
    try {
    const produtos = await prisma.produto.findMany({
            orderBy: [{ status: "asc" }, { id: "asc" }],
        });
        res.json(produtos);
    } catch (error) {
            tratarErro(error, res);
    }
});

router.get("/:id", async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    try {
        const produto = await prisma.produto.findUnique({
            where: { id },
        });
        if (!produto) {
            return res.status(404).json({ error: "Produto não encontrado" });
        }
        res.json(produto);
    } catch (error) {
        tratarErro(error, res);
    }
});

router.post("/", async (req, res) => {
    const produtoData = validateProduto(produtoSchema, req.body, res);
    if (!produtoData) return;

    try {
        const produto = await prisma.produto.create({
            data: produtoData,
        });
        res.status(201).json(produto);
    } catch (error) {
        tratarErro(error, res);
    }
});

router.put("/:id", async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    const produtoData = validateProduto(produtoSchema.partial(), req.body, res);
    if (!produtoData) return;

    try {
        const produto = await prisma.produto.update({
            where: { id },
            data: produtoData,
        });
        res.json(produto);
    } catch (error) {
        tratarErro(error, res);
    }
});

router.patch("/:id/status", async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    try {
        const produto = await prisma.produto.findUnique({
            where: { id },
        });
        if (!produto) {
            return res.status(404).json({ error: "Produto não encontrado" });
        }
        const updatedProduto = await prisma.produto.update({
            where: { id },
            data: { status: produto.status === "ativo" ? "inativo" : "ativo" },
        });
        res.json(updatedProduto);
    } catch (error) {
        tratarErro(error, res);
    }
});

router.delete("/:id", async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    try {
        const produto = await prisma.produto.delete({
            where: { id },
        });
        res.status(204).send();
    } catch (error) {
        tratarErro(error, res);
    }
});

export default router;