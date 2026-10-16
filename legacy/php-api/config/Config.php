<?php
declare(strict_types=1);

namespace Trabajos\Config;

use RuntimeException;

final class Config
{
    public function __construct(
        public readonly string $environment,
        public readonly string $publicAppUrl,
        public readonly string $dbHost,
        public readonly int $dbPort,
        public readonly string $dbName,
        public readonly string $dbUser,
        public readonly string $dbPassword,
        public readonly string $onlyofficePublicUrl,
        public readonly string $onlyofficeInternalUrl,
        public readonly string $onlyofficeCallbackBaseUrl,
        public readonly array $onlyofficeDownloadOrigins,
        public readonly string $onlyofficeJwtSecret,
        public readonly string $documentTokenSecret,
        public readonly string $recoveryPepper,
        public readonly string $adminName,
        public readonly string $adminEmail,
        public readonly string $adminPassword,
        public readonly bool $cookieSecure,
        public readonly bool $trustProxy,
        public readonly string $storagePath,
        public readonly int $articleSessionDays,
        public readonly int $adminSessionHours,
        public readonly int $recoveryRateLimitMax,
        public readonly int $recoveryRateLimitWindowMinutes,
        public readonly int $adminLoginRateLimitMax,
        public readonly int $adminLoginRateLimitWindowMinutes,
        public readonly int $temporaryAccessHours,
        public readonly int $maxDocxBytes,
    ) {}

    public static function fromEnvironment(): self
    {
        $public = self::required('PUBLIC_APP_URL');
        $ooPublic = self::required('ONLYOFFICE_PUBLIC_URL');
        $ooSecret = self::required('ONLYOFFICE_JWT_SECRET');
        $origins = array_values(array_filter(array_map(
            static fn (string $value): string => self::origin(trim($value)),
            explode(',', self::value('ONLYOFFICE_DOWNLOAD_ORIGINS', $ooPublic)),
        )));

        return new self(
            self::value('APP_ENV', 'production'),
            rtrim($public, '/'),
            self::required('DB_HOST'),
            self::integer('DB_PORT', 3306),
            self::required('DB_NAME'),
            self::required('DB_USER'),
            self::required('DB_PASSWORD'),
            rtrim($ooPublic, '/'),
            rtrim(self::value('ONLYOFFICE_INTERNAL_URL', $ooPublic), '/'),
            rtrim(self::value('ONLYOFFICE_CALLBACK_BASE_URL', $public), '/'),
            $origins,
            $ooSecret,
            self::value('DOCUMENT_TOKEN_SECRET', $ooSecret),
            self::required('RECOVERY_PEPPER'),
            self::value('ADMIN_NAME', 'Administrador de trabajos'),
            strtolower(self::value('ADMIN_EMAIL')),
            self::value('ADMIN_PASSWORD'),
            self::boolean('COOKIE_SECURE', true),
            self::boolean('TRUST_PROXY', false),
            self::required('STORAGE_PATH'),
            self::integer('ARTICLE_SESSION_DAYS', 30),
            self::integer('ADMIN_SESSION_HOURS', 8),
            self::integer('RECOVERY_RATE_LIMIT_MAX', 8),
            self::integer('RECOVERY_RATE_LIMIT_WINDOW_MINUTES', 15),
            self::integer('ADMIN_LOGIN_RATE_LIMIT_MAX', 6),
            self::integer('ADMIN_LOGIN_RATE_LIMIT_WINDOW_MINUTES', 15),
            self::integer('TEMPORARY_ACCESS_HOURS', 24),
            self::integer('MAX_DOCX_BYTES', 20 * 1024 * 1024),
        );
    }

    private static function value(string $name, string $fallback = ''): string
    {
        $value = getenv($name);
        return $value === false || trim($value) === '' ? $fallback : trim($value);
    }

    private static function required(string $name): string
    {
        $value = self::value($name);
        if ($value === '') {
            throw new RuntimeException("Falta la variable de entorno {$name}.");
        }
        return $value;
    }

    private static function integer(string $name, int $fallback): int
    {
        $raw = self::value($name, (string) $fallback);
        if (filter_var($raw, FILTER_VALIDATE_INT) === false) {
            throw new RuntimeException("{$name} debe ser un entero.");
        }
        return (int) $raw;
    }

    private static function boolean(string $name, bool $fallback): bool
    {
        $raw = strtolower(self::value($name, $fallback ? 'true' : 'false'));
        return in_array($raw, ['1', 'true', 'yes', 'on'], true);
    }

    private static function origin(string $url): string
    {
        $parts = parse_url($url);
        if (!$parts || !isset($parts['scheme'], $parts['host'])) return '';
        $origin = strtolower($parts['scheme']) . '://' . strtolower($parts['host']);
        if (isset($parts['port'])) $origin .= ':' . $parts['port'];
        return $origin;
    }
}
