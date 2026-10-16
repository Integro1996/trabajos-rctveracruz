<?php
declare(strict_types=1);

namespace Trabajos\Lib;

use RuntimeException;
use Throwable;

final class ApiException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 400, public readonly array $details = [])
    {
        parent::__construct($message);
    }
}

final class Request
{
    public array $params = [];
    public readonly string $method;
    public readonly string $path;
    public readonly array $query;
    public readonly array $cookies;
    public readonly array $body;
    private array $headers;
    private string $remoteAddress;

    public function __construct(?array $server = null, ?string $rawBody = null, private readonly bool $trustProxy = false)
    {
        $server ??= $_SERVER;
        $this->remoteAddress = (string) ($server['REMOTE_ADDR'] ?? '');
        $this->method = strtoupper($server['REQUEST_METHOD'] ?? 'GET');
        $this->path = rawurldecode(parse_url($server['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
        $this->query = $_GET;
        $this->cookies = $_COOKIE;
        $this->headers = [];
        foreach ($server as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $this->headers[$name] = (string) $value;
            }
        }
        if (isset($server['CONTENT_TYPE'])) $this->headers['content-type'] = (string) $server['CONTENT_TYPE'];
        $rawBody ??= file_get_contents('php://input') ?: '';
        $decoded = $rawBody === '' ? [] : json_decode($rawBody, true);
        if ($rawBody !== '' && !is_array($decoded)) throw new ApiException('El cuerpo JSON no es válido.', 400);
        $this->body = $decoded ?: [];
    }

    public function header(string $name): string
    {
        return $this->headers[strtolower($name)] ?? '';
    }

    public function ip(): string
    {
        $forwarded = $this->header('x-forwarded-for');
        $value = $this->trustProxy && $forwarded !== '' ? trim(explode(',', $forwarded)[0]) : $this->remoteAddress;
        if (filter_var($value, FILTER_VALIDATE_IP) === false) $value = '';
        return substr($value, 0, 64);
    }

    public function userAgent(): string
    {
        return mb_substr($this->header('user-agent'), 0, 500);
    }
}

final class Response
{
    public static function json(mixed $value, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        exit;
    }

    public static function empty(int $status = 204): never
    {
        http_response_code($status);
        exit;
    }

    public static function redirect(string $url, int $status = 303): never
    {
        header('Location: ' . $url, true, $status);
        exit;
    }

    public static function binary(string $contents, string $contentType, string $disposition = 'inline'): never
    {
        header('Content-Type: ' . $contentType);
        header('Content-Length: ' . strlen($contents));
        header('Content-Disposition: ' . $disposition);
        header('Cache-Control: no-store');
        echo $contents;
        exit;
    }
}

final class Router
{
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $names = [];
        $regex = preg_replace_callback('/\{([A-Za-z][A-Za-z0-9_]*)\}/', static function (array $match) use (&$names): string {
            $names[] = $match[1];
            return '([^/]+)';
        }, $pattern);
        $this->routes[] = [$method, '#^' . $regex . '$#', $names, $handler];
    }

    public function dispatch(Request $request): void
    {
        foreach ($this->routes as [$method, $regex, $names, $handler]) {
            if ($request->method !== $method || !preg_match($regex, $request->path, $matches)) continue;
            array_shift($matches);
            $request->params = array_combine($names, array_map('rawurldecode', $matches)) ?: [];
            $handler($request);
            return;
        }
        throw new ApiException('Ruta de trabajos no encontrada.', 404);
    }
}

function handleException(Throwable $error, string $environment): never
{
    $status = $error instanceof ApiException ? $error->status : 500;
    if ($status >= 500) error_log('[trabajos-api] ' . $error);
    $payload = ['error' => $status === 500 ? 'No fue posible completar la operación.' : $error->getMessage()];
    if ($error instanceof ApiException && $error->details) $payload['details'] = $error->details;
    if ($environment === 'development') $payload['technicalDetail'] = $error->getMessage();
    Response::json($payload, $status);
}
