# Verificación local — 22 de septiembre de 2026

Se probó el proyecto Compose aislado `trabajos-vps-test`, con base y volúmenes nuevos.

- Build de las imágenes web/API: correcto. React se compiló dentro de Docker.
- Composer: instalación desde lock y todos los requisitos de plataforma correctos en PHP 8.3.33.
- Caddy: configuración HTTP de prueba y configuración HTTPS de producción válidas.
- Arranque: MySQL 8.4 y PHP-FPM saludables; comprobación de tablas y almacenamiento correcta.
- Unitarias PHP: 17 aserciones aprobadas, incluyendo scrypt legado, clave incorrecta y parámetros inválidos.
- Prueba HTTP `deploy/tests/smoke.mjs`: SPA, rutas privadas, API, CSRF, creación, guardado,
  recuperación por código, QR, administrador y cierre de sesión aprobados.
- `admin:seed`: ejecución correcta.
- `deploy/backup.sh`: SQL y archivo comprimido creados; web/API reiniciados correctamente.
- Restauración: checksums correctos, SQL importado en otra base de prueba y DOCX restaurados
  en otro volumen. Se recuperó el artículo creado por la prueba.

No se desplegó en un VPS remoto ni se emitió un certificado público. El ensayo usó un
dominio ficticio de ONLYOFFICE: generación/conversión remota, edición interactiva y callback
del proveedor quedan pendientes de una prueba con sus credenciales y un dominio HTTPS accesible.
La prueba de restauración no implica que se hayan migrado datos del sistema existente.
