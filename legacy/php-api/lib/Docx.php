<?php
declare(strict_types=1);

namespace Trabajos\Lib;

use DOMDocument;
use DOMXPath;
use RuntimeException;
use ZipArchive;

final class Docx
{
    public static function createBody(array $article, array $assets = []): string
    {
        if (!class_exists(ZipArchive::class)) throw new RuntimeException('La extensión PHP zip es obligatoria para generar DOCX.');
        $body = [self::paragraph('Introducción', 'Heading1')];
        foreach (preg_split('/\r\n?|\n/u', (string) ($article['introduction'] ?? '')) ?: [''] as $line) $body[] = self::paragraph($line);
        $relationships = [];
        $media = [];
        $figure = 0;
        $table = 0;

        foreach ($article['blocks'] ?? [] as $block) {
            if (($block['type'] ?? '') === 'text') {
                foreach (preg_split('/\r\n?|\n/u', (string) ($block['text'] ?? '')) ?: [''] as $line) $body[] = self::paragraph($line);
            } elseif (($block['type'] ?? '') === 'figure') {
                $figure++;
                $asset = $assets[$block['assetId']] ?? null;
                if ($asset) {
                    $index = count($media) + 1;
                    $extension = ($asset['mimeType'] ?? '') === 'image/png' ? 'png' : 'jpg';
                    $media[] = ['name' => "image{$index}.{$extension}", 'contents' => $asset['buffer']];
                    $relationships[] = ['id' => 'rId' . $index, 'target' => 'media/image' . $index . '.' . $extension];
                    $body[] = self::image('rId' . $index, $index, (int) $asset['width'], (int) $asset['height']);
                } else {
                    $body[] = self::paragraph('[Imagen no disponible]', null, 'center');
                }
                $body[] = self::caption('Figura', $figure, (string) ($block['caption'] ?? ''));
            } elseif (($block['type'] ?? '') === 'table') {
                $table++;
                $body[] = self::table(is_array($block['cells'] ?? null) ? $block['cells'] : [['']]);
                $body[] = self::caption('Tabla', $table, (string) ($block['caption'] ?? ''));
            }
        }

        $document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            . '<w:body>' . implode('', $body)
            . '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="1020" w:bottom="850" w:left="1020" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';

        $types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            . '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>'
            . '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            . '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            . '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            . '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
        $rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
        $docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . implode('', array_map(static fn (array $rel): string => '<Relationship Id="' . $rel['id'] . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' . $rel['target'] . '"/>', $relationships))
            . '</Relationships>';
        $styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:color w:val="182D64"/><w:sz w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="18"/></w:rPr></w:style></w:styles>';
        $now = gmdate('Y-m-d\TH:i:s\Z');
        $core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>RCT Veracruz</dc:creator><dc:title>Cuerpo del trabajo</dc:title><dc:description>Cuerpo editable; la metadata permanece en la aplicación.</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">' . $now . '</dcterms:created></cp:coreProperties>';
        $app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Trabajos RCT Veracruz PHP</Application></Properties>';

        $temporary = tempnam(sys_get_temp_dir(), 'trabajos-docx-');
        if ($temporary === false) throw new RuntimeException('No fue posible crear el DOCX temporal.');
        $zip = new ZipArchive();
        if ($zip->open($temporary, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('No fue posible abrir el DOCX temporal.');
        $zip->addFromString('[Content_Types].xml', $types);
        $zip->addFromString('_rels/.rels', $rootRels);
        $zip->addFromString('word/document.xml', $document);
        $zip->addFromString('word/styles.xml', $styles);
        $zip->addFromString('word/_rels/document.xml.rels', $docRels);
        $zip->addFromString('docProps/core.xml', $core);
        $zip->addFromString('docProps/app.xml', $app);
        foreach ($media as $item) $zip->addFromString('word/media/' . $item['name'], $item['contents']);
        $zip->close();
        $contents = file_get_contents($temporary);
        @unlink($temporary);
        if ($contents === false) throw new RuntimeException('No fue posible leer el DOCX generado.');
        return $contents;
    }

    public static function extractText(string $contents): string
    {
        $xml = self::documentXml($contents);
        $dom = new DOMDocument();
        if (!@$dom->loadXML($xml, LIBXML_NONET | LIBXML_NOBLANKS)) throw new ApiException('El DOCX no contiene XML válido.', 422);
        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main');
        $parts = [];
        foreach ($xpath->query('//w:t') ?: [] as $node) $parts[] = $node->textContent;
        return implode(' ', $parts);
    }

    public static function validate(string $contents, int $maxBytes): void
    {
        if ($contents === '' || strlen($contents) > $maxBytes || !str_starts_with($contents, "PK")) throw new ApiException('El DOCX actualizado no es válido.', 422);
        self::documentXml($contents);
    }

    private static function documentXml(string $contents): string
    {
        if (!class_exists(ZipArchive::class)) throw new RuntimeException('La extensión PHP zip es obligatoria para procesar DOCX.');
        $temporary = tempnam(sys_get_temp_dir(), 'trabajos-read-');
        if ($temporary === false || file_put_contents($temporary, $contents) === false) throw new RuntimeException('No fue posible inspeccionar el DOCX.');
        $zip = new ZipArchive();
        if ($zip->open($temporary) !== true) { @unlink($temporary); throw new ApiException('El archivo no es un DOCX válido.', 422); }
        $xml = $zip->getFromName('word/document.xml');
        $zip->close();
        @unlink($temporary);
        if (!is_string($xml) || $xml === '') throw new ApiException('El DOCX no contiene el documento principal.', 422);
        return $xml;
    }

    private static function paragraph(string $text, ?string $style = null, string $alignment = 'both'): string
    {
        $properties = '<w:pPr>' . ($style ? '<w:pStyle w:val="' . self::xml($style) . '"/>' : '') . '<w:jc w:val="' . self::xml($alignment) . '"/><w:spacing w:after="100" w:line="260" w:lineRule="auto"/></w:pPr>';
        return '<w:p>' . $properties . ($text === '' ? '' : '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">' . self::xml($text) . '</w:t></w:r>') . '</w:p>';
    }

    private static function caption(string $kind, int $number, string $text): string
    {
        return '<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/><w:spacing w:before="80" w:after="220"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>' . self::xml("{$kind} {$number}. ") . '</w:t></w:r><w:r><w:t xml:space="preserve">' . self::xml(trim($text)) . '</w:t></w:r></w:p>';
    }

    private static function table(array $rows): string
    {
        $xml = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="7B879D"/><w:left w:val="single" w:sz="4" w:color="7B879D"/><w:bottom w:val="single" w:sz="4" w:color="7B879D"/><w:right w:val="single" w:sz="4" w:color="7B879D"/><w:insideH w:val="single" w:sz="2" w:color="C9D1DE"/><w:insideV w:val="single" w:sz="2" w:color="C9D1DE"/></w:tblBorders></w:tblPr>';
        foreach ($rows as $rowIndex => $row) {
            $xml .= '<w:tr>' . ($rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
            foreach ((array) $row as $value) $xml .= '<w:tc><w:tcPr><w:tcMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r>' . ($rowIndex === 0 ? '<w:rPr><w:b/></w:rPr>' : '') . '<w:t xml:space="preserve">' . self::xml((string) $value) . '</w:t></w:r></w:p></w:tc>';
            $xml .= '</w:tr>';
        }
        return $xml . '</w:tbl>';
    }

    private static function image(string $relationshipId, int $id, int $width, int $height): string
    {
        $scale = min(520 / max(1, $width), 310 / max(1, $height), 1);
        $cx = (int) round(max(1, $width * $scale) * 9525);
        $cy = (int) round(max(1, $height * $scale) * 9525);
        return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' . $cx . '" cy="' . $cy . '"/><wp:docPr id="' . $id . '" name="Figura ' . $id . '"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' . $id . '" name="Imagen ' . $id . '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' . self::xml($relationshipId) . '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' . $cx . '" cy="' . $cy . '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }

    private static function xml(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
