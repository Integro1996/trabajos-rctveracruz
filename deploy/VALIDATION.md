# Validación local — 23 septiembre 2026

Entorno real: Docker Desktop, React compilado, Node 22.22.0, PostgreSQL 17.7, MinIO compilado desde `RELEASE.2025-10-15T17-29-55Z`, ONLYOFFICE 9.3.1 y Nginx 1.28.2.

- 20 pruebas unitarias aprobadas, incluida separación de metadata/DOCX y compatibilidad de hashes PHP.
- Integración API aprobada: creación, QR/código, recuperación entre dispositivos, sesiones y aislamiento, autosave, metadata, imágenes/tablas, conversión real DOCX/PDF, límite de páginas, finalización, duplicación, administrador, búsquedas, descargas, acceso temporal de un uso, emergencia, versiones, restauración, revocación, auditoría y rate limiting.
- Metadata sin cambios de cuerpo conserva documento y revisión; el DOCX editable no contiene título, autores ni keywords como fuente de verdad. La descarga final los compone desde PostgreSQL.
- Callback con conversión real aprobado; callback con URL alterada rechazado. Guardado y nueva versión confirmados en PostgreSQL/MinIO.
- Chrome: creación, autosave, imagen, tabla y vista ONLYOFFICE embebida sin errores de consola; administración y vista de documento aprobadas.
- Chrome: edición por teclado usando ACCESO DE EMERGENCIA, cierre del editor, recepción automática del callback y descarga del DOCX con el texto escrito aprobados.
- Migración: exportación de una copia del volumen MySQL anterior e importación de 14 tablas y 2 objetos en una base/bucket separados. Origen preservado.
- Configuración Compose local y producción validada. Nginx local y TLS pasan `nginx -t`; para comprobar sintaxis TLS se usó un certificado temporal aislado, que no se instaló en producción.

Los servicios locales quedan en http://localhost:3200 y http://localhost:8081. La instalación tiene registros de prueba. El VPS, DNS, certificados públicos, renovación y copias programadas aún requieren configuración en el servidor real.

## Fondo de la plantilla institucional

Se integró `assets/img/plantilla.docx` con sus recursos originales, tamaño carta y márgenes. Pasan 21 pruebas unitarias, integración API y callback. Chrome confirmó el evento de documento listo sin errores; se revisó visualmente el encabezado y su separación del cuerpo. La prueba de aplicación sobre un DOCX previo conserva su texto y no duplica el fondo al reaplicarlo.

## Estructura de Ejemplo_documento.docx

Prueba de edición real en Chrome desde `127.0.0.1:3200` aprobada: escritura, callback, nueva versión y descarga con el texto guardado. Se corrigió la equivalencia entre direcciones loopback de ONLYOFFICE; solo se admite cuando la URL pública configurada también es loopback y coincide el protocolo y puerto, y la descarga se dirige al servicio interno.

23 pruebas unitarias aprobadas. Integración API aprobada con título/autores/keywords en la presentación y sin metadata en el cuerpo editable. Chrome confirmó la vista lista con el título centrado y los autores; se inspeccionó la captura. Callback y versionado aprobados.

`node backend/tests/presentation-integration.mjs` comprobó 4 páginas al incluir muchos autores/instituciones y rechazo de finalización; después de modificar solamente la metadata, el mismo cuerpo ocupó 1 página y pudo finalizarse. La prueba limpia su propio trabajo al terminar.
