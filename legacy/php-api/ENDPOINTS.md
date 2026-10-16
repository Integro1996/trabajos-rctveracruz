# Paridad de rutas Node → PHP

| Método y ruta actual | PHP |
|---|---|
| `GET /health` | `articles/routes.php` |
| `GET /api/lab/config` | `articles/routes.php` |
| `GET/POST /api/lab/articles` | `articles/routes.php` |
| `GET/PATCH/DELETE /api/lab/articles/{articleId}` | `articles/routes.php` |
| `POST /api/lab/articles/{articleId}/assets` | `articles/routes.php` |
| `GET /api/lab/articles/{articleId}/assets/{assetId}` | `articles/routes.php` |
| `POST /api/lab/articles/{articleId}/generate` | `articles/routes.php` |
| `POST /api/lab/articles/{articleId}/finalize` | `articles/routes.php` |
| `POST /api/lab/articles/{articleId}/duplicate` | `articles/routes.php` |
| `GET /api/lab/articles/{articleId}/editor-config` | `articles/routes.php` |
| `POST /api/lab/recover/code` | `recovery/routes.php` |
| `GET /recover/{token}` | `recovery/routes.php` |
| `POST /api/lab/admin/login` | `sessions/routes.php` |
| `GET /api/lab/admin/session` | `sessions/routes.php` |
| `POST /api/lab/admin/logout` | `sessions/routes.php` |
| `GET /api/lab/admin/articles` | `admin/routes.php` |
| `GET /api/lab/admin/articles/{articleId}` | `admin/routes.php` |
| `GET /api/lab/admin/articles/{articleId}/download` | `admin/routes.php` |
| `GET /api/lab/admin/articles/{articleId}/versions/{version}/download` | `admin/routes.php` |
| `POST /api/lab/admin/articles/{articleId}/recovery` | `admin/routes.php` |
| `POST /api/lab/admin/articles/{articleId}/temporary-access` | `admin/routes.php` |
| `POST /api/lab/admin/articles/{articleId}/revoke-sessions` | `admin/routes.php` |
| `POST /api/lab/admin/articles/{articleId}/emergency-access` | `admin/routes.php` |
| `GET /api/lab/admin/articles/{articleId}/editor-config` | `admin/routes.php` |
| `POST /api/lab/admin/articles/{articleId}/versions/{version}/restore` | `admin/routes.php` |
| `GET /api/lab/admin/audit` | `admin/routes.php` |
| `GET /api/documents/{articleId}/file` y alias histórico | `onlyoffice/routes.php` |
| `POST /api/onlyoffice/callback/{articleId}` y alias histórico | `onlyoffice/routes.php` |

React conserva las URLs existentes; en producción Apache dirige `/api/*` y `/recover/*` al front controller PHP.
