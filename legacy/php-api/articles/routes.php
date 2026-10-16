<?php
declare(strict_types=1);

use Trabajos\Lib\ApiException;
use Trabajos\Lib\ArticleService;
use Trabajos\Lib\Request;
use Trabajos\Lib\Response;
use Trabajos\Lib\Router;
use Trabajos\Lib\Security;
use Trabajos\Lib\Validation;

return static function (Router $router, array $s): void {
    $router->add('GET', '/health', static function (Request $request) use ($s): void {
        $database = $storage = false;
        try { $s['db']->one('SELECT 1'); $database = true; } catch (Throwable) {}
        try { $storage = $s['storage']->healthy(); } catch (Throwable) {}
        $onlyoffice = $s['onlyoffice']->healthy();
        $ok = $database && $storage && $onlyoffice;
        Response::json(['status' => $ok ? 'ok' : 'degraded', 'backend' => 'connected', 'mysql' => $database ? 'connected' : 'error', 'storage' => $storage ? 'connected' : 'error', 'onlyoffice' => $onlyoffice ? 'connected' : 'error', 'jwtConfigured' => true, 'timestamp' => gmdate(DATE_ATOM)], $ok ? 200 : 503);
    });

    $router->add('GET', '/api/lab/config', static function (Request $request) use ($s): void {
        Response::json(['limits' => ['titleWords' => 12, 'titleCharacters' => 50, 'keywords' => 7, 'authorsMin' => 1, 'maxPages' => 3, 'maxBlocks' => 100, 'maxImageBytes' => Validation::MAX_IMAGE_BYTES, 'maxTableRows' => 50, 'maxTableColumns' => 10], 'wordCountRules' => ['maxWords' => 250, 'maxPages' => 3, 'countParagraphs' => true, 'countHeadings' => true, 'countImageCaptions' => false, 'countTableCaptions' => false, 'countTableCells' => false], 'onlyofficePublicUrl' => $s['config']->onlyofficePublicUrl]);
    });

    $router->add('GET', '/api/lab/articles', static function (Request $request) use ($s): void {
        $session = $s['auth']->currentArticle($request);
        Response::json($session ? $s['articles']->listRecent($session['hash']) : []);
    });

    $router->add('POST', '/api/lab/articles', static function (Request $request) use ($s): void {
        $article = $s['articles']->create(['title' => (string) ($request->body['title'] ?? 'Artículo experimental')]);
        try { $recovery = $s['recovery']->bundle($article['id']); $s['auth']->issueArticle($request, $article['id']); }
        catch (Throwable $error) { $s['articles']->delete($article['id']); throw $error; }
        Response::json(['article' => $article, 'recovery' => $recovery], 201);
    });

    $router->add('GET', '/api/lab/articles/{articleId}', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); Response::json($s['articles']->get($request->params['articleId']));
    });

    $router->add('PATCH', '/api/lab/articles/{articleId}', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); Response::json($s['articles']->update($request->params['articleId'], $request->body));
    });

    $router->add('POST', '/api/lab/articles/{articleId}/assets', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); $articleId = $request->params['articleId']; $s['articles']->get($articleId);
        $dataUrl = (string) ($request->body['dataUrl'] ?? '');
        if (!preg_match('#^data:(image/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$#', $dataUrl, $match)) throw new ApiException('Selecciona una imagen PNG o JPEG válida.', 422);
        $buffer = base64_decode($match[2], true);
        if ($buffer === false || strlen($buffer) > Validation::MAX_IMAGE_BYTES) throw new ApiException('La imagen está vacía o supera 8 MB.', 422);
        $dimensions = @getimagesizefromstring($buffer);
        if (!$dimensions || $dimensions[0] < 1 || $dimensions[1] < 1 || $dimensions[0] > 12000 || $dimensions[1] > 12000 || $dimensions[0] * $dimensions[1] > 50000000) throw new ApiException('Las dimensiones de la imagen no son válidas.', 422);
        $id = Security::uuid(); $extension = $match[1] === 'image/png' ? 'png' : 'jpg'; $path = "articles/{$articleId}/assets/{$id}.{$extension}";
        $name = mb_substr(preg_replace('/[\x00-\x1f<>:"\/\\|?*]/u', '_', (string) ($request->body['fileName'] ?? 'imagen')) ?: 'imagen', 0, 255);
        $s['storage']->putAsset($path, $buffer, $match[1]);
        try { $s['db']->execute('INSERT INTO trabajos_article_assets (id, article_id, storage_path, mime_type, original_name, width, height, byte_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$id, $articleId, $path, $match[1], $name, $dimensions[0], $dimensions[1], strlen($buffer)]); }
        catch (Throwable $error) { $s['storage']->remove($path); throw $error; }
        Response::json(['id' => $id, 'url' => "/api/lab/articles/{$articleId}/assets/{$id}", 'originalName' => $name, 'mimeType' => $match[1], 'width' => $dimensions[0], 'height' => $dimensions[1], 'byteSize' => strlen($buffer)], 201);
    });

    $router->add('GET', '/api/lab/articles/{articleId}/assets/{assetId}', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); ArticleService::assertUuid($request->params['assetId']);
        $asset = $s['db']->one('SELECT * FROM trabajos_article_assets WHERE id = ? AND article_id = ?', [$request->params['assetId'], $request->params['articleId']]);
        if (!$asset) throw new ApiException('La imagen no existe.', 404);
        header('Cache-Control: private, max-age=300'); Response::binary($s['storage']->getAsset($asset['storage_path']), $asset['mime_type'], 'inline');
    });

    $router->add('POST', '/api/lab/articles/{articleId}/generate', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); Response::json($s['articles']->generate($request->params['articleId'], $s['onlyoffice']));
    });

    $router->add('POST', '/api/lab/articles/{articleId}/finalize', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); Response::json($s['articles']->finalize($request->params['articleId']));
    });

    $router->add('POST', '/api/lab/articles/{articleId}/duplicate', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); $source = $s['articles']->get($request->params['articleId']);
        $titleWords = preg_split('/\s+/u', 'Copia ' . $source['title']) ?: []; $copyTitle = mb_substr(implode(' ', array_slice($titleWords, 0, 12)), 0, 50);
        $copy = $s['articles']->create(['title' => $copyTitle, 'authors' => $source['authors'], 'keywords' => $source['keywords'], 'introduction' => $source['introduction'], 'blocks' => $source['blocks']], $s['articles']->loadAssets($source['id'], $source['blocks']));
        $recovery = $s['recovery']->bundle($copy['id']); $s['auth']->issueArticle($request, $copy['id']);
        Response::json(['article' => $copy, 'recovery' => $recovery], 201);
    });

    $router->add('DELETE', '/api/lab/articles/{articleId}', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); $s['articles']->delete($request->params['articleId']); Response::empty();
    });

    $router->add('GET', '/api/lab/articles/{articleId}/editor-config', static function (Request $request) use ($s): void {
        $s['auth']->requireArticle($request); $article = $s['articles']->get($request->params['articleId']);
        if (!$article['generatedAt']) throw new ApiException('Genera el documento antes de abrir la vista previa.', 409);
        Response::json($s['onlyoffice']->editorConfig($article));
    });
};
