# Implementación histórica

`php-api/` conserva la API PHP. `deploy-php/` y `compose.php.yml` documentan el despliegue anterior; no forman parte del arranque actual y sus rutas son históricas.

La aplicación oficial usa exclusivamente `../backend` (Node), PostgreSQL y MinIO. No implementar funcionalidades nuevas aquí. Los respaldos y volúmenes anteriores se conservan; no ejecutar `docker compose down -v` al migrar.

## Traslado desde MySQL / archivos privados

Detener escrituras en el origen y respaldarlo antes de exportar. Instalar únicamente la herramienta de migración: `npm ci --prefix legacy/migration`. Configurar `SOURCE_DB_HOST`, `SOURCE_DB_PORT`, `SOURCE_DB_USER`, `SOURCE_DB_PASSWORD`, `SOURCE_DB_NAME`, `SOURCE_STORAGE_PATH` y `EXPORT_PATH` (directorio privado nuevo). Ejecutar `node legacy/migration/export.mjs`. El origen se lee en una transacción consistente y no se modifica.

Conservar el mismo `RECOVERY_PEPPER` al migrar para que sigan funcionando los códigos y sesiones existentes. El exportado contiene hashes y datos privados; no publicarlo ni incorporarlo a Git.

Importar **antes del primer arranque del backend**, sobre PostgreSQL y el bucket vacíos. Con PostgreSQL y MinIO activos, ejecutar un contenedor backend sin sus dependencias, montar el exportado en `/migration:ro` y lanzar `node scripts/import-legacy.mjs /migration`. Por ejemplo:

```sh
docker compose up -d postgres minio
docker compose run --rm --no-deps --user 0:0 -v /ruta/privada/exportado:/migration:ro backend node scripts/import-legacy.mjs /migration
docker compose up -d
```

El importador valida tablas/columnas y checksums, carga los objetos privados y después confirma la transacción de PostgreSQL. No sobrescribe una base con registros; ante un fallo conserva el origen y permite reintentar. Comprobar acceso por código, archivos, versiones y auditoría antes de cambiar DNS. Mantener el respaldo hasta validar el traslado.
