// Configuración centralizada. Las variables sensibles NO tienen valor por
// defecto: si faltan, el servidor se detiene al arrancar con un mensaje claro.
require("dotenv").config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(
      `[config] Falta la variable de entorno obligatoria ${name}. ` +
        "Defínela en el entorno o en el archivo .env (ver .env.example)."
    );
    process.exit(1);
  }
  return value;
}

const JWT_SECRET = requireEnv("JWT_SECRET");
if (JWT_SECRET.length < 32) {
  console.error("[config] JWT_SECRET debe tener al menos 32 caracteres.");
  process.exit(1);
}

module.exports = {
  JWT_SECRET,
  DATABASE_URL: requireEnv("DATABASE_URL"),
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3333",
  PORT: process.env.PORT || 3000,
};
