<?php
declare(strict_types=1);

use Trabajos\Lib\Application;

require_once __DIR__ . '/autoload.php';
$services = Application::services();
Application::headers($services['config']);
return $services;
