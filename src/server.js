import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import produtosRoutes from "./routes/produtosRoutes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/produtos", produtosRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});