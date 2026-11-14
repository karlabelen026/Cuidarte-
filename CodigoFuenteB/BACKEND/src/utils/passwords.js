// Utilidades de contraseñas con bcrypt (implementación bcryptjs: mismo
// algoritmo y formato $2a/$2b$, sin compilación nativa en node:alpine).
const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 12;
const BCRYPT_REGEX = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
// Hash ficticio para igualar el tiempo de respuesta cuando el usuario no existe
const DUMMY_HASH = bcrypt.hashSync("dummy-password-para-tiempo-constante", SALT_ROUNDS);

const isBcryptHash = (value) => typeof value === "string" && BCRYPT_REGEX.test(value);

const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);

async function verifyPassword(plain, storedHash) {
  if (!isBcryptHash(storedHash)) {
    // Nunca se compara texto plano: si quedara algún valor sin hashear, falla.
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, storedHash);
}

// Migración idempotente: hashea las contraseñas que aún estén en texto plano
// (por ejemplo, en un volumen de BD creado antes de este cambio).
async function migratePlaintextPasswords(pool) {
  const { rows } = await pool.query("SELECT id, contrasena FROM usuarios");
  let migrated = 0;
  for (const row of rows) {
    if (!isBcryptHash(row.contrasena)) {
      const hash = await hashPassword(row.contrasena);
      await pool.query("UPDATE usuarios SET contrasena = $1 WHERE id = $2", [hash, row.id]);
      migrated++;
    }
  }
  if (migrated > 0) {
    console.log(`[seguridad] ${migrated} contraseña(s) en texto plano migradas a bcrypt`);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  isBcryptHash,
  migratePlaintextPasswords,
  DUMMY_HASH,
};
