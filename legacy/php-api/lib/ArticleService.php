<?php
declare(strict_types=1);

namespace Trabajos\Lib;

use Throwable;

final class ArticleService
{
    public function __construct(private readonly Database $db, private readonly Storage $storage) {}

    public function get(string $articleId): array
    {
        self::assertUuid($articleId);
        $row = $this->db->one('SELECT a.*, COALESCE((SELECT MAX(v.version) FROM trabajos_document_versions v WHERE v.article_id = a.id), 0) AS version FROM trabajos_articles a WHERE a.id = ?', [$articleId]);
        if (!$row) throw new ApiException('El artículo experimental no existe.', 404);
        $authors = $this->db->all('SELECT id, first_name, last_name, email, institution, orcid, is_corresponding, position FROM trabajos_authors WHERE article_id = ? ORDER BY position', [$articleId]);
        $keywords = $this->db->all('SELECT value FROM trabajos_keywords WHERE article_id = ? ORDER BY position', [$articleId]);
        $callback = $this->db->one('SELECT received_at, onlyoffice_status, result, detail FROM trabajos_callbacks WHERE article_id = ? ORDER BY received_at DESC LIMIT 1', [$articleId]);
        $blocks = $this->blocks($articleId);
        return [
            'id' => $row['id'], 'publicReference' => $row['public_reference'], 'title' => $row['title'],
            'bodyWordCount' => (int) $row['body_word_count'], 'bodyCountNote' => $row['body_count_note'],
            'status' => $row['status'], 'documentKey' => $row['document_key'], 'documentStoragePath' => $row['document_storage_path'],
            'createdAt' => $row['created_at'], 'updatedAt' => $row['updated_at'], 'lastDocumentSavedAt' => $row['last_document_saved_at'],
            'introduction' => $row['introduction'] ?: '', 'pageCount' => $row['page_count'] === null ? null : (int) $row['page_count'],
            'generatedAt' => $row['generated_at'], 'contentRevision' => (int) $row['content_revision'],
            'generatedRevision' => $row['generated_revision'] === null ? null : (int) $row['generated_revision'],
            'authors' => array_map(static fn (array $author): array => [
                'id' => $author['id'], 'firstName' => $author['first_name'], 'lastName' => $author['last_name'],
                'email' => $author['email'], 'institution' => $author['institution'], 'orcid' => $author['orcid'],
                'isCorresponding' => (bool) $author['is_corresponding'], 'position' => (int) $author['position'],
            ], $authors),
            'keywords' => array_column($keywords, 'value'), 'version' => (int) $row['version'],
            'lastCallback' => $callback ? ['receivedAt' => $callback['received_at'], 'status' => $callback['onlyoffice_status'] === null ? null : (int) $callback['onlyoffice_status'], 'result' => $callback['result'], 'detail' => $callback['detail']] : null,
            'blocks' => $blocks,
            'figureCount' => count(array_filter($blocks, static fn (array $block): bool => $block['type'] === 'figure')),
            'tableCount' => count(array_filter($blocks, static fn (array $block): bool => $block['type'] === 'table')),
        ];
    }

    public function blocks(string $articleId): array
    {
        $rows = $this->db->all('SELECT b.*, s.mime_type, s.original_name, s.width, s.height, s.byte_size FROM trabajos_article_blocks b LEFT JOIN trabajos_article_assets s ON s.id = b.asset_id WHERE b.article_id = ? ORDER BY b.position', [$articleId]);
        return array_map(static function (array $row) use ($articleId): array {
            $block = ['id' => $row['id'], 'type' => $row['type']];
            if ($row['type'] === 'text') $block['text'] = $row['text_content'] ?: '';
            if ($row['type'] === 'figure') $block += ['assetId' => $row['asset_id'], 'caption' => $row['caption'] ?: '', 'asset' => ['id' => $row['asset_id'], 'url' => "/api/lab/articles/{$articleId}/assets/{$row['asset_id']}", 'originalName' => $row['original_name'], 'mimeType' => $row['mime_type'], 'width' => (int) $row['width'], 'height' => (int) $row['height'], 'byteSize' => (int) $row['byte_size']]];
            if ($row['type'] === 'table') {
                $cells = is_array($row['table_data']) ? $row['table_data'] : json_decode((string) $row['table_data'], true);
                $block += ['caption' => $row['caption'] ?: '', 'cells' => is_array($cells) ? $cells : [['']]];
            }
            return $block;
        }, $rows);
    }

    public function create(array $overrides = [], array $sourceAssets = []): array
    {
        $defaults = [
            'title' => 'Artículo experimental',
            'authors' => [['firstName' => 'Autor', 'lastName' => 'Principal', 'email' => 'autor@laboratorio.test', 'institution' => 'Institución de prueba', 'orcid' => '', 'isCorresponding' => true]],
            'keywords' => [], 'introduction' => '', 'blocks' => [],
        ];
        $content = Validation::article(array_replace($defaults, $overrides));
        $articleId = Security::uuid();
        $documentKey = 'trabajos-' . Security::uuid();
        $currentPath = "articles/{$articleId}/body-current.docx";
        $assetRows = [];
        foreach ($content['blocks'] as &$block) {
            if ($block['type'] !== 'figure') continue;
            $source = $sourceAssets[$block['assetId']] ?? null;
            if (!$source) throw new ApiException('No se encontró la imagen que se intentó duplicar.', 422);
            $assetId = Security::uuid();
            $extension = $source['mimeType'] === 'image/png' ? 'png' : 'jpg';
            $path = "articles/{$articleId}/assets/{$assetId}.{$extension}";
            $this->storage->putAsset($path, $source['buffer'], $source['mimeType']);
            $source['id'] = $assetId;
            $source['storagePath'] = $path;
            $sourceAssets[$assetId] = $source;
            $assetRows[] = $source;
            $block['assetId'] = $assetId;
        }
        unset($block);
        $body = Docx::createBody($content, $sourceAssets);
        $wordCount = Validation::bodyWordCount($content);
        $this->storage->putDocx($currentPath, $body);
        $this->storage->putDocx("articles/{$articleId}/versions/v1.docx", $body);
        try {
            $this->db->transaction(function (Database $db) use ($articleId, $documentKey, $currentPath, $content, $wordCount, $assetRows): void {
                $reference = $this->uniqueReference($db);
                $db->execute("INSERT INTO trabajos_articles (id, public_reference, title, introduction, body_word_count, body_count_note, status, document_key, document_storage_path, last_document_saved_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, NOW())", [$articleId, $reference, $content['title'], $content['introduction'], $wordCount, 'Conteo narrativo estructurado: incluye encabezados y párrafos; excluye pies y celdas.', $documentKey, $currentPath]);
                $this->persistRelations($db, $articleId, $content, $assetRows);
                $db->execute('INSERT INTO trabajos_document_versions (id, article_id, version, document_key, storage_path, word_count, content_snapshot) VALUES (?, ?, 1, ?, ?, ?, ?)', [Security::uuid(), $articleId, $documentKey, "articles/{$articleId}/versions/v1.docx", $wordCount, json_encode($this->snapshot($content), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
            });
        } catch (Throwable $error) {
            $this->storage->removeArticle($articleId);
            throw $error;
        }
        return $this->get($articleId);
    }

    public function update(string $articleId, array $input): array
    {
        self::assertUuid($articleId);
        $content = Validation::article($input);
        $this->db->transaction(function (Database $db) use ($articleId, $content): void {
            $locked = $db->one('SELECT id FROM trabajos_articles WHERE id = ? FOR UPDATE', [$articleId]);
            if (!$locked) throw new ApiException('El artículo experimental no existe.', 404);
            $assetIds = array_values(array_unique(array_column(array_filter($content['blocks'], static fn (array $b): bool => $b['type'] === 'figure'), 'assetId')));
            if ($assetIds) {
                $marks = implode(',', array_fill(0, count($assetIds), '?'));
                $found = $db->all("SELECT id FROM trabajos_article_assets WHERE article_id = ? AND id IN ({$marks})", array_merge([$articleId], $assetIds));
                if (count($found) !== count($assetIds)) throw new ApiException('Una de las imágenes seleccionadas no pertenece a este artículo.', 422);
            }
            $db->execute("UPDATE trabajos_articles SET title = ?, introduction = ?, status = 'draft', page_count = NULL, generated_at = NULL, generated_revision = NULL, content_revision = content_revision + 1, updated_at = NOW() WHERE id = ?", [$content['title'], $content['introduction'], $articleId]);
            $db->execute('DELETE FROM trabajos_authors WHERE article_id = ?', [$articleId]);
            $db->execute('DELETE FROM trabajos_keywords WHERE article_id = ?', [$articleId]);
            $db->execute('DELETE FROM trabajos_article_blocks WHERE article_id = ?', [$articleId]);
            $this->persistRelations($db, $articleId, $content, []);
        });
        return $this->get($articleId);
    }

    public function listRecent(string $sessionHash): array
    {
        $rows = $this->db->all("SELECT DISTINCT a.id, a.public_reference, a.title, a.status, a.body_word_count, a.page_count, a.generated_at, a.updated_at, a.last_document_saved_at, (SELECT COUNT(*) FROM trabajos_article_blocks b WHERE b.article_id = a.id AND b.type = 'figure') AS figure_count, (SELECT COUNT(*) FROM trabajos_article_blocks b WHERE b.article_id = a.id AND b.type = 'table') AS table_count FROM trabajos_articles a JOIN trabajos_article_sessions s ON s.article_id = a.id WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW() ORDER BY a.updated_at DESC", [$sessionHash]);
        return array_map(static fn (array $row): array => ['id' => $row['id'], 'publicReference' => $row['public_reference'], 'title' => $row['title'], 'status' => $row['status'], 'bodyWordCount' => (int) $row['body_word_count'], 'pageCount' => $row['page_count'] === null ? null : (int) $row['page_count'], 'generatedAt' => $row['generated_at'], 'figureCount' => (int) $row['figure_count'], 'tableCount' => (int) $row['table_count'], 'updatedAt' => $row['updated_at'], 'lastDocumentSavedAt' => $row['last_document_saved_at']], $rows);
    }

    public function loadAssets(string $articleId, array $blocks): array
    {
        $ids = array_values(array_unique(array_column(array_filter($blocks, static fn (array $b): bool => $b['type'] === 'figure'), 'assetId')));
        if (!$ids) return [];
        $marks = implode(',', array_fill(0, count($ids), '?'));
        $rows = $this->db->all("SELECT * FROM trabajos_article_assets WHERE article_id = ? AND id IN ({$marks})", array_merge([$articleId], $ids));
        $assets = [];
        foreach ($rows as $row) $assets[$row['id']] = ['id' => $row['id'], 'mimeType' => $row['mime_type'], 'originalName' => $row['original_name'], 'width' => (int) $row['width'], 'height' => (int) $row['height'], 'buffer' => $this->storage->getAsset($row['storage_path'])];
        if (count($assets) !== count($ids)) throw new ApiException('Una de las imágenes del artículo ya no está disponible.', 422);
        return $assets;
    }

    public function generate(string $articleId, OnlyOffice $onlyoffice): array
    {
        $article = $this->get($articleId);
        $content = Validation::article($article);
        $wordCount = Validation::bodyWordCount($content);
        if ($wordCount > Validation::MAX_WORDS) throw new ApiException("El cuerpo contiene {$wordCount} palabras; el máximo permitido es " . Validation::MAX_WORDS . '.', 422);
        $buffer = Docx::createBody($content, $this->loadAssets($articleId, $content['blocks']));
        $key = 'trabajos-' . Security::uuid();
        $candidate = "articles/{$articleId}/generated/" . Security::uuid() . '.docx';
        $this->storage->putDocx($candidate, $buffer);
        try { $pages = $onlyoffice->countPages($article, $candidate, $key); }
        catch (Throwable $error) { $this->storage->remove($candidate); throw $error; }
        try {
            $this->db->transaction(function (Database $db) use ($article, $articleId, $key, $buffer, $wordCount, $pages, $content): void {
                $locked = $db->one('SELECT content_revision FROM trabajos_articles WHERE id = ? FOR UPDATE', [$articleId]);
                if (!$locked || (int) $locked['content_revision'] !== $article['contentRevision']) throw new ApiException('El contenido cambió durante la generación. Vuelve a intentarlo.', 409);
                $version = (int) ($db->one('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM trabajos_document_versions WHERE article_id = ?', [$articleId])['version'] ?? 1);
                $current = "articles/{$articleId}/body-current.docx";
                $versionPath = "articles/{$articleId}/versions/v{$version}.docx";
                $this->storage->putDocx($current, $buffer); $this->storage->putDocx($versionPath, $buffer);
                $status = $pages > Validation::MAX_PAGES ? 'requires_changes' : 'draft';
                $db->execute('UPDATE trabajos_articles SET document_key = ?, document_storage_path = ?, body_word_count = ?, body_count_note = ?, page_count = ?, generated_at = NOW(), generated_revision = content_revision, last_document_saved_at = NOW(), updated_at = NOW(), status = ? WHERE id = ?', [$key, $current, $wordCount, 'Conteo narrativo estructurado: incluye encabezados y párrafos; excluye pies y celdas.', $pages, $status, $articleId]);
                $db->execute('INSERT INTO trabajos_document_versions (id, article_id, version, document_key, storage_path, word_count, content_snapshot, page_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [Security::uuid(), $articleId, $version, $key, $versionPath, $wordCount, json_encode($this->snapshot($content), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $pages]);
            });
        } finally { $this->storage->remove($candidate); }
        return $this->get($articleId);
    }

    public function finalize(string $articleId): array
    {
        $article = $this->get($articleId);
        $errors = Validation::finalErrors($article);
        if (!$article['generatedAt'] || $article['generatedRevision'] !== $article['contentRevision']) $errors[] = 'Genera una vista actualizada antes de finalizar.';
        if ($article['pageCount'] === null) $errors[] = 'No fue posible comprobar el número de páginas.';
        elseif ($article['pageCount'] > Validation::MAX_PAGES) $errors[] = 'El documento ocupa más de tres páginas.';
        if ($article['bodyWordCount'] > Validation::MAX_WORDS) $errors[] = 'El documento supera 250 palabras.';
        if ($errors) throw new ApiException('El artículo no puede finalizarse.', 422, $errors);
        $this->db->execute("UPDATE trabajos_articles SET status = 'finalized', updated_at = NOW() WHERE id = ?", [$articleId]);
        return $this->get($articleId);
    }

    public function delete(string $articleId): void
    {
        self::assertUuid($articleId);
        if (!$this->db->execute('DELETE FROM trabajos_articles WHERE id = ?', [$articleId])) throw new ApiException('El artículo experimental no existe.', 404);
        $this->storage->removeArticle($articleId);
    }

    public static function safeFilename(string $title): string
    {
        $plain = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $title) ?: $title;
        $slug = trim(substr(preg_replace('/[^a-z0-9]+/', '-', strtolower($plain)) ?: '', 0, 45), '-');
        return ($slug ?: 'articulo-experimental') . '.docx';
    }

    public static function assertUuid(string $value): void
    {
        if (!Validation::isUuid($value)) throw new ApiException('El identificador del artículo no es válido.', 400);
    }

    private function uniqueReference(Database $db): string
    {
        for ($attempt = 0; $attempt < 20; $attempt++) { $value = Security::reference(); if (!$db->one('SELECT 1 FROM trabajos_articles WHERE public_reference = ?', [$value])) return $value; }
        throw new \RuntimeException('No fue posible generar una referencia pública única.');
    }

    private function persistRelations(Database $db, string $articleId, array $content, array $assets): void
    {
        foreach ($assets as $asset) $db->execute('INSERT INTO trabajos_article_assets (id, article_id, storage_path, mime_type, original_name, width, height, byte_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$asset['id'], $articleId, $asset['storagePath'], $asset['mimeType'], $asset['originalName'] ?? 'imagen', $asset['width'], $asset['height'], strlen($asset['buffer'])]);
        foreach ($content['authors'] as $position => $author) $db->execute('INSERT INTO trabajos_authors (id, article_id, first_name, last_name, email, institution, orcid, is_corresponding, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [Security::uuid(), $articleId, $author['firstName'], $author['lastName'], $author['email'], $author['institution'], $author['orcid'], $author['isCorresponding'] ? 1 : 0, $position]);
        foreach ($content['keywords'] as $position => $keyword) $db->execute('INSERT INTO trabajos_keywords (id, article_id, value, position) VALUES (?, ?, ?, ?)', [Security::uuid(), $articleId, $keyword, $position]);
        foreach ($content['blocks'] as $position => $block) $db->execute('INSERT INTO trabajos_article_blocks (id, article_id, type, position, text_content, caption, asset_id, table_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$block['id'], $articleId, $block['type'], $position, $block['type'] === 'text' ? $block['text'] : null, in_array($block['type'], ['figure', 'table'], true) ? $block['caption'] : null, $block['type'] === 'figure' ? $block['assetId'] : null, $block['type'] === 'table' ? json_encode($block['cells'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) : null]);
    }

    private function snapshot(array $content): array { return ['introduction' => $content['introduction'], 'blocks' => $content['blocks']]; }
}
