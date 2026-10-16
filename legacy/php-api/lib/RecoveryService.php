<?php
declare(strict_types=1);

namespace Trabajos\Lib;

use chillerlan\QRCode\QRCode;
use Trabajos\Config\Config;

final class RecoveryService
{
    public function __construct(private readonly Config $config, private readonly Database $db) {}

    public function bundle(string $articleId, bool $revokeExisting = false): array
    {
        $code = Security::recoveryCode();
        $qrToken = Security::token();
        $this->db->transaction(function (Database $db) use ($articleId, $revokeExisting, $code, $qrToken): void {
            if ($revokeExisting) $db->execute("UPDATE trabajos_recovery_credentials SET revoked_at = NOW() WHERE article_id = ? AND type IN ('HUMAN_CODE', 'QR_TOKEN') AND revoked_at IS NULL", [$articleId]);
            $this->store($db, $articleId, 'HUMAN_CODE', $code);
            $this->store($db, $articleId, 'QR_TOKEN', $qrToken);
        });
        $url = $this->config->publicAppUrl . '/recover/' . rawurlencode($qrToken);
        if (!class_exists(QRCode::class)) throw new \RuntimeException('Falta instalar dependencias Composer para generar el QR.');
        return ['code' => $code, 'recoveryUrl' => $url, 'qrDataUrl' => (new QRCode())->render($url)];
    }

    public function store(Database $db, string $articleId, string $type, string $secret, ?string $expiresAt = null, ?int $maxUses = null): void
    {
        $normalized = $type === 'QR_TOKEN' ? $secret : Security::normalizeCode($secret);
        $db->execute('INSERT INTO trabajos_recovery_credentials (id, article_id, type, lookup_hash, secret_hash, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?)', [Security::uuid(), $articleId, $type, Security::lookup($normalized, $this->config->recoveryPepper, $type), Security::hashSecret($normalized), $expiresAt, $maxUses]);
    }

    public function use(string $type, string $raw): ?string
    {
        $secret = $type === 'QR_TOKEN' ? $raw : Security::normalizeCode($raw);
        $lookup = Security::lookup($secret, $this->config->recoveryPepper, $type);
        return $this->db->transaction(function (Database $db) use ($lookup, $type, $secret): ?string {
            $credential = $db->one('SELECT * FROM trabajos_recovery_credentials WHERE lookup_hash = ? AND type = ? FOR UPDATE', [$lookup, $type]);
            if (!$credential || $credential['revoked_at'] !== null || ($credential['expires_at'] !== null && strtotime($credential['expires_at']) <= time()) || ($credential['max_uses'] !== null && (int) $credential['use_count'] >= (int) $credential['max_uses']) || !Security::verifySecret($secret, $credential['secret_hash'])) return null;
            $replacement = Security::secretNeedsRehash($credential['secret_hash']) ? Security::hashSecret($secret) : $credential['secret_hash'];
            $db->execute('UPDATE trabajos_recovery_credentials SET use_count = use_count + 1, secret_hash = ? WHERE id = ?', [$replacement, $credential['id']]);
            return $credential['article_id'];
        });
    }

    public function limited(string $kind, string $ip, int $max, int $windowMinutes): bool
    {
        $cutoff = gmdate('Y-m-d H:i:s', time() - $windowMinutes * 60);
        $row = $this->db->one('SELECT COUNT(*) AS count FROM trabajos_recovery_attempts WHERE kind = ? AND ip_address = ? AND successful = FALSE AND created_at > ?', [$kind, $ip, $cutoff]);
        return (int) ($row['count'] ?? 0) >= $max;
    }

    public function recordAttempt(string $kind, bool $successful, bool $rateLimited, Request $request): void
    {
        $this->db->execute('INSERT INTO trabajos_recovery_attempts (kind, successful, rate_limited, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)', [$kind, $successful ? 1 : 0, $rateLimited ? 1 : 0, $request->ip(), $request->userAgent()]);
    }
}
