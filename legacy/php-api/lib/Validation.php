<?php
declare(strict_types=1);

namespace Trabajos\Lib;

final class Validation
{
    public const TITLE_WORDS = 12;
    public const TITLE_CHARACTERS = 50;
    public const KEYWORDS = 7;
    public const MAX_PAGES = 3;
    public const MAX_WORDS = 250;
    public const MAX_BLOCKS = 100;
    public const MAX_IMAGE_BYTES = 8388608;
    public const MAX_TABLE_ROWS = 50;
    public const MAX_TABLE_COLUMNS = 10;

    public static function normalizeSpaces(string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', $value) ?: '');
    }

    public static function countWords(string $value): int
    {
        $normalized = self::normalizeSpaces($value);
        return $normalized === '' ? 0 : count(preg_split('/\s+/u', $normalized) ?: []);
    }

    public static function keywords(mixed $value): array
    {
        $parts = is_array($value) ? $value : explode(',', (string) $value);
        $result = [];
        $seen = [];
        foreach ($parts as $part) {
            $keyword = self::normalizeSpaces((string) $part);
            $key = mb_strtolower($keyword, 'UTF-8');
            if ($keyword !== '' && !isset($seen[$key])) {
                $seen[$key] = true;
                $result[] = $keyword;
            }
        }
        return $result;
    }

    public static function article(array $input): array
    {
        $errors = [];
        $title = self::normalizeSpaces((string) ($input['title'] ?? ''));
        if ($title === '') $errors[] = 'El título es obligatorio.';
        if (self::countWords($title) > self::TITLE_WORDS) $errors[] = 'El título supera las 12 palabras.';
        if (mb_strlen($title, 'UTF-8') > self::TITLE_CHARACTERS) $errors[] = 'El título supera los 50 caracteres.';

        $authors = $input['authors'] ?? null;
        if (!is_array($authors) || count($authors) < 1 || count($authors) > 30) $errors[] = 'Debe existir al menos un autor.';
        $normalizedAuthors = [];
        foreach (is_array($authors) ? $authors : [] as $author) {
            if (!is_array($author)) { $errors[] = 'Los datos de un autor no son válidos.'; continue; }
            $firstName = trim((string) ($author['firstName'] ?? ''));
            $lastName = trim((string) ($author['lastName'] ?? ''));
            $email = trim((string) ($author['email'] ?? ''));
            $institution = trim((string) ($author['institution'] ?? ''));
            $orcid = trim((string) ($author['orcid'] ?? ''));
            if ($firstName === '' || mb_strlen($firstName) > 120) $errors[] = 'El nombre del autor es obligatorio.';
            if ($lastName === '' || mb_strlen($lastName) > 160) $errors[] = 'Los apellidos del autor son obligatorios.';
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 190) $errors[] = 'El correo no es válido.';
            if ($institution === '' || mb_strlen($institution) > 255) $errors[] = 'La institución es obligatoria.';
            if ($orcid !== '' && !preg_match('/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i', $orcid)) $errors[] = 'El ORCID debe tener el formato 0000-0000-0000-000X.';
            $normalizedAuthors[] = compact('firstName', 'lastName', 'email', 'institution', 'orcid') + ['isCorresponding' => (bool) ($author['isCorresponding'] ?? false)];
        }

        $keywords = self::keywords($input['keywords'] ?? []);
        if (count($keywords) > self::KEYWORDS) $errors[] = 'Se permiten máximo 7 palabras clave.';
        foreach ($keywords as $keyword) if (mb_strlen($keyword) > 120) $errors[] = 'Una palabra clave es demasiado extensa.';

        $introduction = (string) ($input['introduction'] ?? '');
        if (mb_strlen($introduction) > 500000) $errors[] = 'La introducción supera el máximo técnico permitido.';
        $blocks = $input['blocks'] ?? null;
        if (!is_array($blocks) || count($blocks) > self::MAX_BLOCKS) $errors[] = 'La lista de bloques no es válida.';
        $normalizedBlocks = [];
        $ids = [];
        foreach (is_array($blocks) ? $blocks : [] as $block) {
            if (!is_array($block) || !self::isUuid((string) ($block['id'] ?? ''))) { $errors[] = 'El bloque no tiene un identificador válido.'; continue; }
            $id = (string) $block['id'];
            if (isset($ids[$id])) $errors[] = 'Hay bloques duplicados en el artículo.';
            $ids[$id] = true;
            $type = (string) ($block['type'] ?? '');
            if ($type === 'text') {
                $text = (string) ($block['text'] ?? '');
                if (mb_strlen($text) > 100000) $errors[] = 'El bloque de texto es demasiado extenso.';
                $normalizedBlocks[] = compact('id', 'type', 'text');
            } elseif ($type === 'figure') {
                $assetId = (string) ($block['assetId'] ?? '');
                $caption = trim((string) ($block['caption'] ?? ''));
                if (!self::isUuid($assetId)) $errors[] = 'La imagen seleccionada no es válida.';
                if (mb_strlen($caption) > 500) $errors[] = 'La descripción no puede superar 500 caracteres.';
                $normalizedBlocks[] = compact('id', 'type', 'assetId', 'caption');
            } elseif ($type === 'table') {
                $caption = trim((string) ($block['caption'] ?? ''));
                $cells = $block['cells'] ?? [];
                $rows = is_array($cells) ? count($cells) : 0;
                $columns = $rows && is_array($cells[0]) ? count($cells[0]) : 0;
                if ($rows < 1 || $rows > self::MAX_TABLE_ROWS || $columns < 1 || $columns > self::MAX_TABLE_COLUMNS) $errors[] = 'Las dimensiones de la tabla no son válidas.';
                foreach (is_array($cells) ? $cells : [] as $row) {
                    if (!is_array($row) || count($row) !== $columns) { $errors[] = 'Todas las filas de una tabla deben tener el mismo número de columnas.'; continue; }
                    foreach ($row as $cell) if (mb_strlen((string) $cell) > 1000) $errors[] = 'Una celda supera 1,000 caracteres.';
                }
                if (mb_strlen($caption) > 500) $errors[] = 'La descripción no puede superar 500 caracteres.';
                $normalizedBlocks[] = compact('id', 'type', 'caption', 'cells');
            } else {
                $errors[] = 'El tipo de bloque no es válido.';
            }
        }

        if ($errors) throw new ApiException('El contenido del artículo no es válido.', 422, array_values(array_unique($errors)));
        return ['title' => $title, 'authors' => $normalizedAuthors, 'keywords' => $keywords, 'introduction' => $introduction, 'blocks' => $normalizedBlocks];
    }

    public static function finalErrors(array $article): array
    {
        $errors = [];
        if (self::normalizeSpaces((string) ($article['introduction'] ?? '')) === '') $errors[] = 'La introducción es obligatoria.';
        $hasText = false;
        foreach ($article['blocks'] ?? [] as $index => $block) {
            if (($block['type'] ?? '') === 'text' && self::normalizeSpaces((string) ($block['text'] ?? '')) !== '') $hasText = true;
            if (in_array($block['type'] ?? '', ['figure', 'table'], true) && self::normalizeSpaces((string) ($block['caption'] ?? '')) === '') $errors[] = 'El bloque ' . ($index + 1) . ' necesita una descripción.';
        }
        if (!$hasText) $errors[] = 'Agrega al menos un bloque de texto al cuerpo del artículo.';
        return $errors;
    }

    public static function bodyWordCount(array $article): int
    {
        $text = ['Introducción', (string) ($article['introduction'] ?? '')];
        foreach ($article['blocks'] ?? [] as $block) if (($block['type'] ?? '') === 'text') $text[] = (string) ($block['text'] ?? '');
        return self::countWords(implode(' ', $text));
    }

    public static function isUuid(string $value): bool
    {
        return (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value);
    }
}
