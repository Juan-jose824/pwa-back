import express from "express";
import cors from "cors"; // 👈 instala esto con npm install cors

const app = express();
app.use(express.json());

// Habilitar CORS para permitir conexión desde Vite (localhost:5173)
app.use(cors({
  origin: "http://localhost:5173", // tu frontend
  methods: ["GET", "POST"],
  credentials: true
}));

// Endpoint de prueba
app.post("/api/post", (req, res) => {
  console.log("📨 Datos recibidos:", req.body);
  res.status(200).json({ message: "POST recibido correctamente" });
});

app.listen(3000, () => console.log("✅ Backend corriendo en http://localhost:3000"));
