CREATE TABLE IF NOT EXISTS support_requests (
    id INT NOT NULL AUTO_INCREMENT,

    client_id INT NOT NULL,
    vehicle_id INT NULL,

    contact_phone VARCHAR(100) NOT NULL,
    problem_description TEXT NOT NULL,

    priority VARCHAR(30) NOT NULL DEFAULT 'NORMAL',
    status VARCHAR(30) NOT NULL DEFAULT 'NEW',

    assigned_to INT NULL,

    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME NULL,

    completed_by INT NULL,
    completed_at DATETIME NULL,

    cancelled_by INT NULL,
    cancelled_at DATETIME NULL,

    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_by INT NULL,
    deleted_at DATETIME NULL,

    PRIMARY KEY (id),

    KEY idx_support_requests_client (client_id),
    KEY idx_support_requests_vehicle (vehicle_id),
    KEY idx_support_requests_status (status),
    KEY idx_support_requests_assigned_to (assigned_to),
    KEY idx_support_requests_created_at (created_at),
    KEY idx_support_requests_deleted (is_deleted),

    CONSTRAINT fk_support_requests_client
        FOREIGN KEY (client_id)
        REFERENCES clients(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_support_requests_vehicle
        FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_support_requests_assigned_to
        FOREIGN KEY (assigned_to)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_support_requests_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_support_requests_completed_by
        FOREIGN KEY (completed_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_support_requests_cancelled_by
        FOREIGN KEY (cancelled_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_support_requests_deleted_by
        FOREIGN KEY (deleted_by)
        REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


CREATE TABLE IF NOT EXISTS support_request_comments (
    id INT NOT NULL AUTO_INCREMENT,
    support_request_id INT NOT NULL,
    user_id INT NULL,
    message TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_support_request_comments_request (support_request_id),
    KEY idx_support_request_comments_user (user_id),

    CONSTRAINT fk_support_request_comments_request
        FOREIGN KEY (support_request_id)
        REFERENCES support_requests(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_support_request_comments_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


CREATE TABLE IF NOT EXISTS support_request_history (
    id INT NOT NULL AUTO_INCREMENT,
    support_request_id INT NOT NULL,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_support_request_history_request (support_request_id),
    KEY idx_support_request_history_user (user_id),

    CONSTRAINT fk_support_request_history_request
        FOREIGN KEY (support_request_id)
        REFERENCES support_requests(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_support_request_history_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;