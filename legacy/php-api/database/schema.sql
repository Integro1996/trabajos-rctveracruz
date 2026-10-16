-- Ejecutar manualmente sólo sobre la base autorizada. No modifica tablas históricas de RCT.
CREATE TABLE IF NOT EXISTS trabajos_articles (
  id CHAR(36) PRIMARY KEY, public_reference VARCHAR(16) NULL, title VARCHAR(50) NOT NULL DEFAULT 'Artículo experimental',
  introduction LONGTEXT NOT NULL, body_word_count INT NOT NULL DEFAULT 0, body_count_note TEXT NULL,
  status ENUM('draft','requires_changes','finalized') NOT NULL DEFAULT 'draft', document_key VARCHAR(128) NOT NULL,
  document_storage_path VARCHAR(512) NOT NULL, page_count INT NULL, generated_at DATETIME(3) NULL,
  content_revision INT NOT NULL DEFAULT 1, generated_revision INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), last_document_saved_at DATETIME(3) NULL,
  UNIQUE KEY uq_trabajos_articles_public_reference (public_reference), UNIQUE KEY uq_trabajos_articles_document_key (document_key), KEY idx_trabajos_articles_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_article_assets (
  id CHAR(36) PRIMARY KEY, article_id CHAR(36) NOT NULL, storage_path VARCHAR(512) NOT NULL, mime_type VARCHAR(32) NOT NULL,
  original_name VARCHAR(255) NOT NULL, width INT NOT NULL, height INT NOT NULL, byte_size INT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_trabajos_assets_storage_path (storage_path), KEY idx_trabajos_assets_article (article_id, created_at),
  CONSTRAINT fk_trabajos_assets_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_article_blocks (
  id CHAR(36) PRIMARY KEY, article_id CHAR(36) NOT NULL, type ENUM('text','figure','table') NOT NULL, position INT NOT NULL,
  text_content LONGTEXT NULL, caption TEXT NULL, asset_id CHAR(36) NULL, table_data JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_trabajos_blocks_position (article_id, position),
  CONSTRAINT fk_trabajos_blocks_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE,
  CONSTRAINT fk_trabajos_blocks_asset FOREIGN KEY (asset_id) REFERENCES trabajos_article_assets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_authors (
  id CHAR(36) PRIMARY KEY, article_id CHAR(36) NOT NULL, first_name VARCHAR(120) NOT NULL, last_name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL, institution VARCHAR(255) NOT NULL, orcid VARCHAR(19) NOT NULL DEFAULT '', is_corresponding TINYINT(1) NOT NULL DEFAULT 0, position INT NOT NULL,
  UNIQUE KEY uq_trabajos_authors_position (article_id, position), CONSTRAINT fk_trabajos_authors_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_keywords (
  id CHAR(36) PRIMARY KEY, article_id CHAR(36) NOT NULL, value VARCHAR(120) NOT NULL, position INT NOT NULL,
  UNIQUE KEY uq_trabajos_keywords_position (article_id, position), CONSTRAINT fk_trabajos_keywords_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_document_versions (
  id CHAR(36) PRIMARY KEY, article_id CHAR(36) NOT NULL, version INT NOT NULL, document_key VARCHAR(128) NOT NULL, storage_path VARCHAR(512) NOT NULL,
  word_count INT NOT NULL DEFAULT 0, content_snapshot JSON NULL, page_count INT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_trabajos_versions_article (article_id, version), KEY idx_trabajos_versions_article (article_id, version),
  CONSTRAINT fk_trabajos_versions_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_callbacks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, article_id CHAR(36) NULL, received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  onlyoffice_status INT NULL, document_key VARCHAR(128) NULL, result VARCHAR(24) NOT NULL, detail TEXT NULL,
  KEY idx_trabajos_callbacks_article (article_id, received_at), CONSTRAINT fk_trabajos_callbacks_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_article_sessions (
  id CHAR(36) PRIMARY KEY, article_id CHAR(36) NOT NULL, session_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL, user_agent VARCHAR(500) NULL, ip_address VARCHAR(64) NULL,
  UNIQUE KEY uq_trabajos_article_session (article_id, session_hash), KEY idx_trabajos_article_sessions_hash (session_hash, expires_at),
  CONSTRAINT fk_trabajos_article_sessions_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_recovery_credentials (
  id CHAR(36) PRIMARY KEY, article_id CHAR(36) NOT NULL, type ENUM('HUMAN_CODE','QR_TOKEN','TEMPORARY_CODE') NOT NULL,
  lookup_hash CHAR(64) NOT NULL, secret_hash TEXT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), expires_at DATETIME(3) NULL,
  max_uses INT NULL, use_count INT NOT NULL DEFAULT 0, revoked_at DATETIME(3) NULL,
  UNIQUE KEY uq_trabajos_recovery_lookup (lookup_hash), KEY idx_trabajos_recovery_article (article_id, type, revoked_at, expires_at),
  CONSTRAINT fk_trabajos_recovery_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_admin_users (
  id CHAR(36) PRIMARY KEY, name VARCHAR(160) NOT NULL, email VARCHAR(190) NOT NULL, password_hash TEXT NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), last_login_at DATETIME(3) NULL,
  UNIQUE KEY uq_trabajos_admin_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_admin_sessions (
  id CHAR(36) PRIMARY KEY, admin_id CHAR(36) NOT NULL, session_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL, user_agent VARCHAR(500) NULL, ip_address VARCHAR(64) NULL, UNIQUE KEY uq_trabajos_admin_session_hash (session_hash),
  CONSTRAINT fk_trabajos_admin_sessions_user FOREIGN KEY (admin_id) REFERENCES trabajos_admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_admin_document_grants (
  id CHAR(36) PRIMARY KEY, admin_session_id CHAR(36) NOT NULL, article_id CHAR(36) NOT NULL, reason TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), expires_at DATETIME(3) NOT NULL, revoked_at DATETIME(3) NULL,
  KEY idx_trabajos_admin_grants_article (article_id, expires_at, revoked_at),
  CONSTRAINT fk_trabajos_admin_grants_session FOREIGN KEY (admin_session_id) REFERENCES trabajos_admin_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_trabajos_admin_grants_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_admin_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, admin_id CHAR(36) NOT NULL, article_id CHAR(36) NULL, action VARCHAR(48) NOT NULL,
  reason TEXT NULL, metadata JSON NULL, ip_address VARCHAR(64) NULL, user_agent VARCHAR(500) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_trabajos_admin_audit_created (created_at), CONSTRAINT fk_trabajos_audit_admin FOREIGN KEY (admin_id) REFERENCES trabajos_admin_users(id),
  CONSTRAINT fk_trabajos_audit_article FOREIGN KEY (article_id) REFERENCES trabajos_articles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trabajos_recovery_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(24) NOT NULL, successful TINYINT(1) NOT NULL,
  rate_limited TINYINT(1) NOT NULL DEFAULT 0, ip_address VARCHAR(64) NULL, user_agent VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_trabajos_attempts_limit (kind, ip_address, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
