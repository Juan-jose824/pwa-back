// server.js
import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import webpush from "web-push";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// -------------------- CORS --------------------
const allowedOrigins = ['http://localhost:5173', 'https://pwajuanito.vercel.app'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: ${origin} no permitido`));
    }
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  credentials: true
}));

// Preflight para todos los endpoints
app.options('*', cors());

// -------------------- MongoDB --------------------
const client = new MongoClient(process.env.MONGO_URI);
let usuarios;

async function conectarMongo() {
  try {
    await client.connect();
    const db = client.db("loginpy");
    usuarios = db.collection("usuarios");
    console.log("✅ Conectado a MongoDB Atlas (loginpy)");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
  }
}
conectarMongo();

// -------------------- VAPID --------------------
if (!process.env.PUBLIC_KEY || !process.env.PRIVATE_KEY) {
  console.error("❌ Faltan las claves VAPID en variables de entorno");
  process.exit(1);
}

webpush.setVapidDetails(
  "mailto:juanjoserivera1928@gmail.com",
  process.env.PUBLIC_KEY,
  process.env.PRIVATE_KEY
);

// -------------------- Endpoints --------------------

// Guardar suscripción push en MongoDB
app.post("/api/subscribe", async (req, res) => {
  try {
    const { usuario, subscription } = req.body;
    if (!usuario || !subscription) {
      return res.status(400).json({ error: "Faltan datos de usuario o suscripción" });
    }

    await usuarios.updateOne(
      { usuario },
      { $set: { suscripcion: subscription } },
      { upsert: true }
    );

    console.log(`📬 Suscripción de ${usuario} guardada`);
    res.status(201).json({ message: "Suscripción registrada" });
  } catch (err) {
    console.error("❌ Error guardando suscripción:", err);
    res.status(500).json({ error: err.message });
  }
});

// Enviar notificación push
app.post("/api/send-push", async (req, res) => {
  try {
    const { usuario } = req.body;
    if (!usuario) return res.status(400).json({ error: "Falta el usuario" });

    const user = await usuarios.findOne({ usuario });
    if (!user || !user.suscripcion) {
      return res.status(400).json({ error: "No hay suscripción para este usuario" });
    }

    const payload = JSON.stringify({
      titulo: "¡Bienvenido!",
      mensaje: "Has iniciado sesión correctamente 🎉",
      icon: "/icon.png"
    });

    await webpush.sendNotification(user.suscripcion, payload);
    res.json({ message: "Push enviado correctamente" });
  } catch (err) {
    console.error("❌ Error enviando push:", err);
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) return res.status(400).json({ message: "Faltan credenciales" });

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

// -------------------- Server --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend corriendo en puerto ${PORT}`));
