from fastapi import APIRouter, Depends, HTTPException
from app.database import get_connection
from app.security import get_current_user

router = APIRouter(prefix="/users", tags=["Users"]) # Если добавляешь в users.py

# Добавь этот роут, чтобы фронтенд мог получать список монтажников
@router.get("/technicians")
def get_technicians(current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Ищем только тех, у кого роль TECHNICIAN и аккаунт одобрен (is_approved = 1)
            cursor.execute("SELECT id, name FROM users WHERE role IN ('TECHNICIAN', 'SENIOR_TECHNICIAN', 'ADMIN', 'WAREHOUSE_MANAGER') AND is_approved = 1")
            return cursor.fetchall()
    finally:
        connection.close()