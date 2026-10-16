# Despliegue PHP en Apache/cPanel

## Archivos publicos

- Contenido de `frontend/dist/` en la raiz del subdominio.
- Directorio `api/`, incluido `vendor/`.
- `.htaccess.production` renombrado a `.htaccess`.

No subir `backend/`, `frontend/node_modules/`, `api/tests/`, `api/database/`, archivos `.env` reales ni `api-tests-private-storage/` al directorio publico.

## Archivos privados

Crear fuera de `public_html` un directorio exclusivo para Trabajos. PHP debe poder escribir en el, y su ruta absoluta debe asignarse a `STORAGE_PATH`. No crear enlaces publicos hacia ese directorio.

## Base de datos

Ejecutar una vez `database/schema.sql` en la MySQL elegida. Crea 14 tablas `trabajos_*` y no altera las tablas historicas de RCT.

## Requisitos del hosting

- PHP 8.2 o posterior, 64 bits.
- Extensiones `curl`, `dom`, `fileinfo`, `json`, `mbstring`, `openssl`, `pdo`, `pdo_mysql` y `zip`.
- Apache con `mod_rewrite`; `mod_headers` es recomendable.
- `memory_limit` de al menos 256 MB, `post_max_size` de al menos 16 MB y `max_execution_time` de al menos 120 segundos para conversiones de ONLYOFFICE.
- Acceso HTTPS saliente desde PHP hacia ONLYOFFICE Cloud y acceso HTTPS entrante de Cloud a las rutas de documento y callback.

## Variables

Usar `.env.production.example` como inventario. Las variables deben inyectarse al proceso PHP mediante cPanel, Apache o una configuracion privada; `Config.php` no carga automaticamente un archivo `.env` publico.

`TRUST_PROXY` debe permanecer en `false` salvo que el proveedor confirme que Apache/PHP esta detras de un proxy confiable que sobrescribe `X-Forwarded-For`.

## Composer

Se recomienda subir `api/vendor/` ya generado. Si se reinstala en un entorno de construccion PHP 8.2, la dependencia que verifica una sola vez hashes `scrypt` heredados de Node requiere permitir unicamente su limite superior historico:

```bash
composer install --no-dev --optimize-autoloader --ignore-platform-req=php+
```

Tras el primer uso correcto, esos hashes se reemplazan automaticamente por `password_hash()` nativo de PHP.
