# Trabajos en VPS

Este despliegue corresponde a `trabajos-rctveracruz`. El portal histórico es una aplicación separada.

## Arquitectura

```text
Internet -> Caddy (HTTPS + React estático)
                -> PHP 8.3 FPM (API, sesiones, administración, documentos)
                     -> MySQL 8.4 (red de Docker, sin puerto público)
                     -> volumen privado de documentos
                     <-> ONLYOFFICE Cloud
```

El contenedor web contiene únicamente el build de React. El código PHP, Composer,
SQL y documentos privados están fuera de su raíz pública. Caddy envía las rutas
`/api/*`, `/recover/*` y `/health` al único front controller de PHP. La API corre
como `www-data`, con filesystem de solo lectura salvo almacenamiento y temporales.
Los registros rotan; los datos y certificados sobreviven a recrear contenedores.

`api/autoload.php` carga las clases; `api/lib/Application.php` construye los servicios;
`api/bootstrap.php` prepara HTTP; `api/bin/console.php` reutiliza los servicios desde CLI.
Los módulos de artículos, recuperación, sesiones, administración y ONLYOFFICE
conservan sus rutas actuales. El backend Node existente sigue como legado de desarrollo.
La compatibilidad con contraseñas scrypt del backend anterior usa ahora la extensión
nativa [scrypt](https://pecl.php.net/package/scrypt), incluida en la imagen PHP.
Reemplaza la dependencia `cast/scrypt`, cuyo requisito de PHP impedía una instalación limpia en PHP 8.

## Instalación Linux

Requiere Docker Engine y Compose v2. Dimensionar memoria con carga real: cada proceso
PHP tiene límite de 256 MB y el pool permite ocho procesos; ajustar `deploy/php/pool.conf`
según la RAM disponible. ONLYOFFICE se ejecuta en el proveedor externo.

1. Copiar esta carpeta al VPS, por ejemplo `/opt/trabajos`.
2. Apuntar el DNS del dominio al VPS y habilitar TCP 80/443. Revisar también registros AAAA.
3. Crear la configuración privada:

```sh
cd /opt/trabajos
cp deploy/vps.env.example .env.vps
chmod 600 .env.vps
```

Completar dominio, URL pública HTTPS, correo para certificados, contraseñas y ONLYOFFICE.
Generar secretos independientes con `openssl rand -hex 32`. En una migración conservar
`DOCUMENT_TOKEN_SECRET`, `RECOVERY_PEPPER` y el JWT del proveedor para mantener compatibilidad.
Si un valor contiene `$`, encerrarlo entre comillas simples en el archivo de entorno.
No usar las credenciales de `.env.vps.test`, que son exclusivamente locales.

```sh
docker compose --env-file .env.vps -f compose.vps.yml config --quiet
docker compose --env-file .env.vps -f compose.vps.yml up -d --build --wait --wait-timeout 240
docker compose --env-file .env.vps -f compose.vps.yml exec -T api php bin/console.php admin:seed
docker compose --env-file .env.vps -f compose.vps.yml exec -T api php bin/console.php check
curl --fail https://trabajos.rctveracruz.org/api/lab/config
curl --fail https://trabajos.rctveracruz.org/health
```

Usar el dominio configurado en los dos `curl`. MySQL inicializa las tablas solamente
cuando el volumen está vacío. El chequeo interno comprueba FPM, tablas y escritura
privada; `/health` comprueba además ONLYOFFICE y responde 503 si ese proveedor falla.
Compose marca un servicio enfermo, pero no lo reinicia automáticamente por ese estado;
conectar un monitor externo a `/health` para alertas. `restart: unless-stopped` cubre
terminación del proceso y reinicio del host.

El administrador se crea/actualiza con `ADMIN_EMAIL` y `ADMIN_PASSWORD`; el login
actual también sincroniza estas credenciales. Rotarlas en `.env.vps` y recrear la API.

ONLYOFFICE debe alcanzar por HTTPS las rutas de archivo firmado y callback. Probar
crear, editar, guardar, recuperar y descargar un documento desde el dominio real
antes del corte. No se incluye un Document Server local en producción.

## Actualización y respaldo

```sh
sh deploy/backup.sh
docker compose --env-file .env.vps -f compose.vps.yml build --pull
docker compose --env-file .env.vps -f compose.vps.yml up -d --wait --wait-timeout 240
docker compose --env-file .env.vps -f compose.vps.yml logs --tail 100 api web
```

El respaldo detiene web/API, espera las peticiones y guarda SQL y archivos en el
mismo intervalo sin escrituras. Reinicia ambos mediante un trap incluso si falla.
Coordinar la ventana cuando no haya documentos abiertos en ONLYOFFICE: sus callbacks
no estarán disponibles durante ella. No ejecutar despliegues y respaldos simultáneos.
Solo carpetas sin sufijo `.partial` son respaldos completos. Copiarlas a otro equipo
y respaldar `.env.vps` por separado en almacenamiento cifrado. No se borra ningún respaldo
automáticamente. Programar `sh deploy/backup.sh` con cron durante una ventana acordada.

## Migración y restauración

Ensayar primero en un VPS o proyecto Compose nuevo. Importar un dump solo de las tablas
`trabajos_*` y todos los documentos del almacenamiento privado; no importar tablas del
portal histórico. Para migrar desde Node, verificar su compatibilidad con el esquema
PHP antes del corte; este despliegue no transforma datos de ese backend.

Para restaurar, usar una **instalación nueva con volúmenes vacíos** y la misma configuración
de secretos. No ejecutar esta secuencia sobre una instalación con datos que se deban conservar:

```sh
docker compose --env-file .env.vps -f compose.vps.yml up -d --wait db
# Sustituir RESPALDO por la carpeta elegida y verificar sus checksums.
(cd RESPALDO && sha256sum -c SHA256SUMS)
docker compose --env-file .env.vps -f compose.vps.yml exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"' < RESPALDO/database.sql
docker compose --env-file .env.vps -f compose.vps.yml run --rm --no-deps -T --entrypoint tar api xzf - -C /srv/private < RESPALDO/private-storage.tar.gz
docker compose --env-file .env.vps -f compose.vps.yml up -d --wait --wait-timeout 240
```

Validar conteos de artículos, inicio de sesión, recuperación y descarga de documentos.
Conservar servidor y respaldo anteriores hasta terminar la aceptación. Para volver al
código anterior, desplegar sus imágenes/código sobre un esquema compatible; si hubo
cambios incompatibles de datos, restaurar conjuntamente SQL y archivos en otro entorno.
Nunca usar `docker compose down -v` para actualizar: elimina los volúmenes.

## Pruebas

Los resultados y límites de la verificación realizada están en [VALIDATION.md](VALIDATION.md).

```sh
docker compose --env-file .env.vps -f compose.vps.yml exec -T api php tests/unit.php
```

`deploy/tests/smoke.mjs` prueba el gateway, creación/autoguardado, recuperación y
administración en un entorno de prueba aislado; crea datos. Requiere `VPS_TEST_URL`,
`VPS_TEST_ADMIN_EMAIL` y `VPS_TEST_ADMIN_PASSWORD`. La integración completa existente
`api/tests/integration.mjs` requiere un proveedor ONLYOFFICE real y accesible.

Referencias: [Caddy y FastCGI](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Compose en producción](https://docs.docker.com/compose/how-tos/production/).
