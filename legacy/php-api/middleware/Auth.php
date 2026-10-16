<?php
declare(strict_types=1);

namespace Trabajos\Middleware;

use Trabajos\Config\Config;
use Trabajos\Lib\ApiException;
use Trabajos\Lib\Database;
use Trabajos\Lib\Request;
use Trabajos\Lib\Security;

final class Auth
{
    public const ARTICLE_COOKIE = 'trabajos_session';
    public const ARTICLE_CSRF_COOKIE = 'trabajos_csrf';
    public const ADMIN_COOKIE = 'trabajos_admin_session';
    public const ADMIN_CSRF_COOKIE = 'trabajos_admin_csrf';

    public function __construct(private readonly Config $config, private readonly Database $db) {}

    public function currentArticle(Request $request): ?array
    {
        $token = (string) ($request->cookies[self::ARTICLE_COOKIE] ?? '');
        if ($token === '') return null;
        $hash = Security::lookup($token, $this->config->recoveryPepper, 'article-session');
        $rows = $this->db->all('SELECT article_id FROM trabajos_article_sessions WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > NOW()', [$hash]);
        if (!$rows) return null;
        return ['token' => $token, 'hash' => $hash, 'articleIds' => array_column($rows, 'article_id')];
    }

    public function requireArticle(Request $request): array
    {
        $articleId = (string) ($request->params['articleId'] ?? '');
        $session = $this->currentArticle($request);
        if (!$session || !in_array($articleId, $session['articleIds'], true)) throw new ApiException('No tiene acceso a este trabajo.', 403);
        $this->requireCsrf($request, self::ARTICLE_CSRF_COOKIE, 'x-trabajos-csrf', 'La protección CSRF rechazó la solicitud.');
        $this->db->execute('UPDATE trabajos_article_sessions SET last_used_at = NOW() WHERE article_id = ? AND session_hash = ?', [$articleId, $session['hash']]);
        return $session;
    }

    public function issueArticle(Request $request, string $articleId, bool $forceNew = false): string
    {
        $existing = $this->currentArticle($request);
        $token = !$forceNew && $existing ? $existing['token'] : Security::token();
        $hash = Security::lookup($token, $this->config->recoveryPepper, 'article-session');
        $expires = gmdate('Y-m-d H:i:s.v', time() + $this->config->articleSessionDays * 86400);
        if ($forceNew && $existing) {
            foreach ($existing['articleIds'] as $previousArticleId) {
                $this->db->execute('INSERT IGNORE INTO trabajos_article_sessions (id, article_id, session_hash, expires_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?)', [Security::uuid(), $previousArticleId, $hash, $expires, $request->userAgent(), $request->ip()]);
            }
        }
        $this->db->execute('INSERT INTO trabajos_article_sessions (id, article_id, session_hash, expires_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), revoked_at = NULL, last_used_at = NOW()', [Security::uuid(), $articleId, $hash, $expires, $request->userAgent(), $request->ip()]);
        $csrf = Security::token();
        $this->cookie(self::ARTICLE_COOKIE, $token, true, $this->config->articleSessionDays * 86400, 'Lax');
        $this->cookie(self::ARTICLE_CSRF_COOKIE, $csrf, false, $this->config->articleSessionDays * 86400, 'Lax');
        return $hash;
    }

    public function currentAdmin(Request $request): ?array
    {
        $token = (string) ($request->cookies[self::ADMIN_COOKIE] ?? '');
        if ($token === '') return null;
        return $this->db->one('SELECT s.id AS session_id, s.session_hash, u.id, u.name, u.email FROM trabajos_admin_sessions s JOIN trabajos_admin_users u ON u.id = s.admin_id WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.active = TRUE', [Security::lookup($token, $this->config->recoveryPepper, 'admin-session')]);
    }

    public function requireAdmin(Request $request): array
    {
        $admin = $this->currentAdmin($request);
        if (!$admin) throw new ApiException('Autenticación administrativa requerida.', 401);
        $this->requireCsrf($request, self::ADMIN_CSRF_COOKIE, 'x-admin-csrf', 'La protección CSRF administrativa rechazó la solicitud.');
        $this->db->execute('UPDATE trabajos_admin_sessions SET last_used_at = NOW() WHERE id = ?', [$admin['session_id']]);
        return $admin;
    }

    public function issueAdmin(Request $request, string $adminId): string
    {
        $token = Security::token();
        $csrf = Security::token();
        $hash = Security::lookup($token, $this->config->recoveryPepper, 'admin-session');
        $expires = gmdate('Y-m-d H:i:s.v', time() + $this->config->adminSessionHours * 3600);
        $id = Security::uuid();
        $this->db->execute('INSERT INTO trabajos_admin_sessions (id, admin_id, session_hash, expires_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?)', [$id, $adminId, $hash, $expires, $request->userAgent(), $request->ip()]);
        $this->cookie(self::ADMIN_COOKIE, $token, true, $this->config->adminSessionHours * 3600, 'Strict');
        $this->cookie(self::ADMIN_CSRF_COOKIE, $csrf, false, $this->config->adminSessionHours * 3600, 'Strict');
        return $id;
    }

    public function logoutAdmin(Request $request): void
    {
        $admin = $this->currentAdmin($request);
        if ($admin) $this->db->execute('UPDATE trabajos_admin_sessions SET revoked_at = NOW() WHERE id = ?', [$admin['session_id']]);
        $this->cookie(self::ADMIN_COOKIE, '', true, 0, 'Strict');
        $this->cookie(self::ADMIN_CSRF_COOKIE, '', false, 0, 'Strict');
    }

    private function requireCsrf(Request $request, string $cookie, string $header, string $message): void
    {
        if (in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) return;
        $left = (string) ($request->cookies[$cookie] ?? '');
        $right = $request->header($header);
        if ($left === '' || $right === '' || !hash_equals($left, $right)) throw new ApiException($message, 403);
    }

    private function cookie(string $name, string $value, bool $httpOnly, int $maxAge, string $sameSite): void
    {
        setcookie($name, $value, [
            'expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600,
            'path' => '/',
            'secure' => $this->config->cookieSecure,
            'httponly' => $httpOnly,
            'samesite' => $sameSite,
        ]);
    }
}
