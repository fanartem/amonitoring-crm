from fastapi import APIRouter, HTTPException, Depends
from app.database import get_connection
from app.security import get_current_admin

router = APIRouter(prefix="/admin", tags=["Admin Panel"])

@router.get("/pending-users")
def get_pending_users(admin: dict = Depends(get_current_admin)):
    """Список пользователей, ожидающих подтверждения"""
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT id, email, name, role, created_at 
                FROM users 
                WHERE is_approved = FALSE
            """)
            return cursor.fetchall()
    finally:
        connection.close()

@router.post("/approve-user/{user_id}")
def approve_user(user_id: int, admin: dict = Depends(get_current_admin)):
    """Одобрение пользователя администратором"""
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем, существует ли такой пользователь
            cursor.execute("SELECT id FROM users WHERE id = %s", (user_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="User not found")

            # Меняем статус на TRUE
            cursor.execute("UPDATE users SET is_approved = TRUE WHERE id = %s", (user_id,))
            connection.commit()
            return {"message": f"User {user_id} has been approved"}
    finally:
        connection.close()