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

// ---------- Leer keys.json (VAPID) ----------
let VAPID_PUBLIC_KEY = null;
let VAPID_PRIVATE_KEY = null;
try {
  const keysPath = path.join(process.cwd(), "keys.json");
  const keysRaw = await fs.readFile(keysPath, "utf8");
  const keys = JSON.parse(keysRaw);
  VAPID_PUBLIC_KEY = keys.PUBLIC_KEY || keys.publicKey;
  VAPID_PRIVATE_KEY = keys.PRIVATE_KEY || keys.privateKey;
} catch (err) {
  console.warn("⚠️ keys.json no encontrado o inválido. Push no funcionará hasta agregar las claves VAPID.");
}

// Configurar web-push
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:tu-email@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log("✅ web-push configurado");
}

const app = express();
app.use(express.json());

const allowedOrigins = [
  "http://localhost:5173",
  "https://pwa-fe-theta.vercel.app",
];
app.use(cors({
  origin: (origin, cb) =>
    (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error("CORS no permitido"), false)
}));

// ---------- MongoDB ----------
if (!MONGO_URI) {
  console.error("❌ MONGO_URI no definido en .env. Abortando.");
  process.exit(1);
}
const client = new MongoClient(MONGO_URI);
let usuarios;

async function initDB() {
  try {
    await client.connect();
    const db = client.db("loginpy");
    usuarios = db.collection("usuarios");

    await usuarios.createIndex({ usuario: 1 }, { unique: true });
    await usuarios.createIndex({ correo: 1 }, { unique: true });

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

// ---------- Helpers JWT ----------
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  const parts = header.split(" ");
  if (parts.length !== 2) return res.status(401).json({ error: "Formato token inválido" });
  try {
    req.user = jwt.verify(parts[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// ---------- Rutas ----------

// Healthcheck
app.get("/", (req, res) => res.json({ ok: true }));

// Register
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

// Guardar suscripción push (login)
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

// Guardar suscripción para nuevo usuario
app.post("/api/subscribe-new-user", async (req, res) => {
  try {
    const { userId, subscription } = req.body;
    if (!userId || !subscription) return res.status(400).json({ message: "Faltan datos" });

    await usuarios.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { suscripcion: subscription } }
    );

    return res.status(201).json({ message: "Suscripción guardada para nuevo usuario" });
  } catch (err) {
    console.error("Error /api/subscribe-new-user:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Obtener lista de usuarios (admin)
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

// Enviar push a usuario (admin) con validación robusta
app.post("/api/send-push/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

    const userId = req.params.id;
    if (!ObjectId.isValid(userId)) return res.status(400).json({ message: "ID inválido" });

    const { title, body } = req.body;

    const target = await usuarios.findOne({ _id: new ObjectId(userId) });
    if (!target) return res.status(404).json({ message: "Usuario no encontrado" });

    if (!target.suscripcion || !target.suscripcion.endpoint) {
      return res.status(400).json({ message: "Usuario objetivo no tiene suscripción válida" });
    }

    const payload = JSON.stringify({
      titulo: title || "Notificación",
      mensaje: body || `Hola ${target.usuario}, tienes una notificación`,
      icon: "/assets/img/icon3.png"
    });

    try {
      await webpush.sendNotification(target.suscripcion, payload, { TTL: 60 });
      console.log(`✅ Push enviado a ${target.usuario}`);
      return res.json({ message: "Push enviado correctamente" });
    } catch (errPush) {
      console.error(`⚠️ Error enviando push a ${target.usuario}:`, errPush);
      // Eliminar suscripción inválida
      if (errPush.statusCode === 410 || errPush.statusCode === 404) {
        await usuarios.updateOne(
          { _id: target._id },
          { $set: { suscripcion: null } }
        );
        console.log(`Suscripción inválida eliminada para ${target.usuario}`);
      }
      return res.status(500).json({ message: "Error enviando push", error: errPush.body || errPush.message });
    }

  } catch (err) {
    console.error("Error /api/send-push/:id:", err);
    return res.status(500).json({ message: "Error interno", error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Backend corriendo en puerto ${PORT}`));
