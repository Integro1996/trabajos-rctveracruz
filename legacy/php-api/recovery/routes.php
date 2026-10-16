<?php
declare(strict_types=1);

use Trabajos\Lib\Request;
use Trabajos\Lib\Response;
use Trabajos\Lib\Router;

return static function (Router $router, array $s): void {
    $router->add('POST', '/api/lab/recover/code', static function (Request $request) use ($s): void {
        $limited = $s['recovery']->limited('CODE', $request->ip(), $s['config']->recoveryRateLimitMax, $s['config']->recoveryRateLimitWindowMinutes);
        if ($limited) {
            $s['recovery']->recordAttempt('CODE', false, true, $request); header('Retry-After: ' . ($s['config']->recoveryRateLimitWindowMinutes * 60));
            Response::json(['error' => 'No fue posible recuperar el trabajo con ese código.'], 429);
        }
        $code = (string) ($request->body['code'] ?? '');
        $articleId = $s['recovery']->use('HUMAN_CODE', $code) ?? $s['recovery']->use('TEMPORARY_CODE', $code);
        $s['recovery']->recordAttempt('CODE', $articleId !== null, false, $request);
        if (!$articleId) Response::json(['error' => 'No fue posible recuperar el trabajo con ese código.'], 401);
        $s['auth']->issueArticle($request, $articleId, true);
        Response::json(['article' => $s['articles']->get($articleId)]);
    });

    $router->add('GET', '/recover/{token}', static function (Request $request) use ($s): void {
        $limited = $s['recovery']->limited('QR', $request->ip(), $s['config']->recoveryRateLimitMax, $s['config']->recoveryRateLimitWindowMinutes);
        $articleId = $limited ? null : $s['recovery']->use('QR_TOKEN', $request->params['token']);
        $s['recovery']->recordAttempt('QR', $articleId !== null, $limited, $request);
        if (!$articleId) Response::redirect($s['config']->publicAppUrl . '/?recovery=failed');
        $s['auth']->issueArticle($request, $articleId, true);
        Response::redirect($s['config']->publicAppUrl . '/?article=' . rawurlencode($articleId) . '&recovered=qr');
    });
};
