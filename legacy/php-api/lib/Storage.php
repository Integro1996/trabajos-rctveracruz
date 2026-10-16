<?php
declare(strict_types=1);

namespace Trabajos\Lib;

use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use Trabajos\Config\Config;

final class Storage
{
    private string $root;

    public function __construct(private readonly Config $config)
    {
        $this->root = rtrim(str_replace('\\', '/', $config->storagePath), '/');
        if ($this->root === '') throw new RuntimeException('STORAGE_PATH no es válido.');
        if (!is_dir($this->root) && !mkdir($this->root, 0700, true) && !is_dir($this->root)) throw new RuntimeException('No fue posible crear STORAGE_PATH.');
    }

    public function putDocx(string $path, string $contents): void
    {
        if (!str_ends_with($path, '.docx') || $contents === '' || strlen($contents) > $this->config->maxDocxBytes) throw new ApiException('El DOCX está vacío o supera el límite permitido.', 422);
        $this->atomicWrite($path, $contents);
    }

    public function getDocx(string $path): string
    {
        if (!str_ends_with($path, '.docx')) throw new ApiException('Ruta DOCX no permitida.', 400);
        return $this->read($path, $this->config->maxDocxBytes);
    }

    public function putAsset(string $path, string $contents, string $mime): void
    {
        if (!preg_match('#/assets/[0-9a-f-]+\.(?:png|jpg)$#i', $path) || !in_array($mime, ['image/png', 'image/jpeg'], true) || $contents === '' || strlen($contents) > Validation::MAX_IMAGE_BYTES) {
            throw new ApiException('La imagen no es válida o supera 8 MB.', 422);
        }
        $this->atomicWrite($path, $contents);
    }

    public function getAsset(string $path): string { return $this->read($path, Validation::MAX_IMAGE_BYTES); }

    public function remove(string $path): void
    {
        $file = $this->resolve($path);
        if (is_file($file) && !unlink($file)) throw new RuntimeException('No fue posible eliminar el archivo.');
    }

    public function removeArticle(string $articleId): void
    {
        if (!Validation::isUuid($articleId)) throw new ApiException('Identificador de artículo no permitido.', 400);
        $directory = $this->resolve('articles/' . $articleId);
        if (!is_dir($directory)) return;
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($iterator as $item) $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
        rmdir($directory);
    }

    public function healthy(): bool
    {
        $path = 'articles/.health-' . Security::uuid();
        $this->atomicWrite($path, 'ok');
        $this->remove($path);
        return true;
    }

    private function read(string $path, int $maxBytes): string
    {
        $file = $this->resolve($path);
        $size = is_file($file) ? filesize($file) : false;
        if ($size === false || $size < 1 || $size > $maxBytes) throw new ApiException('El archivo solicitado no está disponible.', 404);
        $contents = file_get_contents($file);
        if ($contents === false) throw new RuntimeException('No fue posible leer el archivo.');
        return $contents;
    }

    private function atomicWrite(string $path, string $contents): void
    {
        $destination = $this->resolve($path);
        $directory = dirname($destination);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('No fue posible crear el directorio privado.');
        $temporary = $destination . '.' . Security::uuid() . '.tmp';
        if (file_put_contents($temporary, $contents, LOCK_EX) === false) throw new RuntimeException('No fue posible guardar el archivo.');
        @chmod($temporary, 0600);
        if (!rename($temporary, $destination)) { @unlink($temporary); throw new RuntimeException('No fue posible completar el guardado atómico.'); }
    }

    private function resolve(string $relative): string
    {
        $relative = str_replace('\\', '/', $relative);
        if (!str_starts_with($relative, 'articles/') || str_contains($relative, '..') || str_starts_with($relative, '/')) throw new ApiException('Ruta de almacenamiento no permitida.', 400);
        return str_replace('/', DIRECTORY_SEPARATOR, $this->root . '/' . $relative);
    }
}
