from app.database import get_connection

def sync_db():
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET FOREIGN_KEY_CHECKS = 0;")
            
            # Список таблиц для пересоздания (в правильном порядке)
            tables = {
                "users": """
                    CREATE TABLE users (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        email VARCHAR(255) UNIQUE NOT NULL,
                        hashed_password VARCHAR(255) NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        role ENUM('ADMIN', 'MANAGER', 'TECHNICIAN', 'SENIOR_TECHNICIAN') NOT NULL,
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
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
                    );
                """,
                "requests": """
                    CREATE TABLE requests (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        client_id INT,
                        vehicle_id INT,
                        work_type ENUM('INSTALLATION', 'DIAGNOSTIC', 'REMOVAL'),
                        visit_type ENUM('IN_OFFICE', 'ON_SITE'),
                        address TEXT,
                        scheduled_at DATETIME,
                        status ENUM('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') DEFAULT 'NEW',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        assigned_to INT NULL,
                        FOREIGN KEY (client_id) REFERENCES clients(id),
                        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
                        FOREIGN KEY (assigned_to) REFERENCES users(id)
                    );
                """
            }

            for table_name, create_sql in tables.items():
                cursor.execute(f"DROP TABLE IF EXISTS {table_name};")
                cursor.execute(create_sql)
                print(f"✅ Таблица {table_name} синхронизирована")
            
            cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")
            connection.commit()
    except Exception as e:
        print(f"❌ Ошибка: {e}")
    finally:
        connection.close()

if __name__ == "__main__":
    sync_db()