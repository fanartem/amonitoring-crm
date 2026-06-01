from fastapi import APIRouter, HTTPException, Depends
from app.database import get_connection
from app.security import get_current_admin, get_current_user

router = APIRouter(prefix="/admin", tags=["Admin Panel"])

@router.get("/pending-users")
def get_pending_users(admin: dict = Depends(get_current_admin)):
    """Список пользователей, ожидающих подтверждения"""
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT id, email, name, role, city, created_at 
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

@router.delete("/reject-user/{user_id}")
def reject_user(user_id: int, admin: dict = Depends(get_current_admin)):
    """Отклонение и удаление пользователя администратором"""
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем, существует ли такой пользователь
            cursor.execute("SELECT id FROM users WHERE id = %s", (user_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="User not found")

            # Удаляем пользователя
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            connection.commit()
            return {"message": f"User {user_id} has been rejected and deleted"}
    finally:
        connection.close()

@router.delete("/users/{user_id}")
def delete_user(user_id: int, current_user: dict = Depends(get_current_admin)):
    """Удаление пользователя (только ADMIN)"""
    connection = get_connection()
    try:
        with connection.cursor() as cursor:

            # Проверяем пользователя
            cursor.execute("SELECT id, email FROM users WHERE id = %s", (user_id,))
            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            # ❗ защита от удаления самого себя
            if user_id == current_user["id"]:
                raise HTTPException(status_code=400, detail="Cannot delete yourself")

            # ❗ защита Main Admin
            if user["email"] == "admin@amonitoring.kz":
                raise HTTPException(status_code=400, detail="Cannot delete main admin")

            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            connection.commit()

            return {"message": f"User {user_id} deleted"}

    finally:
        connection.close()

@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Обновление пользователя"""
    connection = get_connection()
    try:
        with connection.cursor() as cursor:

            cursor.execute("SELECT id, email, role FROM users WHERE id = %s", (user_id,))
            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            allowed_fields = {"email", "name", "password", "role", "city"}
            for key in data.keys():
                if key not in allowed_fields:
                    raise HTTPException(status_code=400, detail=f"Invalid field: {key}")

            is_admin = current_user["role"] == "ADMIN"
            is_self = current_user["id"] == user_id

            if not (is_admin or is_self):
                raise HTTPException(status_code=403, detail="No permission")

            # Обычный пользователь может менять только свои разрешённые поля
            if not is_admin:
                forbidden_self_fields = {"email", "name", "role", "city"}
                requested_forbidden_fields = forbidden_self_fields.intersection(data.keys())

                if requested_forbidden_fields:
                    raise HTTPException(
                        status_code=403,
                        detail="Самостоятельно можно менять только пароль"
                    )

            # Защита Main Admin от изменения не-админом
            if user["email"] == "admin@amonitoring.kz" and not is_admin:
                raise HTTPException(
                    status_code=403,
                    detail="Нельзя изменять главного администратора"
                )

            # динамическое обновление
            updates = []
            values = []

            if "email" in data:
                updates.append("email = %s")
                values.append(data["email"])

            if "name" in data:
                updates.append("name = %s")
                values.append(data["name"])

            if "city" in data:
                updates.append("city = %s")
                values.append(data["city"])

            if "password" in data:
                from app.security import hash_password
                updates.append("hashed_password = %s")
                values.append(hash_password(data["password"]))

            if is_admin and "role" in data:
                updates.append("role = %s")
                values.append(data["role"])

            if not updates:
                return {"message": "Nothing to update"}

            query = f"UPDATE users SET {', '.join(updates)} WHERE id = %s"
            values.append(user_id)

            cursor.execute(query, tuple(values))
            connection.commit()

            return {"message": "User updated"}

    finally:
        connection.close()

@router.get("/users")
def get_all_users(current_user: dict = Depends(get_current_user)):
    """Список одобренных сотрудников для всех авторизованных пользователей"""
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT id, name, email, role, city
                FROM users
                WHERE is_approved = 1
            """)
            users = cursor.fetchall()

            return users
    finally:
        connection.close()