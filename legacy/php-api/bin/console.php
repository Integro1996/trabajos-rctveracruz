<?php
declare(strict_types=1);

use Trabajos\Lib\Application;

require_once dirname(__DIR__) . '/autoload.php';
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$command = $argv[1] ?? 'help';
if (!in_array($command, ['check', 'admin:seed'], true)) {
    fwrite(STDOUT, "Commands: check, admin:seed\n");
    exit($command === 'help' ? 0 : 2);
}
try {
    $services = Application::services();
    if ($command === 'admin:seed') {
        if ($services['config']->adminEmail === '' || $services['config']->adminPassword === '') {
            throw new RuntimeException('ADMIN_EMAIL and ADMIN_PASSWORD are required.');
        }
        $services['admin']->ensureSeed();
    } else {
        $services['db']->all('SELECT id FROM trabajos_articles LIMIT 0');
        if (!$services['storage']->healthy()) throw new RuntimeException('Private storage is not writable.');
    }
    fwrite(STDOUT, json_encode(['ok' => true, 'command' => $command], JSON_THROW_ON_ERROR) . PHP_EOL);
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}
