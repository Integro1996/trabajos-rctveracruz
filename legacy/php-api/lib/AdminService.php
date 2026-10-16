<?php
declare(strict_types=1);

namespace Trabajos\Lib;

use Trabajos\Config\Config;

final class AdminService
{
    public function __construct(
        private readonly Config $config,
        private readonly Database $db,
        private readonly ArticleService $articles,
        private readonly Storage $storage,
        private readonly OnlyOffice $onlyoffice,
        private readonly RecoveryService $recovery,
    ) {}

    public function ensureSeed(): void
    {
        if ($this->config->adminEmail === '' || $this->config->adminPassword === '') return;
        $admin = $this->db->one('SELECT id, password_hash FROM trabajos_admin_users WHERE email = ?', [$this->config->adminEmail]);
        if (!$admin) {
            $this->db->execute('INSERT INTO trabajos_admin_users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [Security::uuid(), $this->config->adminName, $this->config->adminEmail, Security::hashSecret($this->config->adminPassword)]);
        } elseif (!Security::verifySecret($this->config->adminPassword, $admin['password_hash'])) {
            $this->db->execute('UPDATE trabajos_admin_users SET name = ?, password_hash = ?, active = TRUE, updated_at = NOW() WHERE id = ?', [$this->config->adminName, Security::hashSecret($this->config->adminPassword), $admin['id']]);
        } elseif (Security::secretNeedsRehash($admin['password_hash'])) {
            $this->db->execute('UPDATE trabajos_admin_users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [Security::hashSecret($this->config->adminPassword), $admin['id']]);
        }
    }

    public function search(string $search, string $date): array
    {
        $rows = $this->db->all("SELECT a.id, a.public_reference, a.title, a.status, a.updated_at, a.created_at, COALESCE((SELECT CONCAT(au.first_name, ' ', au.last_name) FROM trabajos_authors au WHERE au.article_id = a.id ORDER BY au.position LIMIT 1), '') AS primary_author, COALESCE((SELECT MAX(v.version) FROM trabajos_document_versions v WHERE v.article_id = a.id), 0) AS version FROM trabajos_articles a WHERE (? = '' OR a.public_reference LIKE CONCAT('%', ?, '%') OR a.title LIKE CONCAT('%', ?, '%') OR a.id LIKE CONCAT('%', ?, '%') OR EXISTS (SELECT 1 FROM trabajos_authors au WHERE au.article_id = a.id AND (au.first_name LIKE CONCAT('%', ?, '%') OR au.last_name LIKE CONCAT('%', ?, '%') OR au.email LIKE CONCAT('%', ?, '%')))) AND (? = '' OR DATE(a.created_at) = ?) ORDER BY a.updated_at DESC LIMIT 100", [$search, $search, $search, $search, $search, $search, $search, $date, $date]);
        return array_map(static fn (array $row): array => ['id' => $row['id'], 'publicReference' => $row['public_reference'], 'title' => $row['title'], 'status' => $row['status'], 'primaryAuthor' => $row['primary_author'], 'version' => (int) $row['version'], 'createdAt' => $row['created_at'], 'updatedAt' => $row['updated_at']], $rows);
    }

    public function detail(string $articleId, Request $request, array $admin): array
    {
        $article = $this->articles->get($articleId);
        $sessions = $this->db->one('SELECT COUNT(*) AS count FROM trabajos_article_sessions WHERE article_id = ? AND revoked_at IS NULL AND expires_at > NOW()', [$articleId]);
        $credentialRows = $this->db->all('SELECT type, SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR use_count < max_uses) THEN 1 ELSE 0 END) AS active FROM trabajos_recovery_credentials WHERE article_id = ? GROUP BY type', [$articleId]);
        $credentials = [];
        foreach ($credentialRows as $row) $credentials[$row['type']] = (int) $row['active'] > 0;
        $versions = $this->db->all('SELECT version, word_count, page_count, created_at FROM trabajos_document_versions WHERE article_id = ? ORDER BY version DESC', [$articleId]);
        try { $bytes = strlen($this->storage->getDocx($article['documentStoragePath'])); $document = ['available' => true, 'bytes' => $bytes]; }
        catch (\Throwable) { $document = ['available' => false, 'bytes' => 0]; }
        $this->audit($request, $admin, 'VIEW_ARTICLE', $articleId);
        return ['article' => $article, 'document' => $document, 'onlyofficeAvailable' => $this->onlyoffice->healthy(), 'activeSessions' => (int) ($sessions['count'] ?? 0), 'credentials' => $credentials, 'versions' => array_map(static fn (array $row): array => ['version' => (int) $row['version'], 'wordCount' => (int) $row['word_count'], 'pageCount' => $row['page_count'] === null ? null : (int) $row['page_count'], 'restorable' => true, 'createdAt' => $row['created_at']], $versions)];
    }

    public function audit(Request $request, array $admin, string $action, ?string $articleId = null, ?string $reason = null, array $metadata = []): void
    {
        $safeReason = $reason === null ? null : mb_substr($this->scrub($reason), 0, 2000);
        $safeMetadata = $this->scrubMetadata($metadata);
        $this->db->execute('INSERT INTO trabajos_admin_audit_log (admin_id, article_id, action, reason, metadata, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)', [$admin['id'], $articleId, $action, $safeReason, json_encode($safeMetadata, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $request->ip(), $request->userAgent()]);
    }

    public function auditRows(): array
    {
        $rows = $this->db->all('SELECT l.id, l.action, l.reason, l.metadata, l.created_at, l.article_id, u.name AS admin_name, u.email AS admin_email, a.public_reference FROM trabajos_admin_audit_log l JOIN trabajos_admin_users u ON u.id = l.admin_id LEFT JOIN trabajos_articles a ON a.id = l.article_id ORDER BY l.created_at DESC LIMIT 200');
        return array_map(static fn (array $row): array => ['id' => (int) $row['id'], 'action' => $row['action'], 'reason' => $row['reason'], 'metadata' => is_array($row['metadata']) ? $row['metadata'] : (json_decode((string) $row['metadata'], true) ?: []), 'createdAt' => $row['created_at'], 'articleId' => $row['article_id'], 'publicReference' => $row['public_reference'], 'admin' => ['name' => $row['admin_name'], 'email' => $row['admin_email']]], $rows);
    }

    public function restore(string $articleId, int $version, string $reason, Request $request, array $admin): array
    {
        if ($version < 1) throw new ApiException('Versión no válida.', 400);
        if (mb_strlen(trim($reason)) < 10) throw new ApiException('El motivo obligatorio debe tener al menos 10 caracteres.', 422);
        $article = $this->articles->get($articleId);
        $source = $this->db->one('SELECT storage_path, word_count, page_count FROM trabajos_document_versions WHERE article_id = ? AND version = ?', [$articleId, $version]);
        if (!$source) throw new ApiException('Versión no encontrada.', 404);
        $buffer = $this->storage->getDocx($source['storage_path']);
        $key = 'trabajos-' . Security::uuid();
        $pages = $source['page_count'] === null ? $this->onlyoffice->countPages($article, $source['storage_path'], $key) : (int) $source['page_count'];
        $words = $source['word_count'] === null ? Validation::countWords(Docx::extractText($buffer)) : (int) $source['word_count'];
        $created = $this->db->transaction(function (Database $db) use ($articleId, $key, $pages, $words, $buffer): int {
            if (!$db->one('SELECT id FROM trabajos_articles WHERE id = ? FOR UPDATE', [$articleId])) throw new ApiException('El trabajo ya no existe.', 404);
            $next = (int) ($db->one('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM trabajos_document_versions WHERE article_id = ?', [$articleId])['version'] ?? 1);
            $current = "articles/{$articleId}/body-current.docx"; $path = "articles/{$articleId}/versions/v{$next}.docx";
            $this->storage->putDocx($current, $buffer); $this->storage->putDocx($path, $buffer);
            $status = $pages > Validation::MAX_PAGES || $words > Validation::MAX_WORDS ? 'requires_changes' : 'draft';
            $db->execute('UPDATE trabajos_articles SET document_key = ?, document_storage_path = ?, body_word_count = ?, body_count_note = ?, page_count = ?, generated_at = NOW(), generated_revision = content_revision, last_document_saved_at = NOW(), updated_at = NOW(), status = ? WHERE id = ?', [$key, $current, $words, 'Conteo restaurado de la versión del cuerpo; conserva la precisión registrada en esa versión.', $pages, $status, $articleId]);
            $db->execute('INSERT INTO trabajos_document_versions (id, article_id, version, document_key, storage_path, word_count, content_snapshot, page_count) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)', [Security::uuid(), $articleId, $next, $key, $path, $words, $pages]);
            return $next;
        });
        $this->audit($request, $admin, 'RESTORE_VERSION', $articleId, $reason, ['restoredFrom' => $version, 'createdVersion' => $created]);
        return ['restoredFrom' => $version, 'createdVersion' => $created, 'article' => $this->articles->get($articleId)];
    }

    private function scrub(string $value): string
    {
        $value = preg_replace('/[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}(?:-[A-HJ-KM-NP-Z2-9]{2})?/', '[REDACTED-CODE]', $value) ?: $value;
        return preg_replace('#/recover/[A-Za-z0-9_-]+#', '/recover/[REDACTED]', $value) ?: $value;
    }

    private function scrubMetadata(array $metadata): array
    {
        foreach ($metadata as $key => &$value) {
            if (preg_match('/password|secret|token|cookie|code|grant/i', (string) $key)) $value = '[REDACTED]';
            elseif (is_array($value)) $value = $this->scrubMetadata($value);
            elseif (is_string($value)) $value = $this->scrub($value);
        }
        unset($value);
        return $metadata;
    }
}
