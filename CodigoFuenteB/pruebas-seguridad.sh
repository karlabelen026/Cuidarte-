#!/usr/bin/env bash
# Pruebas de seguridad Cuidarte+ (mismas para ANTES y DESPUES).
# Uso: bash pruebas-seguridad.sh <etiqueta>   (requiere curl, node y docker; stack levantado)
# Nota: el bloque H6 deja la IP bloqueada 15 min para login (reinicie el backend para repetir).
API=http://localhost:4444
WEB=http://localhost:3333
PG=${PG_CONTAINER:-cuidarteplus-postgres-ev}
TAG=${1:-run}
psqlq() { docker exec "$PG" psql -U postgres -d cuidarteplus -t -A -c "$1"; }
code_body() { # metodo url [token] [data]
  local m=$1 u=$2 t=$3 d=$4
  local args=(-s -o /tmp/b.txt -w "%{http_code}" -X "$m" "$API$u" -H "Content-Type: application/json")
  [ -n "$t" ] && args+=(-H "Authorization: Bearer $t")
  [ -n "$d" ] && args+=(-d "$d")
  local c; c=$(curl "${args[@]}"); echo "HTTP $c  $(head -c 220 /tmp/b.txt)"
}
login() { curl -s -X POST "$API/autenticacion/login" -H "Content-Type: application/json" -d "{\"nombre_usuario\":\"$1\",\"password\":\"$2\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }

echo "================= H1 CONTRASENAS ================="
echo "-- POST /autenticacion/login admin/admin"
code_body POST /autenticacion/login "" '{"nombre_usuario":"admin","password":"admin"}' | cut -c1-60
echo "-- POST /autenticacion/login medico/medico y paciente/paciente"
code_body POST /autenticacion/login "" '{"nombre_usuario":"medico","password":"medico"}' | cut -c1-40
code_body POST /autenticacion/login "" '{"nombre_usuario":"paciente","password":"paciente"}' | cut -c1-40
echo "-- POST /autenticacion/login admin/clave-incorrecta"
code_body POST /autenticacion/login "" '{"nombre_usuario":"admin","password":"incorrecta"}'
echo "-- POST /autenticacion/registro nuevo usuario (prueba_$TAG / Secreta123)"
code_body POST /autenticacion/registro "" "{\"nombre_usuario\":\"prueba_$TAG\",\"password\":\"Secreta123\",\"correo\":\"prueba_$TAG@test.cl\"}" | cut -c1-80
echo "-- Login del usuario recien registrado"
code_body POST /autenticacion/login "" "{\"nombre_usuario\":\"prueba_$TAG\",\"password\":\"Secreta123\"}" | cut -c1-40
echo "-- SELECT nombre_usuario, contrasena FROM usuarios (en BD)"
psqlq "SELECT nombre_usuario || ' | ' || contrasena FROM usuarios ORDER BY id"

ADMIN=$(login admin admin); MED=$(login medico medico); PAC=$(login paciente paciente)

echo "================= H2 SECRETO JWT ================="
echo "-- Token forjado con el secreto por defecto de docker-compose ('your-secret-key-change-in-production') -> GET /auditoria"
FORGED=$(node -e '
const c=require("crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({usuarioId:1,nombreUsuario:"admin",iat:Math.floor(Date.now()/1000)});
const s=c.createHmac("sha256","your-secret-key-change-in-production").update(h+"."+p).digest("base64url");
console.log(h+"."+p+"."+s)')
code_body GET /auditoria "$FORGED" | cut -c1-80
echo "-- Token forjado con el respaldo del codigo ('inseguro') -> GET /auditoria"
FORGED2=$(node -e '
const c=require("crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({usuarioId:1,nombreUsuario:"admin",iat:Math.floor(Date.now()/1000)});
const s=c.createHmac("sha256","inseguro").update(h+"."+p).digest("base64url");
console.log(h+"."+p+"."+s)')
code_body GET /auditoria "$FORGED2" | cut -c1-80

echo "================= H3 CONTROL DE ACCESO ================="
VID=$(psqlq "SELECT id FROM usuarios WHERE nombre_usuario='prueba_$TAG'")
echo "-- DELETE /usuarios/$VID SIN token"
code_body DELETE /usuarios/$VID
echo "-- DELETE /usuarios/$VID con token paciente"
code_body DELETE /usuarios/$VID "$PAC"
echo "-- POST /roles SIN token (rol_temp_$TAG)"
code_body POST /roles "" "{\"nombre\":\"rol_temp_$TAG\"}"
RID=$(psqlq "SELECT id FROM roles WHERE nombre='rol_temp_$TAG'")
[ -z "$RID" ] && RID=999
echo "-- DELETE /roles/$RID SIN token"
code_body DELETE /roles/$RID
echo "-- DELETE /roles/$RID con token paciente"
code_body DELETE /roles/$RID "$PAC"
echo "-- GET /pacientes/buscar/rut/16789456-K SIN token"
code_body GET /pacientes/buscar/rut/16789456-K
echo "-- GET /pacientes/buscar/rut/16789456-K con token paciente (no es su RUT)"
code_body GET /pacientes/buscar/rut/16789456-K "$PAC"
echo "-- GET /pacientes/buscar/rut/16789456-K con token medico"
code_body GET /pacientes/buscar/rut/16789456-K "$MED" | cut -c1-60
echo "-- GET /pacientes/2 SIN token / paciente(ajeno) / medico"
code_body GET /pacientes/2
code_body GET /pacientes/2 "$PAC"
code_body GET /pacientes/2 "$MED" | cut -c1-60
echo "-- GET /pacientes/1 con token paciente (propio)"
code_body GET /pacientes/1 "$PAC" | cut -c1-60
echo "-- GET /examenes SIN token / paciente (cantidad filas) / medico (cantidad filas)"
code_body GET /examenes
curl -s "$API/examenes" -H "Authorization: Bearer $PAC" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("paciente ->",Array.isArray(j)?j.length+" examenes, paciente_ids="+[...new Set(j.map(x=>x.paciente_id))]:d)})'
curl -s "$API/examenes" -H "Authorization: Bearer $MED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("medico   ->",Array.isArray(j)?j.length+" examenes":d)})'
echo "-- GET /documentos/1 SIN token"
code_body GET /documentos/1

echo "================= H4 FUGA DE ERRORES ================="
echo "-- GET /usuarios/abc con token admin"
code_body GET /usuarios/abc "$ADMIN"
echo "-- GET /pacientes/abc con token admin"
code_body GET /pacientes/abc "$ADMIN"
echo "-- PUT /examenes/abc con token medico (tarda 5s por delayMiddleware)"
code_body PUT /examenes/abc "$MED" '{"notas":"x"}'

echo "================= H5 CORS Y CABECERAS ================="
echo "-- API: GET / con Origin: http://evil.example"
curl -s -D - -o /dev/null "$API/" -H "Origin: http://evil.example" | grep -iE "^(access-control|x-powered-by|content-security|x-content-type|x-frame|strict-transport|referrer-policy)" || echo "(sin cabeceras relevantes)"
echo "-- API: GET / con Origin: http://localhost:3333"
curl -s -D - -o /dev/null "$API/" -H "Origin: http://localhost:3333" | grep -iE "^access-control-allow-origin" || echo "(sin Access-Control-Allow-Origin)"
echo "-- FRONT nginx: GET $WEB/"
curl -s -D - -o /dev/null "$WEB/" | grep -iE "^(content-security|x-content-type|x-frame|referrer-policy|server)" || echo "(sin cabeceras de seguridad)"

echo "================= H6 RATE LIMIT LOGIN ================="
echo "-- 12 intentos fallidos seguidos de login (admin / malas)"
for i in $(seq 1 12); do
  c=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/autenticacion/login" -H "Content-Type: application/json" -d '{"nombre_usuario":"admin","password":"mala'$i'"}')
  printf "%s " "$c"
done; echo
echo "-- Cabeceras RateLimit en la ultima respuesta"
curl -s -D - -o /dev/null -X POST "$API/autenticacion/login" -H "Content-Type: application/json" -d '{"nombre_usuario":"admin","password":"mala"}' | grep -iE "^(ratelimit|retry-after)" || echo "(sin cabeceras RateLimit)"
