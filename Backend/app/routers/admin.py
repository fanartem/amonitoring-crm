from fastapi import APIRouter, HTTPException, Depends
from pymysql.err import IntegrityError

from app.database import get_connection
from app.security import get_current_user, hash_password
from app.permissions import (
    add_access_audit_log,
    has_any_permission,
    has_permission,
    is_owner,
    is_super_admin,
)

router = APIRouter(prefix="/admin", tags=["Admin Panel"])


def ensure_any_permission(
    current_user: dict,
    permission_codes: list[str],
    detail: str = "Недостаточно прав",
):
    if is_super_admin(current_user):
        return

    if has_any_permission(current_user, permission_codes):
        return

    raise HTTPException(status_code=403, detail=detail)


def ensure_employees_view_access(current_user: dict):
    # Любой авторизованный сотрудник может видеть список сотрудников.
    # get_current_user уже проверил токен, активность, approved и роль.
    return


def ensure_employees_manage_access(current_user: dict):
    ensure_any_permission(
        current_user,
        ["employees.manage"],
        "Недостаточно прав для редактирования сотрудников",
    )


def ensure_employees_approve_access(current_user: dict):
    ensure_any_permission(
        current_user,
        ["employees.approve"],
        "Недостаточно прав для одобрения сотрудников",
    )


def ensure_employees_delete_access(current_user: dict):
    ensure_any_permission(
        current_user,
        ["employees.delete"],
        "Недостаточно прав для удаления сотрудников",
    )


def get_active_role(cursor, role_code: str) -> dict:
    normalized_role = str(role_code or "").strip().upper()

    if not normalized_role:
        raise HTTPException(status_code=400, detail="Необходимо выбрать роль")

    cursor.execute(
        """
        SELECT
            id,
            code,
            name,
            is_active,
            can_be_request_executor
        FROM roles
        WHERE code = %s
        LIMIT 1
        """,
        (normalized_role,),
    )

    role = cursor.fetchone()

    if not role:
        raise HTTPException(status_code=400, detail="Некорректная роль")

    if not role["is_active"]:
        raise HTTPException(status_code=400, detail="Выбранная роль отключена")

    return role


def get_user_for_admin_action(cursor, user_id: int) -> dict | None:
    cursor.execute(
        """
        SELECT
            u.id,
            u.email,
            u.name,
            u.role,
            u.city,
            u.is_approved,
            u.is_active,
            u.deleted_at,

            r.name AS role_name,
            r.badge_color AS role_badge_color,
            r.can_be_request_executor,
            r.can_be_responsible_manager,

            COALESCE(usf.is_owner, 0) AS is_owner,
            COALESCE(usf.is_super_admin, 0) AS is_super_admin
        FROM users u
        LEFT JOIN roles r ON r.code = u.role
        LEFT JOIN user_security_flags usf ON usf.user_id = u.id
        WHERE u.id = %s
        LIMIT 1
        """,
        (user_id,),
    )

    return cursor.fetchone()


def ensure_user_security_flags_exists(cursor, user_id: int):
    cursor.execute(
        """
        INSERT INTO user_security_flags (
            user_id,
            is_super_admin,
            is_owner,
            created_at,
            updated_at
        )
        VALUES (%s, 0, 0, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id)
        """,
        (user_id,),
    )


def count_active_super_admins(cursor) -> int:
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM users u
        INNER JOIN user_security_flags usf ON usf.user_id = u.id
        WHERE usf.is_super_admin = 1
          AND u.is_approved = 1
          AND u.is_active = 1
          AND u.deleted_at IS NULL
        """
    )

    row = cursor.fetchone()

    return int(row["count"] or 0)


@router.get("/pending-users")
def get_pending_users(current_user: dict = Depends(get_current_user)):
    """Список пользователей, ожидающих подтверждения"""
    ensure_employees_approve_access(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.name,
                    u.role,
                    u.city,
                    u.created_at,

                    r.name AS role_name,
                    r.badge_color AS role_badge_color,
                    r.can_be_request_executor,
                    r.can_be_responsible_manager,

                    COALESCE(usf.is_super_admin, 0) AS is_super_admin,
                    COALESCE(usf.is_owner, 0) AS is_owner
                FROM users u
                LEFT JOIN roles r ON r.code = u.role
                LEFT JOIN user_security_flags usf ON usf.user_id = u.id
                WHERE u.is_approved = 0
                  AND u.is_active = 1
                  AND u.deleted_at IS NULL
                ORDER BY u.created_at DESC
                """
            )

            users = cursor.fetchall()

            for user in users:
                user["can_be_request_executor"] = bool(user["can_be_request_executor"])
                user["can_be_responsible_manager"] = bool(
                    user["can_be_responsible_manager"]
                )
                user["is_super_admin"] = bool(user["is_super_admin"])
                user["is_owner"] = bool(user["is_owner"])
                user["role_name"] = user.get("role_name") or user.get("role")
                user["role_badge_color"] = user.get("role_badge_color") or "#64748B"

            return users

    finally:
        connection.close()


@router.post("/approve-user/{user_id}")
def approve_user(user_id: int, current_user: dict = Depends(get_current_user)):
    """Одобрение пользователя"""
    ensure_employees_approve_access(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            user = get_user_for_admin_action(cursor, user_id)

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if user.get("deleted_at") is not None or user.get("is_active") == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя одобрить удалённого или отключённого пользователя",
                )

            old_value = {
                "is_approved": bool(user["is_approved"]),
                "is_active": bool(user["is_active"]),
                "role": user["role"],
            }

            ensure_user_security_flags_exists(cursor, user_id)

            cursor.execute(
                """
                UPDATE users
                SET is_approved = 1,
                    is_active = 1,
                    deleted_at = NULL,
                    deleted_by = NULL
                WHERE id = %s
                """,
                (user_id,),
            )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="USER_APPROVED",
                old_value=old_value,
                new_value={
                    "is_approved": True,
                    "is_active": True,
                    "role": user["role"],
                },
                reason="User approved from admin panel",
            )

            connection.commit()

            return {"message": f"User {user_id} has been approved"}

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/reject-user/{user_id}")
def reject_user(user_id: int, current_user: dict = Depends(get_current_user)):
    """
    Отклонение пользователя.

    Раньше тут был физический DELETE.
    Теперь делаем soft-delete, чтобы не терять историю.
    """
    ensure_employees_approve_access(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            user = get_user_for_admin_action(cursor, user_id)

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if user.get("is_owner"):
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя отклонить владельца системы",
                )

            if user.get("is_super_admin"):
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя отклонить Супер-Админа",
                )

            if user.get("is_approved"):
                raise HTTPException(
                    status_code=400,
                    detail="Пользователь уже одобрен. Используйте удаление сотрудника.",
                )

            old_value = {
                "email": user["email"],
                "name": user["name"],
                "role": user["role"],
                "city": user["city"],
                "is_approved": bool(user["is_approved"]),
                "is_active": bool(user["is_active"]),
            }

            cursor.execute(
                """
                UPDATE users
                SET is_active = 0,
                    is_approved = 0,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], user_id),
            )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="USER_REJECTED",
                old_value=old_value,
                new_value={
                    "is_approved": False,
                    "is_active": False,
                    "deleted": True,
                },
                reason="User rejected from admin panel",
            )

            connection.commit()

            return {"message": f"User {user_id} has been rejected"}

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/users/{user_id}")
def delete_user(user_id: int, current_user: dict = Depends(get_current_user)):
    """Soft-delete пользователя"""
    ensure_employees_delete_access(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            user = get_user_for_admin_action(cursor, user_id)

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if int(user_id) == int(current_user["id"]):
                raise HTTPException(status_code=400, detail="Cannot delete yourself")

            if user.get("is_owner"):
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя удалить владельца системы",
                )

            if user.get("deleted_at") is not None or user.get("is_active") == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Пользователь уже удалён или отключён",
                )

            if user.get("is_super_admin"):
                if not is_owner(current_user):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Удалить Супер-Админа может только владелец системы. "
                            "Либо сначала снимите флаг Супер-Админа."
                        ),
                    )

                if count_active_super_admins(cursor) <= 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Нельзя удалить последнего активного Супер-Админа",
                    )

            old_value = {
                "email": user["email"],
                "name": user["name"],
                "role": user["role"],
                "city": user["city"],
                "is_approved": bool(user["is_approved"]),
                "is_active": bool(user["is_active"]),
                "is_super_admin": bool(user["is_super_admin"]),
                "is_owner": bool(user["is_owner"]),
            }

            cursor.execute(
                """
                UPDATE users
                SET is_active = 0,
                    is_approved = 0,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], user_id),
            )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="USER_DELETED",
                old_value=old_value,
                new_value={
                    "is_active": False,
                    "is_approved": False,
                    "deleted": True,
                },
                reason="User deleted from admin panel",
            )

            connection.commit()

            return {"message": f"User {user_id} deleted"}

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Обновление пользователя"""
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            user = get_user_for_admin_action(cursor, user_id)

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if user.get("deleted_at") is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя редактировать удалённого пользователя",
                )

            allowed_fields = {"email", "name", "password", "role", "city"}

            for key in data.keys():
                if key not in allowed_fields:
                    raise HTTPException(status_code=400, detail=f"Invalid field: {key}")

            is_self = int(current_user["id"]) == int(user_id)

            if is_self:
                requested_fields = set(data.keys())

                if requested_fields - {"password"}:
                    raise HTTPException(
                        status_code=403,
                        detail="Самостоятельно можно менять только пароль",
                    )
            else:
                ensure_employees_manage_access(current_user)

            if user.get("is_owner") and not is_owner(current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Нельзя изменять владельца системы",
                )

            old_value = {
                "email": user["email"],
                "name": user["name"],
                "role": user["role"],
                "city": user["city"],
                "is_super_admin": bool(user["is_super_admin"]),
                "is_owner": bool(user["is_owner"]),
            }

            updates = []
            values = []

            if "role" in data:
                if not is_super_admin(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Только Супер-Админ может менять роль сотрудника",
                    )

                new_role = get_active_role(cursor, data["role"])
                data["role"] = new_role["code"]

                if user.get("is_owner") and data["role"] != user["role"]:
                    raise HTTPException(
                        status_code=400,
                        detail="Нельзя менять роль владельца системы",
                    )

                new_city = data.get("city") if "city" in data else user.get("city")

                if new_city is not None:
                    new_city = str(new_city).strip() or None

                if new_role.get("can_be_request_executor") and not new_city:
                    raise HTTPException(
                        status_code=400,
                        detail="Для роли исполнителя заявки необходимо указать город",
                    )

                data["city"] = new_city

            if "email" in data:
                email = str(data["email"] or "").strip().lower()

                if not email:
                    raise HTTPException(
                        status_code=400,
                        detail="Email не может быть пустым",
                    )

                updates.append("email = %s")
                values.append(email)

            if "name" in data:
                name = str(data["name"] or "").strip()

                if not name:
                    raise HTTPException(
                        status_code=400,
                        detail="Имя не может быть пустым",
                    )

                updates.append("name = %s")
                values.append(name)

            if "city" in data:
                city = data["city"]

                if city is not None:
                    city = str(city).strip() or None

                updates.append("city = %s")
                values.append(city)

            if "password" in data:
                password = str(data["password"] or "")

                if not password:
                    raise HTTPException(
                        status_code=400,
                        detail="Пароль не может быть пустым",
                    )

                updates.append("hashed_password = %s")
                values.append(hash_password(password))

            if "role" in data:
                updates.append("role = %s")
                values.append(data["role"])

            if not updates:
                return {"message": "Nothing to update"}

            values.append(user_id)

            cursor.execute(
                f"""
                UPDATE users
                SET {', '.join(updates)}
                WHERE id = %s
                """,
                tuple(values),
            )

            updated_user = get_user_for_admin_action(cursor, user_id)

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="USER_UPDATED",
                old_value=old_value,
                new_value={
                    "email": updated_user["email"],
                    "name": updated_user["name"],
                    "role": updated_user["role"],
                    "city": updated_user["city"],
                    "password_changed": "password" in data,
                },
                reason="User updated from admin panel",
            )

            connection.commit()

            return {"message": "User updated"}

    except HTTPException:
        connection.rollback()
        raise
    except IntegrityError as e:
        connection.rollback()

        if e.args and e.args[0] == 1062:
            raise HTTPException(
                status_code=409,
                detail="Пользователь с таким email уже существует",
            )

        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.get("/users")
def get_all_users(current_user: dict = Depends(get_current_user)):
    """Список одобренных сотрудников"""
    ensure_employees_view_access(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    u.id,
                    u.name,
                    u.email,
                    u.role,
                    u.city,
                    u.is_active,
                    u.is_approved,
                    u.deleted_at,

                    r.name AS role_name,
                    r.badge_color AS role_badge_color,
                    r.data_scope AS role_data_scope,
                    r.can_be_request_executor,
                    r.can_be_responsible_manager,

                    COALESCE(usf.is_super_admin, 0) AS is_super_admin,
                    COALESCE(usf.is_owner, 0) AS is_owner
                FROM users u
                LEFT JOIN roles r ON r.code = u.role
                LEFT JOIN user_security_flags usf ON usf.user_id = u.id
                WHERE u.is_approved = 1
                ORDER BY
                    u.deleted_at IS NOT NULL ASC,
                    u.is_active DESC,
                    u.name ASC
                """
            )

            users = cursor.fetchall()

            for user in users:
                user["is_active"] = bool(user["is_active"])
                user["is_approved"] = bool(user["is_approved"])
                user["can_be_request_executor"] = bool(user["can_be_request_executor"])
                user["can_be_responsible_manager"] = bool(
                    user["can_be_responsible_manager"]
                )
                user["is_super_admin"] = bool(user["is_super_admin"])
                user["is_owner"] = bool(user["is_owner"])

                user["role_name"] = user.get("role_name") or user.get("role")
                user["role_badge_color"] = user.get("role_badge_color") or "#64748B"

            return users

    finally:
        connection.close()