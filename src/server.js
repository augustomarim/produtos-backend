import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import produtosRoutes from "./routes/produtosRoutes.js";
import authRoutes from "./routes/authRoutes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/produtos", produtosRoutes);
app.use("/auth", authRoutes);
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});