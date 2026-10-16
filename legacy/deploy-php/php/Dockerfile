FROM php:8.3-fpm-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libcurl4-openssl-dev libxml2-dev libonig-dev libzip-dev unzip libfcgi-bin \
    && docker-php-ext-install -j"$(nproc)" curl dom mbstring pdo_mysql zip opcache \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
RUN pecl install scrypt-2.0.1 && docker-php-ext-enable scrypt
WORKDIR /srv/app/api
COPY api/composer.json api/composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader
COPY api/ ./
COPY deploy/php/production.ini /usr/local/etc/php/conf.d/production.ini
COPY deploy/php/pool.conf /usr/local/etc/php-fpm.d/zz-app.conf
RUN mkdir -p /srv/private && chown www-data:www-data /srv/private
USER www-data
CMD ["php-fpm", "-F"]
