import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import webpush from "web-push";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: "http://localhost:5173" }));

// --- Conexión a MongoDB Atlas ---
const client = new MongoClient(process.env.MONGO_URI);
let usuarios;

async function conectarMongo() {
  try {
    await client.connect();
    const db = client.db("loginpy"); // tu base
    usuarios = db.collection("usuarios");
    console.log("✅ Conectado a MongoDB Atlas (loginpy)");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
  }
}
conectarMongo();

// --- Claves VAPID (para notificaciones push) ---
const keys = JSON.parse(fs.readFileSync("keys.json"));
webpush.setVapidDetails("mailto:tucorreo@example.com", keys.publicKey, keys.privateKey);

let suscripcion;

// --- Endpoint: Registrar suscripción desde frontend ---
app.post("/api/subscribe", (req, res) => {
  suscripcion = req.body;
  console.log("📬 Suscripción guardada en el servidor");
  res.status(201).json({ message: "Suscripción registrada" });
});

// --- Endpoint: Enviar notificación push ---
app.post("/api/send-push", async (req, res) => {
  if (!suscripcion) return res.status(400).json({ error: "No hay suscripción registrada" });

  const payload = JSON.stringify({
    titulo: "¡Bienvenido!",
    mensaje: "Has iniciado sesión correctamente 🎉",
    icon: "/icon.png"
  });

  try {
    await webpush.sendNotification(suscripcion, payload);
    res.json({ message: "Push enviado correctamente" });
  } catch (err) {
    console.error("❌ Error enviando push:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Endpoint: Login con MongoDB ---
app.post("/api/login", async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const user = await usuarios.findOne({ usuario, password });
    if (user) {
      console.log(`👤 Login exitoso de ${usuario}`);
      res.status(200).json({ message: "Login correcto" });
    } else {
      res.status(401).json({ message: "Usuario o contraseña incorrectos" });
    }
  } catch (err) {
    console.error("❌ Error en login:", err);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.listen(3000, () => console.log("🚀 Backend corriendo en http://localhost:3000"));
