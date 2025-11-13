// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcrypt";
import webpush from "web-push";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "cambiame_esto_en_produccion";

// ---------- leer keys.json (VAPID) ----------
let VAPID_PUBLIC_KEY = null;
let VAPID_PRIVATE_KEY = null;
try {
  const keysPath = path.join(process.cwd(), "keys.json");
  const keysRaw = await fs.readFile(keysPath, "utf8");
  const keys = JSON.parse(keysRaw);
  // soporta ambos nombres: PUBLIC_KEY / PRIVATE_KEY o publicKey/privateKey
  VAPID_PUBLIC_KEY = keys.PUBLIC_KEY || keys.publicKey || keys.publicKey || keys.publicKey?.toString();
  VAPID_PRIVATE_KEY = keys.PRIVATE_KEY || keys.privateKey || keys.privateKey || keys.privateKey?.toString();
} catch (err) {
  console.warn("⚠️ keys.json no encontrado o inválido en /back. Push no funcionará hasta agregar las claves VAPID.");
}

// configurar web-push (si hay claves)
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      "mailto:tu-email@example.com",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    console.log("✅ web-push configurado (VAPID keys cargadas)");
  } catch (err) {
    console.error("❌ Error configurando web-push:", err);
  }
} else {
  console.warn("⚠️ VAPID keys faltantes. Agrega PUBLIC_KEY y PRIVATE_KEY en keys.json");
}

const app = express();
app.use(express.json());

// ---- CORS: permite tu front dev + deploy
const allowedOrigins = [
  "http://localhost:5173",
  "https://pwa-fe-theta.vercel.app",
  // agrega dominios de producción si los tienes
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // permite herramientas como Postman
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS no permitido"), false);
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  credentials: true,
}));

// ---------- MongoDB ----------
if (!MONGO_URI) {
  console.error("❌ MONGO_URI no definido en .env. Abortando.");
  process.exit(1);
}
const client = new MongoClient(MONGO_URI);
let usuarios; // colección 'usuarios'

async function initDB() {
  try {
    await client.connect();
    const db = client.db("loginpy");
    usuarios = db.collection("usuarios");

    // índices
    await usuarios.createIndex({ usuario: 1 }, { unique: true });
    await usuarios.createIndex({ correo: 1 }, { unique: true });

    // crear admin 'juan' si no existe (password: 123)
    const admin = await usuarios.findOne({ usuario: "juan" });
    if (!admin) {
      const hashed = await bcrypt.hash("123", 10);
      await usuarios.insertOne({
        usuario: "juan",
        correo: "juan@local",
        password: hashed,
        role: "admin",
        suscripcion: null
      });
      console.log("✅ Admin 'juan' creado (password: 123)");
    }

    console.log("✅ Conectado a MongoDB (loginpy)");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}
await initDB();

// ---------- Helpers: JWT ----------
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  const parts = header.split(" ");
  if (parts.length !== 2) return res.status(401).json({ error: "Formato token inválido" });
  const token = parts[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// ---------- Rutas ----------

// healthcheck
app.get("/", (req, res) => res.json({ ok: true }));

// Register
// body: { usuario, correo, password }
app.post("/api/register", async (req, res) => {
  try {
    const { usuario, correo, password } = req.body;
    if (!usuario || !correo || !password) return res.status(400).json({ message: "Faltan datos" });

    const exists = await usuarios.findOne({ $or: [{ usuario }, { correo }] });
    if (exists) return res.status(409).json({ message: "Usuario o correo ya registrado" });

    const hashed = await bcrypt.hash(password, 10);
    const role = (usuario === "juan") ? "admin" : "user";

    const result = await usuarios.insertOne({
      usuario,
      correo,
      password: hashed,
      role,
      suscripcion: null
    });

    return res.status(201).json({ message: "Usuario registrado", id: result.insertedId });
  } catch (err) {
    console.error("Error /api/register:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Login
// body: { usuario, password }
// response: { message, token, usuario, correo, role }
app.post("/api/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) return res.status(400).json({ message: "Faltan credenciales" });

    const user = await usuarios.findOne({ usuario });
    if (!user) return res.status(401).json({ message: "Usuario o contraseña incorrectos" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Usuario o contraseña incorrectos" });

    const token = signToken({ id: user._id.toString(), usuario: user.usuario, role: user.role || "user" });
    return res.status(200).json({
      message: "Login correcto",
      token,
      usuario: user.usuario,
      correo: user.correo,
      role: user.role || "user"
    });
  } catch (err) {
    console.error("Error /api/login:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Guardar suscripción push (requiere token)
// body: { subscription }
app.post("/api/subscribe", authMiddleware, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ message: "subscription requerida" });

    await usuarios.updateOne(
      { usuario: req.user.usuario },
      { $set: { suscripcion: subscription } }
    );

    return res.status(201).json({ message: "Suscripción guardada" });
  } catch (err) {
    console.error("Error /api/subscribe:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/users (admin only) -> sin password ni suscripcion
app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

    const list = await usuarios.find({}, { projection: { password: 0, suscripcion: 0 } }).toArray();
    return res.json(list);
  } catch (err) {
    console.error("Error /api/users:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Enviar push por id (admin only)
// POST /api/send-push/:id  body: { title, body }
app.post("/api/send-push/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

    const userId = req.params.id;
    if (!ObjectId.isValid(userId)) return res.status(400).json({ message: "id inválido" });

    const { title, body } = req.body;
    const target = await usuarios.findOne({ _id: new ObjectId(userId) });
    if (!target || !target.suscripcion) return res.status(404).json({ message: "Usuario objetivo no suscrito" });

    const payload = JSON.stringify({
      titulo: title || "Notificación",
      mensaje: body || `Hola ${target.usuario}, tienes una notificación`,
      icon: "/assets/img/icon3.png"
    });

    try {
      await webpush.sendNotification(target.suscripcion, payload);
      return res.json({ message: "Push enviado" });
    } catch (err) {
      console.error("Error enviando push por id:", err);
      if (err.statusCode === 410 || (err.body && err.body.includes("expired"))) {
        await usuarios.updateOne({ _id: new ObjectId(userId) }, { $unset: { suscripcion: "" } });
        return res.status(410).json({ message: "Suscripción expirada y eliminada" });
      }
      return res.status(500).json({ message: "Error enviando notificación" });
    }
  } catch (err) {
    console.error("Error /api/send-push/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Enviar push por nombre de usuario (compatibilidad) - admin only
// POST /api/send-push-to-user  body: { targetUsuario, titulo, mensaje }
app.post("/api/send-push-to-user", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

    const { targetUsuario, titulo, mensaje } = req.body;
    if (!targetUsuario) return res.status(400).json({ message: "targetUsuario requerido" });

    const target = await usuarios.findOne({ usuario: targetUsuario });
    if (!target || !target.suscripcion) return res.status(404).json({ message: "Usuario objetivo no suscrito" });

    const payload = JSON.stringify({
      titulo: titulo || "Notificación",
      mensaje: mensaje || `Hola ${targetUsuario}, tienes una notificación`,
      icon: "/assets/img/icon3.png"
    });

    try {
      await webpush.sendNotification(target.suscripcion, payload);
      return res.json({ message: "Push enviado" });
    } catch (err) {
      console.error("Error enviando push to user:", err);
      if (err.statusCode === 410 || (err.body && err.body.includes("expired"))) {
        await usuarios.updateOne({ usuario: targetUsuario }, { $unset: { suscripcion: "" } });
        return res.status(410).json({ message: "Suscripción expirada y eliminada" });
      }
      return res.status(500).json({ message: "Error enviando notificación" });
    }
  } catch (err) {
    console.error("Error /api/send-push-to-user:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

app.listen(PORT, () => console.log(`🚀 Backend corriendo en puerto ${PORT}`));
