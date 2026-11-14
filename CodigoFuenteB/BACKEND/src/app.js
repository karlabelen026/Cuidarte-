const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");

const config = require("./config"); // falla al arrancar si faltan variables obligatorias
const { pool } = require("./db");
const { migratePlaintextPasswords } = require("./utils/passwords");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const pacientesRoutes = require("./routes/pacientes");
const examenesRoutes = require("./routes/examenes");
const documentosRoutes = require("./routes/documentos");
const tipoExamenRoutes = require("./routes/tipo-examen");
const auditRoutes = require("./routes/audit");
const rolesRoutes = require("./routes/roles");

const app = express();

// Cabeceras de seguridad HTTP (CSP, X-Content-Type-Options, X-Frame-Options, etc.)
// upgrade-insecure-requests se desactiva porque el entorno local no usa TLS
// (si no, Swagger UI en /docs intentaría cargar sus recursos por https).
app.use(
  helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  })
);
// CORS restringido al origen del frontend
app.use(
  cors({
    origin: config.FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(morgan("dev"));

const uploadsDir = path.join(__dirname, "..", "uploads", "documentos");
fs.mkdirSync(uploadsDir, { recursive: true });

app.use("/autenticacion", authRoutes);
app.use("/usuarios", userRoutes);
app.use("/pacientes", pacientesRoutes);
app.use("/examenes", examenesRoutes);
app.use("/documentos", documentosRoutes);
app.use("/tipo-examen", tipoExamenRoutes);
app.use("/auditoria", auditRoutes);
app.use("/roles", rolesRoutes);

const openapi = require("./openapi.json");
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));
app.get("/openapi.json", (req, res) => {
  res.json(openapi);
});

app.use("/files/documentos", express.static(uploadsDir));

app.get("/", (req, res) => {
  res.json({ name: "cuidarteplus", status: "ok" });
});

const PORT = config.PORT;
migratePlaintextPasswords(pool)
  .catch((err) => console.error("[seguridad] No se pudo migrar contraseñas:", err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`cuidarteplus API escuchando en puerto ${PORT}`);
    });
  });
