// Middleware de autenticación + autorización por rol (OWASP A01).
// Uso: router.delete("/:id", requireRole(["admin"]), handler)
// Deja el token decodificado en req.authUser y los roles en req.userRoles.
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { JWT_SECRET } = require("../config");

function requireRole(allowedRoles) {
  return async (req, res, next) => {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No autorizado", glosa: "Token inválido" });
    }
    let authUser;
    try {
      authUser = jwt.verify(auth.substring(7), JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "No autorizado", glosa: "Token inválido" });
    }
    try {
      // Los roles se consultan en la BD (no se confía en los roles del token)
      const result = await pool.query(
        `SELECT r.nombre
         FROM usuario_roles ur
         JOIN roles r ON r.id = ur.rol_id
         WHERE ur.usuario_id = $1`,
        [authUser.usuarioId]
      );
      const userRoles = result.rows.map((r) => r.nombre);
      if (!allowedRoles.some((role) => userRoles.includes(role))) {
        return res.status(403).json({
          error: "No autorizado",
          glosa: "No tiene permisos para realizar esta acción",
        });
      }
      req.authUser = authUser;
      req.userRoles = userRoles;
      next();
    } catch (err) {
      console.error("[auth] Error al verificar roles:", err);
      return res.status(500).json({ error: "Error al verificar roles", glosa: "Error interno" });
    }
  };
}

module.exports = { requireRole };
