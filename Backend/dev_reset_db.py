import os
from app.database import get_connection

def sync_db():
    if os.getenv("ALLOW_DB_RESET") != "YES":
        raise RuntimeError(
            "db_sync.py is dangerous after deployment. "
            "It drops and recreates tables. "
            "Set ALLOW_DB_RESET=YES only for local/dev database reset."
        )

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET FOREIGN_KEY_CHECKS = 0;")
            
            # Список таблиц для пересоздания (в правильном порядке)
            tables = {
                "cities": """
                    CREATE TABLE cities (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(100) NOT NULL UNIQUE,
                        is_active TINYINT DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NULL
                    );
                """,
                "users": """
                    CREATE TABLE users (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        email VARCHAR(255) UNIQUE NOT NULL,
                        hashed_password VARCHAR(255) NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        city VARCHAR(100) NULL,
                        role ENUM('ADMIN', 'MANAGER', 'TECHNICIAN', 'SENIOR_TECHNICIAN', 'ACCOUNTANT', 'WAREHOUSE_MANAGER') NOT NULL,
                        is_approved BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """,
                "user_city_access": """
                    CREATE TABLE user_city_access (
                        id INT AUTO_INCREMENT PRIMARY KEY,

                        user_id INT NOT NULL,
                        city_id INT NOT NULL,

                        can_view_requests TINYINT DEFAULT 1,
                        can_receive_notifications TINYINT DEFAULT 1,

                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NULL,

                        UNIQUE(user_id, city_id),

                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
                    );
                """,
                "notification_types": """
                    CREATE TABLE notification_types (
                        id INT AUTO_INCREMENT PRIMARY KEY,

                        code VARCHAR(100) UNIQUE NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        description TEXT NULL,
                        category VARCHAR(100) DEFAULT 'GENERAL',

                        default_enabled TINYINT DEFAULT 1,
                        is_active TINYINT DEFAULT 1,

                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NULL
                    );
                """,
                "user_notification_settings": """
                    CREATE TABLE user_notification_settings (
                        id INT AUTO_INCREMENT PRIMARY KEY,

                        user_id INT NOT NULL,
                        notification_type_code VARCHAR(100) NOT NULL,
                        is_enabled TINYINT DEFAULT 1,

                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NULL,

                        UNIQUE(user_id, notification_type_code),

                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (notification_type_code) REFERENCES notification_types(code) ON DELETE CASCADE
                    );
                """,
                "notifications": """
                    CREATE TABLE notifications (
                        id INT AUTO_INCREMENT PRIMARY KEY,

                        user_id INT NOT NULL,
                        type_code VARCHAR(100) NOT NULL,

                        title VARCHAR(255) NOT NULL,
                        message TEXT NOT NULL,

                        entity_type VARCHAR(100) NULL,
                        entity_id INT NULL,

                        actor_user_id INT NULL,

                        is_read TINYINT DEFAULT 0,
                        read_at DATETIME NULL,

                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (type_code) REFERENCES notification_types(code) ON DELETE CASCADE,
                        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,

                        INDEX idx_notifications_user_read (user_id, is_read),
                        INDEX idx_notifications_created_at (created_at),
                        INDEX idx_notifications_entity (entity_type, entity_id)
                    );
                """,
                "clients": """
                    CREATE TABLE clients (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        type ENUM('TOO', 'IP', 'INDIVIDUAL') NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        company_name VARCHAR(255),
                        phone VARCHAR(50) NOT NULL,
                        email VARCHAR(255),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        is_deleted TINYINT DEFAULT 0,
                        deleted_at DATETIME NULL,
                        deleted_by INT NULL
                    );
                """,
                "price_items": """
                    CREATE TABLE price_items (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        code VARCHAR(100) UNIQUE NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        category VARCHAR(100) NOT NULL,
                        default_price DECIMAL(12,2) NOT NULL DEFAULT 0,
                        unit VARCHAR(50) DEFAULT 'шт',
                        is_active TINYINT DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NULL
                    );
                """,
                "client_price_overrides": """
                    CREATE TABLE client_price_overrides (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        client_id INT NOT NULL,
                        price_item_id INT NOT NULL,
                        price DECIMAL(12,2) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NULL,

                        UNIQUE(client_id, price_item_id),
                        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                        FOREIGN KEY (price_item_id) REFERENCES price_items(id) ON DELETE CASCADE
                    );
                """,
                "vehicles": """
                    CREATE TABLE vehicles (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        client_id INT,
                        brand VARCHAR(100),
                        model VARCHAR(100),
                        plate_number VARCHAR(50),
                        vin VARCHAR(100) UNIQUE,
                        year INT,
                        type VARCHAR(50),
                        is_deleted TINYINT DEFAULT 0,
                        deleted_at DATETIME NULL,
                        deleted_by INT NULL,
                        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
                    );
                """,
                "requests": """
                    CREATE TABLE requests (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        client_id INT,
                        work_type ENUM('INSTALLATION', 'DIAGNOSTIC', 'REMOVAL'),
                        visit_type ENUM('IN_OFFICE', 'ON_SITE'),
                        address TEXT,
                        city TEXT,
                        platform VARCHAR(255) NOT NULL,
                        scheduled_at DATETIME,
                        status ENUM('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') DEFAULT 'NEW',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        assigned_to INT NULL,
                        is_paid BOOLEAN DEFAULT FALSE,
                        paid_at DATETIME NULL,
                        total_price DECIMAL(12,2) DEFAULT 0,
                        is_deleted TINYINT DEFAULT 0,
                        deleted_at DATETIME NULL,
                        deleted_by INT NULL,

                        FOREIGN KEY (client_id) REFERENCES clients(id),
                        FOREIGN KEY (assigned_to) REFERENCES users(id)
                    );
                """,
                "request_vehicles": """
                    CREATE TABLE request_vehicles (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        request_id INT NOT NULL,
                        vehicle_id INT NOT NULL,

                        has_beacon TINYINT(1) DEFAULT 0,
                        has_blocking TINYINT(1) DEFAULT 0,

                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
                        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
                    );
                """,
                "request_vehicle_extra_sensors": """
                    CREATE TABLE request_vehicle_extra_sensors (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        request_vehicle_id INT NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        price DECIMAL(12,2) DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                        FOREIGN KEY (request_vehicle_id) REFERENCES request_vehicles(id) ON DELETE CASCADE
                    );
                """,
                "request_price_lines": """
                    CREATE TABLE request_price_lines (
                        id INT AUTO_INCREMENT PRIMARY KEY,

                        request_id INT NOT NULL,
                        request_vehicle_id INT NULL,

                        line_key VARCHAR(255) NULL,
                        code VARCHAR(100) NULL,
                        label VARCHAR(255) NOT NULL,

                        quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
                        unit VARCHAR(50) DEFAULT 'шт',
                        unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
                        total_price DECIMAL(12,2) NOT NULL DEFAULT 0,

                        source VARCHAR(50) DEFAULT 'base',
                        is_manual TINYINT DEFAULT 0,

                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
                        FOREIGN KEY (request_vehicle_id) REFERENCES request_vehicles(id) ON DELETE SET NULL
                    );
                """,
                "request_comments": """
                    CREATE TABLE request_comments (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        request_id INT NOT NULL,
                        user_id INT NULL,
                        message TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
                    );
                """,
                "request_history": """
                    CREATE TABLE request_history (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        request_id INT NOT NULL,
                        user_id INT NULL,
                        action VARCHAR(100) NOT NULL,
                        old_value TEXT,
                        new_value TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
                    );
                """,
                "warehouse_items": """
                    CREATE TABLE warehouse_items (
                        id INT AUTO_INCREMENT PRIMARY KEY,

                        category VARCHAR(50) NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        manufacturer VARCHAR(255) NULL,
                        model VARCHAR(255) NULL,

                        identifier_type VARCHAR(50) DEFAULT 'NONE',
                        identifier_value VARCHAR(255) NULL,
                        serial_number VARCHAR(255) NULL,

                        is_serialized TINYINT DEFAULT 1,
                        quantity INT DEFAULT 1,

                        status VARCHAR(50) DEFAULT 'IN_STOCK',

                        note TEXT NULL,

                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NULL,

                        is_deleted TINYINT DEFAULT 0,
                        deleted_at DATETIME NULL,
                        deleted_by INT NULL,

                        created_by INT NULL,

                        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
                        FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
                    );
                """,
                "request_equipment": """
                    CREATE TABLE request_equipment (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        request_id INT NOT NULL,
                        request_vehicle_id INT NOT NULL,
                        warehouse_item_id INT NOT NULL,
                        quantity INT DEFAULT 1,
                        attached_by INT NULL,
                        attached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        note TEXT NULL,

                        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
                        FOREIGN KEY (request_vehicle_id) REFERENCES request_vehicles(id) ON DELETE CASCADE,
                        FOREIGN KEY (warehouse_item_id) REFERENCES warehouse_items(id),
                        FOREIGN KEY (attached_by) REFERENCES users(id) ON DELETE SET NULL
                    );
                """,
                "attachments": """
                    CREATE TABLE attachments (
                        id INT AUTO_INCREMENT PRIMARY KEY,

                        entity_type ENUM('CLIENT', 'REQUEST') NOT NULL,
                        entity_id INT NOT NULL,

                        original_filename VARCHAR(255) NOT NULL,
                        display_name VARCHAR(255) NOT NULL,
                        stored_filename VARCHAR(255) NOT NULL,
                        file_path TEXT NOT NULL,

                        content_type VARCHAR(255) NULL,
                        file_size BIGINT DEFAULT 0,

                        uploaded_by INT NULL,
                        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                        is_deleted TINYINT DEFAULT 0,
                        deleted_at DATETIME NULL,
                        deleted_by INT NULL,

                        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
                        FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL,

                        INDEX idx_attachments_entity (entity_type, entity_id),
                        INDEX idx_attachments_uploaded_by (uploaded_by),
                        INDEX idx_attachments_is_deleted (is_deleted)
                    );
                """
            }

            for table_name, create_sql in tables.items():
                cursor.execute(f"DROP TABLE IF EXISTS {table_name};")
                cursor.execute(create_sql)
                print(f"✅ Таблица {table_name} синхронизирована")
            
            cursor.execute("""
                CREATE UNIQUE INDEX uq_warehouse_identifier
                ON warehouse_items(identifier_type, identifier_value)
            """)
            print("✅ Индекс uq_warehouse_identifier создан")
            
            default_price_items = [
                {
                    "code": "GPS_FMB920",
                    "name": "Teltonika FMB920 (2G) GPS",
                    "category": "GPS_TRACKER",
                    "default_price": 24000,
                    "unit": "шт",
                },
                {
                    "code": "GPS_FMC920",
                    "name": "Teltonika FMC920 (4G) GPS",
                    "category": "GPS_TRACKER",
                    "default_price": 38000,
                    "unit": "шт",
                },
                {
                    "code": "BEACON_TAT100",
                    "name": "Teltonika TAT100 (маяк)",
                    "category": "BEACON",
                    "default_price": 50000,
                    "unit": "шт",
                },
                {
                    "code": "SUBSCRIPTION_TRACKER_MONTH",
                    "name": "Ежемесячная абонентская плата (трекер)",
                    "category": "SUBSCRIPTION",
                    "default_price": 2500,
                    "unit": "мес",
                },
                {
                    "code": "SUBSCRIPTION_BEACON_MONTH",
                    "name": "Ежемесячная абонентская плата (маяк)",
                    "category": "SUBSCRIPTION",
                    "default_price": 2500,
                    "unit": "мес",
                },
                {
                    "code": "ENGINE_BLOCKING_INSTALL",
                    "name": "Установка блокировки двигателя",
                    "category": "INSTALLATION_SERVICE",
                    "default_price": 10000,
                    "unit": "шт",
                },
                {
                    "code": "FUEL_SENSOR_ESCORT_TD",
                    "name": "Датчик уровня топлива Эскорт TD",
                    "category": "FUEL_SENSOR",
                    "default_price": 63000,
                    "unit": "шт",
                },
                {
                    "code": "FUEL_SENSOR_INSTALL_CALIBRATION",
                    "name": "Установка и тарировка датчика уровня топлива",
                    "category": "INSTALLATION_SERVICE",
                    "default_price": 25000,
                    "unit": "шт",
                },
                {
                    "code": "ON_SITE_CITY",
                    "name": "Транспортные расходы в черте города",
                    "category": "VISIT",
                    "default_price": 5000,
                    "unit": "выезд",
                },
                {
                    "code": "ON_SITE_OUTSIDE_CITY",
                    "name": "Транспортные расходы за пределы города",
                    "category": "VISIT",
                    "default_price": 10000,
                    "unit": "выезд",
                },
                {
                    "code": "SUBSCRIPTION_TRACKER_YEAR_PREPAID_MONTH",
                    "name": "Абонентская плата при оплате за год вперёд за 1 ед. трекера",
                    "category": "SUBSCRIPTION",
                    "default_price": 2000,
                    "unit": "мес",
                },
                {
                    "code": "SUBSCRIPTION_ROAMING_MONTH",
                    "name": "Абонентская плата + роуминг",
                    "category": "SUBSCRIPTION",
                    "default_price": 5000,
                    "unit": "мес",
                },
                {
                    "code": "BUSINESS_TRIP_KM",
                    "name": "Дальние поездки / командировка",
                    "category": "VISIT",
                    "default_price": 120,
                    "unit": "км",
                },
                {
                    "code": "GPS_CAN_BUS",
                    "name": "GPS CAN-шина",
                    "category": "GPS_CAN",
                    "default_price": 54000,
                    "unit": "шт",
                },

                {
                    "code": "REMOVAL_BASE",
                    "name": "Снятие оборудования",
                    "category": "REMOVAL_SERVICE",
                    "default_price": 3000,
                    "unit": "шт",
                },
                {
                    "code": "POWER_RESTORE",
                    "name": "Восстановление питания",
                    "category": "DIAGNOSTIC_SERVICE",
                    "default_price": 0,
                    "unit": "шт",
                },
            ]
            
            default_notification_types = [
                {
                    "code": "NEW_REQUEST",
                    "name": "Новые заявки",
                    "description": "Уведомления о создании новых заявок",
                    "category": "REQUESTS",
                    "default_enabled": 1,
                },
                {
                    "code": "REQUEST_STATUS_CHANGED",
                    "name": "Изменение статуса заявки",
                    "description": "Уведомления при изменении статуса заявки",
                    "category": "REQUESTS",
                    "default_enabled": 1,
                },
                {
                    "code": "REQUEST_ASSIGNED",
                    "name": "Назначение заявки",
                    "description": "Уведомления при назначении монтажника на заявку",
                    "category": "REQUESTS",
                    "default_enabled": 1,
                },
                {
                    "code": "REQUEST_SELF_ACCEPTED",
                    "name": "Самостоятельное принятие заявки",
                    "description": "Уведомления когда монтажник сам принимает заявку",
                    "category": "REQUESTS",
                    "default_enabled": 1,
                },
                {
                    "code": "REQUEST_PAYMENT_CHANGED",
                    "name": "Изменение оплаты",
                    "description": "Уведомления при изменении статуса оплаты заявки",
                    "category": "FINANCE",
                    "default_enabled": 1,
                },
                {
                    "code": "WAREHOUSE_LOW_STOCK",
                    "name": "Низкий остаток на складе",
                    "description": "Уведомления о низком остатке оборудования на складе",
                    "category": "WAREHOUSE",
                    "default_enabled": 1,
                },
            ]
            
            for item in default_notification_types:
                cursor.execute(
                    """
                    INSERT INTO notification_types (
                        code,
                        name,
                        description,
                        category,
                        default_enabled,
                        is_active
                    )
                    VALUES (%s, %s, %s, %s, %s, 1)
                    ON DUPLICATE KEY UPDATE
                        name = VALUES(name),
                        description = VALUES(description),
                        category = VALUES(category),
                        default_enabled = VALUES(default_enabled),
                        updated_at = NOW()
                    """,
                    (
                        item["code"],
                        item["name"],
                        item["description"],
                        item["category"],
                        item["default_enabled"],
                    )
                )

            for item in default_price_items:
                cursor.execute(
                    """
                    INSERT INTO price_items (
                        code,
                        name,
                        category,
                        default_price,
                        unit,
                        is_active
                    )
                    VALUES (%s, %s, %s, %s, %s, 1)
                    ON DUPLICATE KEY UPDATE
                        name = VALUES(name),
                        category = VALUES(category),
                        default_price = VALUES(default_price),
                        unit = VALUES(unit),
                        updated_at = NOW()
                    """,
                    (
                        item["code"],
                        item["name"],
                        item["category"],
                        item["default_price"],
                        item["unit"],
                    )
                )

            cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")
            connection.commit()
    except Exception as e:
        print(f"❌ Ошибка: {e}")
    finally:
        connection.close()

if __name__ == "__main__":
    sync_db()