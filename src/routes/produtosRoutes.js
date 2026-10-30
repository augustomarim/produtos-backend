import { Router } from "express";
import {z} from "zod";
import prisma from "../prisma.js";
import cloudinary from "../cloudinary.js";
import multer from "multer";

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB
    fileFilter: (req, file, cb) => {
        const permitidos = ["image/jpeg", "image/png", "image/webp"];
        if (permitidos.includes(file.mimetype)) return cb(null, true);
        cb(new Error("Formato de arquivo não suportado"));
    }
});

function receberFoto(req, res, next) {
    upload.single("foto_produto")(req, res, (err) => {
        if (!err) return next();
        if(err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "A imagem deve ter no máximo 5MB" });
        }
        return res.status(400).json({ error: err.message });
    });
}

function sendFotoToCloudinary(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: "produtos", resource_type: "image" }, 
        (error, result) => (error ? reject(error) : resolve(result)),
        );
        stream.end(buffer);
    });
}

function comMiniatura(produto) {
    const foto = produto.foto_produto;
    const foto_miniatura = foto && foto.includes("/upload/") ? foto.replace("/upload/", "/upload/c_fill,w_150,h_150,q_auto,f_auto/")
    : null;
    return { ...produto, foto_miniatura };
}   

const camposObrigatorios = {
    codigo_produto: z.string({ message: "Código do produto é obrigatório" }).trim().min(1, "Código do produto é obrigatório"),
    descricao_produto: z.string({ message: "Descrição do produto é obrigatória" }).trim().min(1, "Descrição do produto é obrigatória"),
};

const criarProdutoSchema = z.object(camposObrigatorios);

const atualizarProdutoSchema = z.object({
    ...camposObrigatorios,
    status: z.enum(["ativo", "inativo"], {
        errorMap: () => ({ message: "Status deve ser 'ativo' ou 'inativo'" }),
    }),
}).partial();

function validateProduto(schema, data, res) {
    const result = schema.safeParse(data ?? {});
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
        return res.status(409).json({ error: "Já existe um produto com este código" });
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
        res.json(produtos.map(comMiniatura));
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
        res.json(comMiniatura(produto));
    } catch (error) {
        tratarErro(error, res);
    }
});

router.post("/", receberFoto, async (req, res) => {
    const produtoData = validateProduto(criarProdutoSchema, req.body, res);
    if (!produtoData) return;

    try {
        if (req.file) {
            const result = await sendFotoToCloudinary(req.file.buffer);
            produtoData.foto_produto = result.secure_url;
        }
        const produto = await prisma.produto.create({
            data: produtoData,
        });
        res.status(201).json(comMiniatura(produto));
    } catch (error) {
        tratarErro(error, res);
    }
});

router.put("/:id", receberFoto, async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    const produtoData = validateProduto(atualizarProdutoSchema, req.body, res);
    if (!produtoData) return;

    try {
        if (req.file) {
            const result = await sendFotoToCloudinary(req.file.buffer);
            produtoData.foto_produto = result.secure_url;
        }
        const produto = await prisma.produto.update({
            where: { id },
            data: produtoData,
        });
        res.json(comMiniatura(produto));
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
        res.json(comMiniatura(updatedProduto));
    } catch (error) {
        tratarErro(error, res);
    }
});

router.delete("/:id", async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    try {
        await prisma.produto.delete({
            where: { id },
        });
        res.status(204).send();
    } catch (error) {
        tratarErro(error, res);
    }
});

export default router;