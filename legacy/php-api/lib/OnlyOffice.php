<?php
declare(strict_types=1);

namespace Trabajos\Lib;

use RuntimeException;
use Trabajos\Config\Config;

final class OnlyOffice
{
    public function __construct(private readonly Config $config, private readonly Storage $storage) {}

    public function editorConfig(array $article, array $user = ['id' => 'trabajos-user', 'name' => 'Autor del trabajo'], bool $editable = true): array
    {
        $downloadToken = Security::jwtEncode(['purpose' => 'document-download', 'articleId' => $article['id'], 'documentKey' => $article['documentKey']], $this->config->documentTokenSecret, 7200);
        $editor = [
            'document' => [
                'fileType' => 'docx', 'key' => $article['documentKey'], 'title' => ArticleService::safeFilename($article['title']),
                'url' => $this->config->onlyofficeCallbackBaseUrl . '/api/documents/' . $article['id'] . '/file?token=' . rawurlencode($downloadToken),
                'permissions' => ['chat' => false, 'comment' => false, 'copy' => true, 'download' => true, 'edit' => $editable, 'print' => true, 'review' => false],
            ],
            'documentType' => 'word',
            'editorConfig' => [
                'lang' => 'es', 'mode' => $editable ? 'edit' : 'view',
                'callbackUrl' => $this->config->onlyofficeCallbackBaseUrl . '/api/onlyoffice/callback/' . $article['id'],
                'user' => $user,
                'customization' => ['feedback' => false, 'help' => true, 'hideRightMenu' => true, 'anonymous' => ['request' => false, 'label' => 'Vista previa']],
            ],
            'type' => 'desktop',
        ];
        $editor['token'] = Security::jwtEncode($editor, $this->config->onlyofficeJwtSecret, 7200);
        return ['documentServerUrl' => $this->config->onlyofficePublicUrl, 'config' => $editor];
    }

    public function verifyCallback(Request $request): array
    {
        $authorization = $request->header('authorization');
        $token = preg_match('/^Bearer\s+(.+)$/i', $authorization, $match) ? $match[1] : (string) ($request->body['token'] ?? '');
        if ($token === '') throw new ApiException('Callback sin JWT.', 401);
        $decoded = Security::jwtDecode($token, $this->config->onlyofficeJwtSecret);
        $candidate = isset($decoded['payload']) && is_array($decoded['payload']) ? $decoded['payload'] : $decoded;
        if (isset($candidate['key']) && !hash_equals((string) $candidate['key'], (string) ($request->body['key'] ?? ''))) throw new ApiException('El document key del JWT no coincide.', 401);
        if (isset($candidate['status']) && (int) $candidate['status'] !== (int) ($request->body['status'] ?? -1)) throw new ApiException('El status del JWT no coincide.', 401);
        return $decoded;
    }

    public function countPages(array $article, string $storagePath, string $documentKey): int
    {
        $sourceToken = Security::jwtEncode(['purpose' => 'generation-source', 'articleId' => $article['id'], 'documentKey' => $documentKey, 'storagePath' => $storagePath], $this->config->documentTokenSecret, 600);
        $conversion = ['async' => false, 'filetype' => 'docx', 'key' => $documentKey, 'outputtype' => 'pdf', 'title' => ArticleService::safeFilename($article['title']), 'url' => $this->config->onlyofficeCallbackBaseUrl . '/api/documents/' . $article['id'] . '/file?token=' . rawurlencode($sourceToken)];
        $token = Security::jwtEncode($conversion, $this->config->onlyofficeJwtSecret, 600);
        $response = $this->request($this->config->onlyofficeInternalUrl . '/converter?shardkey=' . rawurlencode($documentKey), 'POST', json_encode(['token' => $token], JSON_THROW_ON_ERROR), ['Content-Type: application/json', 'Accept: application/json'], 60);
        if ($response['status'] < 200 || $response['status'] >= 300) throw new ApiException('No fue posible comprobar las páginas del documento.', 502);
        $result = json_decode($response['body'], true);
        if (!is_array($result) || !empty($result['error']) || empty($result['endConvert']) || empty($result['fileUrl'])) throw new ApiException('ONLYOFFICE no terminó la comprobación de páginas.', 502);
        $pdf = $this->downloadAllowed((string) $result['fileUrl'], 30, 30 * 1024 * 1024);
        preg_match_all('/\/Type\s*\/Page\b/', $pdf, $matches);
        $pages = count($matches[0]);
        if ($pages < 1) throw new ApiException('No fue posible determinar las páginas del PDF renderizado.', 502);
        return $pages;
    }

    public function downloadUpdated(string $url): string
    {
        if ($url === '') throw new ApiException('ONLYOFFICE no proporcionó el archivo actualizado.', 502);
        $contents = $this->downloadAllowed($url, 60, $this->config->maxDocxBytes);
        Docx::validate($contents, $this->config->maxDocxBytes);
        return $contents;
    }

    public function healthy(): bool
    {
        try { $response = $this->request($this->config->onlyofficeInternalUrl . '/healthcheck', 'GET', null, [], 5); return $response['status'] >= 200 && $response['status'] < 300; }
        catch (\Throwable) { return false; }
    }

    private function downloadAllowed(string $url, int $timeout, int $maxBytes): string
    {
        $current = $url;
        for ($redirects = 0; $redirects <= 3; $redirects++) {
            $safe = $this->allowedUrl($current);
            $response = $this->request($safe, 'GET', null, [], $timeout);
            if (in_array($response['status'], [301, 302, 303, 307, 308], true)) {
                $location = $response['headers']['location'] ?? '';
                if ($location === '') throw new ApiException('ONLYOFFICE devolvió una redirección sin destino.', 502);
                $current = $this->absoluteUrl($location, $current);
                continue;
            }
            if ($response['status'] < 200 || $response['status'] >= 300) throw new ApiException('No fue posible descargar el archivo de ONLYOFFICE.', 502);
            if ($response['body'] === '' || strlen($response['body']) > $maxBytes) throw new ApiException('El archivo de ONLYOFFICE supera el límite permitido.', 422);
            return $response['body'];
        }
        throw new ApiException('ONLYOFFICE devolvió demasiadas redirecciones.', 502);
    }

    private function allowedUrl(string $source): string
    {
        $parts = parse_url($source);
        if (!$parts || !isset($parts['scheme'], $parts['host'])) throw new ApiException('ONLYOFFICE devolvió una URL no válida.', 502);
        $origin = self::origin($source);
        $publicOrigin = self::origin($this->config->onlyofficePublicUrl);
        if ($origin !== $publicOrigin && !in_array($origin, $this->config->onlyofficeDownloadOrigins, true)) throw new ApiException('ONLYOFFICE devolvió una ubicación no permitida.', 502);
        if ($origin === $publicOrigin) {
            $internal = parse_url($this->config->onlyofficeInternalUrl);
            if (!$internal || !isset($internal['scheme'], $internal['host'])) throw new RuntimeException('ONLYOFFICE_INTERNAL_URL no es válida.');
            $parts['scheme'] = $internal['scheme']; $parts['host'] = $internal['host'];
            if (isset($internal['port'])) $parts['port'] = $internal['port']; else unset($parts['port']);
        } elseif (($parts['scheme'] ?? '') !== 'https') {
            throw new ApiException('La descarga externa de ONLYOFFICE debe usar HTTPS.', 502);
        }
        return self::buildUrl($parts);
    }

    private function request(string $url, string $method, ?string $body, array $headers, int $timeout): array
    {
        $responseHeaders = [];
        $curl = curl_init($url);
        if ($curl === false) throw new RuntimeException('No fue posible inicializar cURL.');
        curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => min(10, $timeout), CURLOPT_TIMEOUT => $timeout, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$responseHeaders): int {
            $index = strpos($line, ':');
            if ($index !== false) $responseHeaders[strtolower(trim(substr($line, 0, $index)))] = trim(substr($line, $index + 1));
            return strlen($line);
        }]);
        if ($body !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        $responseBody = curl_exec($curl);
        if ($responseBody === false) { $message = curl_error($curl); curl_close($curl); throw new ApiException('Falló la comunicación con ONLYOFFICE: ' . $message, 502); }
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return ['status' => $status, 'headers' => $responseHeaders, 'body' => (string) $responseBody];
    }

    private function absoluteUrl(string $location, string $base): string
    {
        if (preg_match('#^https?://#i', $location)) return $location;
        $parts = parse_url($base);
        if (!$parts || !isset($parts['scheme'], $parts['host'])) throw new ApiException('Redirección inválida.', 502);
        $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        if (str_starts_with($location, '/')) return $origin . $location;
        return $origin . rtrim(dirname($parts['path'] ?? '/'), '/\\') . '/' . $location;
    }

    private static function origin(string $url): string
    {
        $parts = parse_url($url);
        return strtolower(($parts['scheme'] ?? '') . '://' . ($parts['host'] ?? '')) . (isset($parts['port']) ? ':' . $parts['port'] : '');
    }

    private static function buildUrl(array $parts): string
    {
        return $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '') . ($parts['path'] ?? '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');
    }
}
