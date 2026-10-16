# Trabajos RCT Veracruz — VPS

React conserva la interfaz existente. Node.js es la única API oficial. PostgreSQL conserva metadata, accesos e historial; MinIO almacena DOCX e imágenes privados. ONLYOFFICE Document Server genera las vistas y permite la edición administrativa de emergencia. PHP queda como referencia en `legacy/php-api`.

## Arranque local

Requisitos: Docker y Compose v2 con soporte de `!override`; Node 22 o superior para generar configuración. El primer build compila la versión fijada de MinIO desde su código oficial y requiere varios minutos y recursos adicionales.

```sh
node scripts/init-env.mjs
docker compose up -d --build
docker compose ps
```

El generador conserva un `.env` existente. Los secretos son aleatorios y no se imprimen. Las credenciales iniciales de administración están en `ADMIN_EMAIL` y `ADMIN_PASSWORD`. El administrador se crea solamente si no existe; reiniciar no cambia contraseñas ni reactiva cuentas existentes.

Cada trabajo nuevo recibe una sola **Clave Proyecto** con formato `RCT-XXXX-XX`. Evita caracteres parecidos y se puede escribir con mayúsculas o minúsculas. Quien conozca la clave puede abrir y editar el trabajo, así que conviene compartirla solo con las personas autorizadas. Ya no se genera QR ni un código de recuperación aparte. Los códigos de recuperación y enlaces QR de trabajos anteriores siguen funcionando. Ambas vistas administrativas muestran los trabajos con clave y los anteriores sin clave.

- Aplicación: http://localhost:3200
- Desde otro equipo de la red local: `http://<IP-del-equipo>:3200` (la IP de Windows puede cambiar).
- Administración separada: http://localhost:3200/admin (sin enlace público).
- Panel de administración con consulta, creación, edición de datos y eliminación de trabajos: http://localhost:3200/admin/vista (requiere iniciar sesión).
- Ambas vistas administrativas muestran diez trabajos por página y permiten filtrar por estado. Un documento generado permanece en borrador hasta finalizarlo.
- ONLYOFFICE: http://localhost:8081
- Estado: http://localhost:3200/health

Solo Nginx publica los puertos 3200 y 8081 en todas las interfaces del equipo; el firewall y la red local determinan qué otros dispositivos pueden conectarse. Los seis servicios se comunican por la red interna. Los volúmenes conservan datos al recrear contenedores. No usar `down -v` si se necesitan conservar.

## Metadata y cuerpo

La vista final sigue `assets/img/Ejemplo_documento.docx`: título centrado en mayúsculas y negrita (Arial 14), autores con superíndices de institución, instituciones compartidas sin duplicarlas, correspondencia y palabras clave. El cuerpo y los encabezados de sección usan Arial 10. La sección opcional Objetivos aparece entre Introducción y Materiales y métodos cuando tiene contenido. En cada sección se pueden añadir figuras, cuadros y fórmulas.

`backend/src/presentation.js` compone la vista de solo lectura y la descarga administrativa con los datos actuales de PostgreSQL. El DOCX de emergencia y las versiones almacenadas conservan únicamente el cuerpo y el fondo institucional. Restaurar el cuerpo no restaura metadata histórica. Los cambios en título/autores/keywords actualizan la clave de la vista; el recuento de páginas y la finalización comprueban el documento completo, incluidos los datos iniciales.

El documento utiliza el fondo original de `assets/img/plantilla.docx`, incluido en `backend/templates`: tamaño carta, logotipo, encabezado y franjas en las posiciones originales. En trabajos anteriores, **Generar documento** aplica el fondo al cuerpo conservado, recalcula las páginas y crea una versión. Las versiones históricas no se modifican.

`backend/src` centraliza la lógica de negocio. `backend/database/001-initial.sql` contiene las tablas PostgreSQL `trabajos_`, inicializadas bajo bloqueo transaccional. Se conservan los modelos de autores, imágenes, bloques, sesiones, credenciales, versiones, accesos y auditoría.

Título (20 palabras / 130 caracteres), autores y orden, institución, correo, ORCID y keywords (máximo 7) pertenecen a PostgreSQL. En las tablas, las letras minúsculas al final de valores con error estándar, como `9.64ef`, se convierten automáticamente en superíndice. El DOCX editable contiene únicamente el cuerpo. El constructor conserva los bloques existentes y aplica el formato predefinido. El conteo estructurado excluye captions/celdas y ONLYOFFICE comprueba que el documento tenga de tres a cinco páginas para finalizarlo. Los saltos de línea sobrantes al final de cada campo de texto se omiten al generar el DOCX. La regla general de 250 palabras se conserva desactivada mediante `wordCountRules.enforceMaxWords` en `backend/src/config.js`. Después de edición libre, el conteo extraído se identifica como aproximado e incluye captions y celdas.

Guardar solo metadata conserva el cuerpo generado. Generar sin cambiar bloques conserva la edición de ONLYOFFICE. Cambiar los bloques y generar crea una nueva versión. Restaurar recupera el cuerpo sin alterar título, autores ni keywords.

La abstracción `backend/src/storage.js` usa S3/MinIO. Objetos privados: `articles/{id}/body-current.docx`, `articles/{id}/versions/vN.docx`, `articles/{id}/assets/`. Para S3 externo, configurar `STORAGE_ENDPOINT` (URL completa), `STORAGE_REGION`, `STORAGE_FORCE_PATH_STYLE=false`, bucket y claves en el backend. La lógica de negocio no cambia.

El navegador usa `ONLYOFFICE_PUBLIC_URL`; los contenedores usan `ONLYOFFICE_INTERNAL_URL` y `ONLYOFFICE_CALLBACK_BASE_URL`. JWT autentica configuración, conversión y callbacks. El guardado valida key, estado, URL firmada y permiso administrativo vigente. Las descargas exigen sesión o URL firmada y restringen orígenes, incluso tras redirecciones. `ACCESO DE EMERGENCIA` requiere motivo, dura 30 minutos y se audita.

## Vista temporal por Internet (Windows)

Para compartir la aplicación completa durante una prueba se necesitan dos túneles HTTPS: uno para la aplicación y otro para ONLYOFFICE. Inicie Docker Desktop y ejecute `docker compose up -d --build` si los servicios aún no están activos. Instale `cloudflared` desde la [guía oficial](https://developers.cloudflare.com/tunnel/downloads/).

En dos ventanas de PowerShell distintas, dentro de esta carpeta, ejecute respectivamente:

```powershell
cloudflared tunnel --url http://127.0.0.1:3200
cloudflared tunnel --url http://127.0.0.1:8081
```

Copie la dirección `https://...trycloudflare.com` de cada ventana. En una tercera ventana, configure ambas y aplique el override de vista temporal:

```powershell
$env:PREVIEW_APP_URL='https://DIRECCION-APLICACION.trycloudflare.com'
$env:PREVIEW_DOCS_URL='https://DIRECCION-DOCUMENTOS.trycloudflare.com'
docker compose -f docker-compose.yml -f compose.preview.yml up -d
```

Comparta solamente `PREVIEW_APP_URL`. Verifique `PREVIEW_APP_URL/health` y `PREVIEW_DOCS_URL/healthcheck`. Las URLs cambian cuando se reinicia cualquiera de los túneles; en ese caso, actualice las dos variables y vuelva a ejecutar Compose. Mantenga abiertas las ventanas de los túneles, Docker Desktop y el equipo durante la prueba. Para dejar de compartir, cierre ambos túneles con `Ctrl+C`. El override `compose.preview.yml` limita los puertos publicados por Docker a `127.0.0.1`, usa cookies Secure y permite al navegador cargar ONLYOFFICE desde su URL HTTPS temporal.

Si se desea limitar el acceso por correo, `cloudflared tunnel --url http://127.0.0.1:3200 --allowed-mail persona@ejemplo.com` protege la aplicación. Se puede repetir `--allowed-mail` para cada participante. El túnel de ONLYOFFICE requiere acceso desde el navegador para cargar el editor; pruebe el flujo completo antes de protegerlo por separado. Los túneles temporales están pensados para pruebas y no garantizan disponibilidad continua.

## VPS con HTTPS

1. Apuntar `trabajos.rctveracruz.org` y `docs.rctveracruz.org` al VPS. Permitir entrada a 80/443 y restringir SSH.
2. Generar `.env` de producción. Al trasladar datos anteriores conservar `RECOVERY_PEPPER` y seguir [la guía de migración](legacy/README.md) antes del primer arranque del backend.
3. Instalar certificados válidos en `deploy/certs/trabajos/{fullchain.pem,privkey.pem}` y `deploy/certs/docs/{fullchain.pem,privkey.pem}`. Son privados y están excluidos de Git. Configurar renovación ACME automática y recargar Nginx tras renovar. Webroot disponible: `deploy/acme`. Obtener los certificados iniciales antes de arrancar HTTPS, mediante DNS o el cliente ACME temporalmente en el puerto 80.
4. Ejecutar:

```sh
docker compose -f docker-compose.yml -f compose.production.yml up -d --build
```

El override publica únicamente 80/443 de Nginx, fuerza URLs HTTPS y cookies Secure. Nginx redirige HTTP, transmite encabezados y WebSocket a ONLYOFFICE. Requiere certificados reales; no se sustituyen por certificados de prueba.

## Pruebas

```sh
npm ci --prefix backend
npm test --prefix backend
docker compose exec -e LAB_API_URL=http://backend:4000 backend npm run test:integration
docker compose exec -e LAB_API_URL=http://backend:4000 backend npm run test:callback
node backend/tests/presentation-integration.mjs
npm ci --prefix frontend
npm run build --prefix frontend
node --env-file=.env frontend/tests/editor-smoke.mjs
node --env-file=.env frontend/tests/admin-smoke.mjs
node --env-file=.env backend/tests/admin-crud-integration.mjs
node --env-file=.env frontend/tests/admin-dashboard-smoke.mjs
node --env-file=.env frontend/tests/emergency-smoke.mjs
```

Los smoke tests requieren Chrome instalado (`LAB_CHROME_PATH` permite cambiar su ruta). Las pruebas crean registros: ejecutarlas en una instalación local dedicada. Cubren sesiones, acceso mediante Clave Proyecto, metadata, DOCX, conversión, versiones, restauración, emergencia y auditoría. El limitador reside en memoria del único backend; antes de escalar a varias réplicas hay que compartir su estado.

Respaldar PostgreSQL y MinIO juntos, con escrituras detenidas, y guardar `.env` por separado de forma segura. Sin los objetos o `RECOVERY_PEPPER` no se puede recuperar íntegramente el sistema. Verificar la restauración en un entorno separado antes del cambio de DNS.
