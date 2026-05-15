from app.database import get_connection

def sync_db():
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
                        scheduled_at DATETIME,
                        status ENUM('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') DEFAULT 'NEW',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        assigned_to INT NULL,
                        is_paid BOOLEAN DEFAULT FALSE,
                        paid_at DATETIME NULL,
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
            
            cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")
            connection.commit()
    except Exception as e:
        print(f"❌ Ошибка: {e}")
    finally:
        connection.close()

if __name__ == "__main__":
    sync_db()