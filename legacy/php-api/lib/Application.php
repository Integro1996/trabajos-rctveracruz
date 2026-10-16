<?php
declare(strict_types=1);

namespace Trabajos\Lib;

use Trabajos\Config\Config;
use Trabajos\Middleware\Auth;

/** Composition root shared by HTTP and CLI; constructing services sends no headers. */
final class Application
{
    public static function services(?Config $config = null): array
    {
        $config ??= Config::fromEnvironment();
        $db = new Database($config);
        $storage = new Storage($config);
        $articles = new ArticleService($db, $storage);
        $onlyoffice = new OnlyOffice($config, $storage);
        $recovery = new RecoveryService($config, $db);
        $auth = new Auth($config, $db);
        $admin = new AdminService($config, $db, $articles, $storage, $onlyoffice, $recovery);
        return compact('config', 'db', 'storage', 'articles', 'onlyoffice', 'recovery', 'auth', 'admin');
    }

    public static function headers(Config $config): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && hash_equals($config->publicAppUrl, rtrim($origin, '/'))) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Credentials: true');
            header('Vary: Origin');
        }
        header('Access-Control-Allow-Headers: Content-Type, X-Trabajos-CSRF, X-Admin-CSRF, Authorization');
        header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        header('X-Frame-Options: SAMEORIGIN');
    }
}
