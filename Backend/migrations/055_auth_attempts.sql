-- Журнал попыток аутентификации.
-- Даёт две вещи сразу: ограничение частоты на /auth/login и /auth/register
-- (одинаковое для всех воркеров, без новых зависимостей) и след неудачных
-- входов для расследований.

CREATE TABLE IF NOT EXISTS auth_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    attempt_type VARCHAR(16) NOT NULL DEFAULT 'login',
    email VARCHAR(255) NULL,
    ip_address VARCHAR(45) NULL,
    is_success TINYINT(1) NOT NULL DEFAULT 0,
    failure_reason VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_auth_attempts_email (attempt_type, email, created_at),
    KEY idx_auth_attempts_ip (attempt_type, ip_address, created_at),
    KEY idx_auth_attempts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;