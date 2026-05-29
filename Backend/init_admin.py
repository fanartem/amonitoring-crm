from app.database import get_connection
from app.security import hash_password

def create_first_admin():
    email = "admin@amonitoring.kz"
    password = "admin123"
    
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            hashed = hash_password(password)
            
            sql = """
            INSERT INTO users (email, hashed_password, name, role, is_approved)
            VALUES (%s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (email, hashed, "Main Admin", "ADMIN", True))
            connection.commit()
            print(f"✅ Администратор {email} успешно создан!")
    except Exception as e:
        print(f"❌ Ошибка: {e}")
    finally:
        connection.close()

if __name__ == "__main__":
    create_first_admin()