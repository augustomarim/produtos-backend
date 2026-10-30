import "dotenv/config";
import express from "express";
import cors from "cors";
import produtosRoutes from "./routes/produtosRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import auth from "./middlewares/auth.js";

const variaveisObrigatorias = [
  "DATABASE_URL", 
  "JWT_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
];

const variaveisFaltando = variaveisObrigatorias.filter((variavel) => !process.env[variavel]);
if (variaveisFaltando.length > 0) {
  console.error(`Erro: As seguintes variáveis de ambiente são obrigatórias e não foram definidas: ${variaveisFaltando.join(", ")}`);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use("/produtos", auth, produtosRoutes);
app.use("/auth", authRoutes);
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido" });
  }
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});