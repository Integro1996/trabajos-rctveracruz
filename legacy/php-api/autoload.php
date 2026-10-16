<?php
declare(strict_types=1);

$vendor = __DIR__ . '/vendor/autoload.php';
if (is_file($vendor)) require_once $vendor;
require_once __DIR__ . '/lib/Http.php';

spl_autoload_register(static function (string $class): void {
    $roots = [
        'Trabajos\\Config\\' => __DIR__ . '/config/',
        'Trabajos\\Lib\\' => __DIR__ . '/lib/',
        'Trabajos\\Middleware\\' => __DIR__ . '/middleware/',
    ];
    foreach ($roots as $prefix => $root) {
        if (!str_starts_with($class, $prefix)) continue;
        $path = $root . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($path)) require_once $path;
        return;
    }
});
