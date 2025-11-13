import { MongoClient } from "mongodb";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI);

async function run() {
  try {
    await client.connect();
    const db = client.db("loginpy");
    const usuarios = db.collection("usuarios");

    const hashed = await bcrypt.hash("123", 10);

    await usuarios.updateOne(
      { usuario: "juan" },
      { $set: { password: hashed } }
    );

    console.log("✅ Contraseña de 'juan' hasheada correctamente");
  } finally {
    await client.close();
  }
}

run();
