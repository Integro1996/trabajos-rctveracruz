<?php
declare(strict_types=1);

use Trabajos\Lib\Request;
use Trabajos\Lib\Response;
use Trabajos\Lib\Router;
use function Trabajos\Lib\handleException;

try {
    $services = require __DIR__ . '/bootstrap.php';
    $request = new Request(null, null, $services['config']->trustProxy);
    if ($request->method === 'OPTIONS') Response::empty(204);
    $router = new Router();
    foreach (['articles', 'recovery', 'sessions', 'admin', 'onlyoffice'] as $group) {
        $register = require __DIR__ . '/' . $group . '/routes.php';
        $register($router, $services);
    }
    $router->dispatch($request);
} catch (Throwable $error) {
    handleException($error, $services['config']->environment ?? (getenv('APP_ENV') ?: 'production'));
}
