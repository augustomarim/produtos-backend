import { Router } from "express";
const router = Router();

router.get("/", (req, res) => {
  res.json([
    { id: 1,
      codigo_produto: "PROD001",
      descricao_produto: "Produto 1",
      status: "ativo",
      foto_produto: null    
    },
    { id: 2,
      codigo_produto: "PROD002",
      descricao_produto: "Produto 2",
      status: "inativo",
      foto_produto: null
    },    
  ]);
});

export default router;