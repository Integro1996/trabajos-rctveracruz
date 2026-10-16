<?php
declare(strict_types=1);

namespace Trabajos\Lib;

final class Security
{
    public const FRIENDLY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
    }

    public static function token(int $bytes = 32): string
    {
        return self::base64url(random_bytes($bytes));
    }

    public static function reference(): string { return 'ART-' . self::friendly(6); }
    public static function recoveryCode(): string { $v = self::friendly(10); return substr($v, 0, 4) . '-' . substr($v, 4, 4) . '-' . substr($v, 8); }
    public static function temporaryCode(): string { $v = self::friendly(8); return substr($v, 0, 4) . '-' . substr($v, 4); }

    public static function normalizeCode(string $value): string
    {
        $compact = preg_replace('/[^A-Z0-9]/', '', strtoupper($value)) ?: '';
        if (strlen($compact) === 10) return substr($compact, 0, 4) . '-' . substr($compact, 4, 4) . '-' . substr($compact, 8);
        if (strlen($compact) === 8) return substr($compact, 0, 4) . '-' . substr($compact, 4);
        return strtoupper(trim($value));
    }

    public static function lookup(string $secret, string $pepper, string $namespace): string
    {
        return hash_hmac('sha256', $namespace . ':' . $secret, $pepper);
    }

    public static function hashSecret(string $secret): string
    {
        return password_hash($secret, PASSWORD_DEFAULT);
    }

    public static function verifySecret(string $secret, string $hash): bool
    {
        if (str_starts_with($hash, 'scrypt$')) {
            $parts = explode('$', $hash);
            if (count($parts) !== 6 || !function_exists('scrypt')) return false;
            [, $n, $r, $p, $saltText, $hashText] = $parts;
            $salt = self::decodeBase64url($saltText);
            $expected = self::decodeBase64url($hashText);
            // Only accept the parameters emitted by the legacy Node backend.
            // Bound work and memory before invoking the native KDF.
            if ($n !== '16384' || $r !== '8' || $p !== '1' || $salt === false || $expected === false || strlen($salt) !== 16 || strlen($expected) !== 32) return false;
            $actual = \scrypt($secret, $salt, (int) $n, (int) $r, (int) $p, strlen($expected));
            if (is_string($actual) && strlen($actual) === strlen($expected) * 2 && ctype_xdigit($actual)) $actual = hex2bin($actual);
            if (!is_string($actual)) return false;
            return hash_equals($expected, $actual);
        }
        return password_verify($secret, $hash);
    }

    public static function secretNeedsRehash(string $hash): bool
    {
        return str_starts_with($hash, 'scrypt$') || password_needs_rehash($hash, PASSWORD_DEFAULT);
    }

    public static function jwtEncode(array $payload, string $secret, int $expiresInSeconds): string
    {
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        if (!isset($payload['exp'])) $payload['exp'] = time() + $expiresInSeconds;
        $parts = [self::base64url(json_encode($header, JSON_THROW_ON_ERROR)), self::base64url(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR))];
        $parts[] = self::base64url(hash_hmac('sha256', implode('.', $parts), $secret, true));
        return implode('.', $parts);
    }

    public static function jwtDecode(string $token, string $secret): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) throw new ApiException('JWT inválido.', 401);
        [$header64, $payload64, $signature64] = $parts;
        $header = json_decode(self::base64urlDecode($header64), true);
        $payload = json_decode(self::base64urlDecode($payload64), true);
        $expected = self::base64url(hash_hmac('sha256', $header64 . '.' . $payload64, $secret, true));
        if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256' || !is_array($payload) || !hash_equals($expected, $signature64)) {
            throw new ApiException('JWT inválido.', 401);
        }
        if (isset($payload['exp']) && (int) $payload['exp'] < time()) throw new ApiException('JWT vencido.', 401);
        return $payload;
    }

    public static function base64url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function base64urlDecode(string $value): string
    {
        $decoded = self::decodeBase64url($value);
        if ($decoded === false) throw new ApiException('Codificación inválida.', 400);
        return $decoded;
    }

    private static function decodeBase64url(string $value): string|false
    {
        $standard = strtr($value, '-_', '+/');
        $standard .= str_repeat('=', (4 - strlen($standard) % 4) % 4);
        return base64_decode($standard, true);
    }

    private static function friendly(int $length): string
    {
        $result = '';
        $max = strlen(self::FRIENDLY_ALPHABET) - 1;
        for ($i = 0; $i < $length; $i++) $result .= self::FRIENDLY_ALPHABET[random_int(0, $max)];
        return $result;
    }
}
