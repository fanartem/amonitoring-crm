INSERT INTO notification_types (
    code,
    name,
    description,
    category,
    default_enabled,
    is_active
)
VALUES (
    'REQUEST_TIME_CONFLICT',
    'Пересечение заявок по времени',
    'Уведомление администраторам, если новая заявка пересекается по времени с другой заявкой в этом же городе',
    'REQUESTS',
    1,
    1
)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    default_enabled = VALUES(default_enabled),
    is_active = VALUES(is_active),
    updated_at = NOW();


CREATE TABLE IF NOT EXISTS user_notification_ignored_cities (
    id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    notification_type_code VARCHAR(100) NOT NULL,
    city_id INT NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uq_user_notification_ignored_city (
        user_id,
        notification_type_code,
        city_id
    ),

    KEY idx_unic_type_city (
        notification_type_code,
        city_id
    ),

    KEY idx_unic_city (
        city_id
    ),

    CONSTRAINT fk_unic_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_unic_notification_type
        FOREIGN KEY (notification_type_code)
        REFERENCES notification_types(code)
        ON DELETE CASCADE,

    CONSTRAINT fk_unic_city
        FOREIGN KEY (city_id)
        REFERENCES cities(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;