<?php
declare(strict_types=1);

use Trabajos\Lib\ApiException;
use Trabajos\Lib\ArticleService;
use Trabajos\Lib\Request;
use Trabajos\Lib\Response;
use Trabajos\Lib\Router;
use Trabajos\Lib\Security;

return static function (Router $router, array $s): void {
    $router->add('GET', '/api/lab/admin/articles', static function (Request $request) use ($s): void {
        $s['auth']->requireAdmin($request);
        Response::json($s['admin']->search(trim((string) ($request->query['q'] ?? '')), trim((string) ($request->query['date'] ?? ''))));
    });

    $router->add('GET', '/api/lab/admin/articles/{articleId}', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); Response::json($s['admin']->detail($request->params['articleId'], $request, $admin));
    });

    $router->add('GET', '/api/lab/admin/articles/{articleId}/download', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); $article = $s['articles']->get($request->params['articleId']); $buffer = $s['storage']->getDocx($article['documentStoragePath']);
        $s['admin']->audit($request, $admin, 'DOWNLOAD_DOCUMENT', $article['id'], null, ['bytes' => strlen($buffer)]);
        Response::binary($buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'attachment; filename="' . ArticleService::safeFilename($article['title']) . '"');
    });

    $router->add('GET', '/api/lab/admin/articles/{articleId}/versions/{version}/download', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); $article = $s['articles']->get($request->params['articleId']); $version = filter_var($request->params['version'], FILTER_VALIDATE_INT);
        if ($version === false || $version < 1) throw new ApiException('Versión no válida.', 400);
        $row = $s['db']->one('SELECT storage_path FROM trabajos_document_versions WHERE article_id = ? AND version = ?', [$article['id'], $version]);
        if (!$row) throw new ApiException('Versión no encontrada.', 404);
        $buffer = $s['storage']->getDocx($row['storage_path']); $s['admin']->audit($request, $admin, 'VIEW_VERSION', $article['id'], null, ['version' => $version, 'bytes' => strlen($buffer)]);
        Response::binary($buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'attachment; filename="' . $article['publicReference'] . '-v' . $version . '.docx"');
    });

    $router->add('POST', '/api/lab/admin/articles/{articleId}/recovery', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); $article = $s['articles']->get($request->params['articleId']); $recovery = $s['recovery']->bundle($article['id'], true);
        $s['admin']->audit($request, $admin, 'GENERATE_RECOVERY', $article['id'], mb_substr((string) ($request->body['reason'] ?? ''), 0, 1000) ?: null);
        Response::json(['publicReference' => $article['publicReference'], 'recovery' => $recovery]);
    });

    $router->add('POST', '/api/lab/admin/articles/{articleId}/temporary-access', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); $article = $s['articles']->get($request->params['articleId']);
        $hours = min(168, max(1, (int) ($request->body['hours'] ?? $s['config']->temporaryAccessHours))); $maxUses = min(20, max(1, (int) ($request->body['maxUses'] ?? 1)));
        $code = Security::temporaryCode(); $expiresAt = gmdate('Y-m-d H:i:s.v', time() + $hours * 3600);
        $s['db']->transaction(static function ($db) use ($s, $article, $code, $expiresAt, $maxUses): void { $s['recovery']->store($db, $article['id'], 'TEMPORARY_CODE', $code, $expiresAt, $maxUses); });
        $s['admin']->audit($request, $admin, 'GENERATE_TEMP_ACCESS', $article['id'], mb_substr((string) ($request->body['reason'] ?? ''), 0, 1000) ?: null, compact('hours', 'maxUses'));
        Response::json(['code' => $code, 'expiresAt' => $expiresAt, 'maxUses' => $maxUses]);
    });

    $router->add('POST', '/api/lab/admin/articles/{articleId}/revoke-sessions', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); $s['articles']->get($request->params['articleId']);
        $count = $s['db']->execute('UPDATE trabajos_article_sessions SET revoked_at = NOW() WHERE article_id = ? AND revoked_at IS NULL', [$request->params['articleId']]);
        $s['admin']->audit($request, $admin, 'REVOKE_SESSIONS', $request->params['articleId'], mb_substr((string) ($request->body['reason'] ?? ''), 0, 1000) ?: null, ['revokedCount' => $count]);
        Response::json(['revokedCount' => $count]);
    });

    $router->add('POST', '/api/lab/admin/articles/{articleId}/emergency-access', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); $reason = trim((string) ($request->body['reason'] ?? ''));
        if (mb_strlen($reason) < 10) throw new ApiException('El motivo obligatorio debe tener al menos 10 caracteres.', 422);
        $article = $s['articles']->get($request->params['articleId']); if (!$article['generatedAt']) throw new ApiException('El documento todavía no se ha generado.', 409);
        $expiresAt = gmdate('Y-m-d H:i:s.v', time() + 1800);
        $s['db']->execute('INSERT INTO trabajos_admin_document_grants (id, admin_session_id, article_id, reason, expires_at) VALUES (?, ?, ?, ?, ?)', [Security::uuid(), $admin['session_id'], $article['id'], $reason, $expiresAt]);
        $s['admin']->audit($request, $admin, 'EMERGENCY_ACCESS', $article['id'], $reason, ['expiresAt' => $expiresAt]);
        Response::json($s['onlyoffice']->editorConfig($article, ['id' => 'admin-' . $admin['id'], 'name' => $admin['name']], true));
    });

    $router->add('GET', '/api/lab/admin/articles/{articleId}/editor-config', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); $article = $s['articles']->get($request->params['articleId']);
        $s['admin']->audit($request, $admin, 'OPEN_DOCUMENT', $article['id'], null, ['mode' => 'view']);
        Response::json($s['onlyoffice']->editorConfig($article, ['id' => 'admin-' . $admin['id'], 'name' => $admin['name']], false));
    });

    $router->add('POST', '/api/lab/admin/articles/{articleId}/versions/{version}/restore', static function (Request $request) use ($s): void {
        $admin = $s['auth']->requireAdmin($request); $version = filter_var($request->params['version'], FILTER_VALIDATE_INT);
        if ($version === false) throw new ApiException('Versión no válida.', 400);
        Response::json($s['admin']->restore($request->params['articleId'], (int) $version, (string) ($request->body['reason'] ?? ''), $request, $admin));
    });

    $router->add('GET', '/api/lab/admin/audit', static function (Request $request) use ($s): void {
        $s['auth']->requireAdmin($request); Response::json($s['admin']->auditRows());
    });
};
