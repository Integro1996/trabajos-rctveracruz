<?php
declare(strict_types=1);

use Trabajos\Lib\Request;
use Trabajos\Lib\Response;
use Trabajos\Lib\Router;
use Trabajos\Lib\Security;

return static function (Router $router, array $s): void {
    $router->add('POST', '/api/lab/admin/login', static function (Request $request) use ($s): void {
        $s['admin']->ensureSeed();
        $email = strtolower(trim((string) ($request->body['email'] ?? '')));
        $limited = $s['recovery']->limited('ADMIN_LOGIN', $request->ip(), $s['config']->adminLoginRateLimitMax, $s['config']->adminLoginRateLimitWindowMinutes);
        if ($limited) {
            $s['recovery']->recordAttempt('ADMIN_LOGIN', false, true, $request); header('Retry-After: ' . ($s['config']->adminLoginRateLimitWindowMinutes * 60));
            Response::json(['error' => 'No fue posible iniciar sesión administrativa.'], 429);
        }
        $admin = $s['db']->one('SELECT * FROM trabajos_admin_users WHERE email = ? AND active = TRUE', [$email]);
        $valid = $admin && Security::verifySecret((string) ($request->body['password'] ?? ''), $admin['password_hash']);
        $s['recovery']->recordAttempt('ADMIN_LOGIN', (bool) $valid, false, $request);
        if (!$valid) Response::json(['error' => 'No fue posible iniciar sesión administrativa.'], 401);
        $sessionId = $s['auth']->issueAdmin($request, $admin['id']);
        $s['db']->execute('UPDATE trabajos_admin_users SET last_login_at = NOW() WHERE id = ?', [$admin['id']]);
        $current = ['id' => $admin['id'], 'name' => $admin['name'], 'email' => $admin['email'], 'session_id' => $sessionId];
        $s['admin']->audit($request, $current, 'ADMIN_LOGIN', null, null, ['method' => 'password']);
        Response::json(['admin' => ['name' => $admin['name'], 'email' => $admin['email']]]);
    });

    $router->add('GET', '/api/lab/admin/session', static function (Request $request) use ($s): void {
        $admin = $s['auth']->currentAdmin($request);
        Response::json(['authenticated' => $admin !== null, 'admin' => $admin ? ['name' => $admin['name'], 'email' => $admin['email']] : null]);
    });

    $router->add('POST', '/api/lab/admin/logout', static function (Request $request) use ($s): void {
        $s['auth']->requireAdmin($request); $s['auth']->logoutAdmin($request); Response::empty();
    });
};
