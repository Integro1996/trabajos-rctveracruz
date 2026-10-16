<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/Http.php';
require_once __DIR__ . '/../lib/Security.php';
require_once __DIR__ . '/../lib/Validation.php';
require_once __DIR__ . '/../lib/Docx.php';
$vendor = __DIR__ . '/../vendor/autoload.php';
if (is_file($vendor)) require_once $vendor;

use Trabajos\Lib\ApiException;
use Trabajos\Lib\Docx;
use Trabajos\Lib\Request;
use Trabajos\Lib\Security;
use Trabajos\Lib\Validation;

$tests = 0;
$assert = static function (bool $condition, string $message) use (&$tests): void {
    $tests++;
    if (!$condition) throw new RuntimeException($message);
};

$assert((bool) preg_match('/^ART-[A-HJ-KM-NP-Z2-9]{6}$/', Security::reference()), 'Referencia inválida');
$assert((bool) preg_match('/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{2}$/', Security::recoveryCode()), 'Código inválido');
$assert(Security::normalizeCode('abcd efgh 23') === 'ABCD-EFGH-23', 'Normalización inválida');
$hash = Security::hashSecret('secreto');
$assert(Security::verifySecret('secreto', $hash) && !Security::verifySecret('otro', $hash), 'password_hash/password_verify falló');
$legacyHash = 'scrypt$16384$8$1$ABEiM0RVZneImaq7zN3u_w$SQStMTyNz-Rm47q6_vJHHS9bzHsNTYk9XrbFdmbIxcE';
$assert(Security::verifySecret('legacy-secret', $legacyHash) && Security::secretNeedsRehash($legacyHash), 'Compatibilidad scrypt de Node fallo');
$assert(!Security::verifySecret('wrong-secret', $legacyHash), 'scrypt acepto una clave incorrecta');
$assert(!Security::verifySecret('legacy-secret', str_replace('16384', '1073741824', $legacyHash)), 'scrypt acepto parametros fuera de limite');
$assert(!Security::verifySecret('legacy-secret', 'scrypt$16384$8$1$AA$AA'), 'scrypt acepto longitudes invalidas');
$server = ['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/', 'REMOTE_ADDR' => '192.0.2.10', 'HTTP_X_FORWARDED_FOR' => '198.51.100.20'];
$assert((new Request($server, '', false))->ip() === '192.0.2.10', 'Se confio en un proxy sin habilitarlo');
$assert((new Request($server, '', true))->ip() === '198.51.100.20', 'No se acepto el proxy configurado');
$jwt = Security::jwtEncode(['purpose' => 'test'], 'jwt-secret', 60);
$assert(Security::jwtDecode($jwt, 'jwt-secret')['purpose'] === 'test', 'JWT HS256 falló');

$content = Validation::article([
    'title' => 'Título válido',
    'authors' => [['firstName' => 'Ana', 'lastName' => 'Pérez', 'email' => 'ana@example.test', 'institution' => 'INIFAP', 'orcid' => '', 'isCorresponding' => true]],
    'keywords' => ['frutales', 'Algas verdes'],
    'introduction' => 'Uno dos',
    'blocks' => [
        ['id' => Security::uuid(), 'type' => 'text', 'text' => 'Tres cuatro'],
        ['id' => Security::uuid(), 'type' => 'figure', 'assetId' => Security::uuid(), 'caption' => 'Pie excluido'],
        ['id' => Security::uuid(), 'type' => 'table', 'caption' => 'Tabla excluida', 'cells' => [['Celda excluida']]],
    ],
]);
$assert(Validation::bodyWordCount($content) === 5, 'Conteo narrativo incorrecto');
$assert(count(Validation::keywords('frutales, Algas verdes')) === 2, 'Keywords incorrectas');

$rejected = false;
try { Validation::article(array_replace($content, ['title' => str_repeat('palabra ', 13)])); } catch (ApiException) { $rejected = true; }
$assert($rejected, 'No se rechazó el título largo');

$docx = Docx::createBody($content);
Docx::validate($docx, 20 * 1024 * 1024);
$text = Docx::extractText($docx);
$assert(str_contains($text, 'Introducción') && str_contains($text, 'Figura 1.') && str_contains($text, 'Tabla 1.'), 'Falta cuerpo en DOCX');
$assert(!str_contains($text, 'Título válido') && !str_contains($text, 'Ana Pérez') && !str_contains($text, 'Palabras clave'), 'El DOCX contiene metadata');
if (class_exists(chillerlan\QRCode\QRCode::class)) {
    $qr = (new chillerlan\QRCode\QRCode())->render('https://trabajos.rctveracruz.org/recover/token-de-prueba');
    $assert(str_starts_with($qr, 'data:image/svg+xml;base64,'), 'El QR no produjo un data URI SVG');
}

echo json_encode(['ok' => true, 'assertions' => $tests], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
