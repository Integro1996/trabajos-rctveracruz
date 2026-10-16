<?php
declare(strict_types=1);

use Trabajos\Lib\ApiException;
use Trabajos\Lib\ArticleService;
use Trabajos\Lib\Docx;
use Trabajos\Lib\Request;
use Trabajos\Lib\Response;
use Trabajos\Lib\Router;
use Trabajos\Lib\Security;
use Trabajos\Lib\Validation;

return static function (Router $router, array $s): void {
    $serveDocument = static function (Request $request) use ($s): void {
        ArticleService::assertUuid($request->params['articleId']);
        try { $payload = Security::jwtDecode((string) ($request->query['token'] ?? ''), $s['config']->documentTokenSecret); }
        catch (Throwable) { throw new ApiException('Token de descarga inválido o vencido.', 401); }
        $purpose = (string) ($payload['purpose'] ?? '');
        if (!in_array($purpose, ['document-download', 'generation-source'], true) || !hash_equals((string) ($payload['articleId'] ?? ''), $request->params['articleId'])) throw new ApiException('El token no autoriza este documento.', 403);
        $article = $s['articles']->get($request->params['articleId']); $path = $article['documentStoragePath'];
        if ($purpose === 'document-download') {
            if (!hash_equals($article['documentKey'], (string) ($payload['documentKey'] ?? ''))) throw new ApiException('La versión solicitada ya no está vigente.', 409);
        } else {
            $candidate = (string) ($payload['storagePath'] ?? ''); $prefix = 'articles/' . $article['id'] . '/';
            if (strlen((string) ($payload['documentKey'] ?? '')) < 10 || !str_starts_with($candidate, $prefix) || !str_ends_with($candidate, '.docx') || str_contains($candidate, '..')) throw new ApiException('La generación solicitada no es válida.', 403);
            $path = $candidate;
        }
        Response::binary($s['storage']->getDocx($path), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'inline; filename="' . ArticleService::safeFilename($article['title']) . '"');
    };
    $router->add('GET', '/api/documents/{articleId}/file', $serveDocument);
    $router->add('GET', '/api/lab/onlyoffice/document/{articleId}', $serveDocument);

    $callback = static function (Request $request) use ($s): void {
        $articleId = $request->params['articleId']; $status = (int) ($request->body['status'] ?? -1); $key = (string) ($request->body['key'] ?? '');
        $record = static function (string $result, string $detail) use ($s, $articleId, $status, $key): void {
            try { $s['db']->execute('INSERT INTO trabajos_callbacks (article_id, onlyoffice_status, document_key, result, detail) VALUES (?, ?, ?, ?, ?)', [$articleId, $status >= 0 ? $status : null, mb_substr($key, 0, 128) ?: null, $result, mb_substr($detail, 0, 1500)]); } catch (Throwable) {}
        };
        try {
            ArticleService::assertUuid($articleId); $s['onlyoffice']->verifyCallback($request); $article = $s['articles']->get($articleId);
            if (!hash_equals($article['documentKey'], $key)) throw new ApiException('El callback corresponde a un document key que ya no está vigente.', 409);
            if (in_array($status, [2, 6], true)) {
                $buffer = $s['onlyoffice']->downloadUpdated((string) ($request->body['url'] ?? ''));
                $temporary = "articles/{$articleId}/incoming/" . Security::uuid() . '.docx'; $s['storage']->putDocx($temporary, $buffer);
                try {
                    $pages = $s['onlyoffice']->countPages($article, $temporary, 'callback-' . Security::uuid());
                    $words = Validation::countWords(Docx::extractText($buffer));
                    $s['db']->transaction(function ($db) use ($s, $articleId, $key, $buffer, $pages, $words): void {
                        $locked = $db->one('SELECT document_key FROM trabajos_articles WHERE id = ? FOR UPDATE', [$articleId]);
                        if (!$locked || !hash_equals($locked['document_key'], $key)) throw new ApiException('El documento cambió durante el guardado.', 409);
                        $version = (int) ($db->one('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM trabajos_document_versions WHERE article_id = ?', [$articleId])['version'] ?? 1);
                        $current = "articles/{$articleId}/body-current.docx"; $versionPath = "articles/{$articleId}/versions/v{$version}.docx";
                        $s['storage']->putDocx($current, $buffer); $s['storage']->putDocx($versionPath, $buffer);
                        $state = $pages > Validation::MAX_PAGES || $words > Validation::MAX_WORDS ? 'requires_changes' : 'draft';
                        $db->execute('UPDATE trabajos_articles SET document_storage_path = ?, body_word_count = ?, body_count_note = ?, page_count = ?, last_document_saved_at = NOW(), updated_at = NOW(), status = ? WHERE id = ?', [$current, $words, 'Conteo aproximado del DOCX: incluye todo el texto extraíble, también pies y celdas.', $pages, $state, $articleId]);
                        $db->execute('INSERT INTO trabajos_document_versions (id, article_id, version, document_key, storage_path, word_count, content_snapshot, page_count) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)', [Security::uuid(), $articleId, $version, $key, $versionPath, $words, $pages]);
                    });
                } finally { $s['storage']->remove($temporary); }
                $record('saved', 'Documento actualizado y versionado.');
            } else {
                $descriptions = [1 => 'Documento abierto en vista previa.', 3 => 'ONLYOFFICE informó un error.', 4 => 'Documento cerrado sin cambios.', 7 => 'ONLYOFFICE informó un error de guardado.'];
                $record(in_array($status, [3, 7], true) ? 'error' : 'acknowledged', $descriptions[$status] ?? 'Status recibido.');
            }
            Response::json(['error' => 0]);
        } catch (Throwable $error) {
            error_log('[trabajos-onlyoffice-callback] ' . $error->getMessage()); $record('error', $error->getMessage()); Response::json(['error' => 1]);
        }
    };
    $router->add('POST', '/api/onlyoffice/callback/{articleId}', $callback);
    $router->add('POST', '/api/lab/onlyoffice/callback/{articleId}', $callback);
};
