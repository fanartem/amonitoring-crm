from fastapi import APIRouter, Depends, HTTPException
from app.database import get_connection
from app.security import get_current_user
from app.permissions import (
    has_any_permission,
    has_permission,
    is_super_admin,
)

router = APIRouter(prefix="/users", tags=["Users"])

def ensure_can_view_request_executors(current_user: dict):
    """
    Кто может видеть справочник исполнителей:
    - Супер-Админ;
    - пользователи, которые видят заявки;
    - пользователи, которые назначают исполнителей;
    - пользователи со складскими доступами, потому что склад использует сотрудников.
    """
    if is_super_admin(current_user):
        return

    if has_any_permission(
        current_user,
        [
            "requests.view",
            "requests.executors.manage",
            "warehouse.view",
            "warehouse.inventory.view",
            "warehouse.inventory.manage",
        ],
    ):
        return

    raise HTTPException(
        status_code=403,
        detail="Недостаточно прав для просмотра списка исполнителей",
    )


def ensure_can_view_responsible_managers(current_user: dict):
    """
    Кто может видеть справочник ответственных менеджеров.
    """
    if is_super_admin(current_user):
        return

    if has_permission(current_user, "clients.responsible.reassign"):
        return

    raise HTTPException(
        status_code=403,
        detail="Недостаточно прав для просмотра ответственных менеджеров",
    )

@router.get("/technicians")
def get_technicians(current_user: dict = Depends(get_current_user)):
    """
    Список пользователей, которых можно назначить исполнителем заявки.

    Теперь определяется не жёстко по TECHNICIAN/SENIOR_TECHNICIAN,
    а по roles.can_be_request_executor = 1.
    """
    ensure_can_view_request_executors(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    u.id,
                    u.name,
                    u.role,
                    u.city,

                    r.name AS role_name,
                    r.badge_color AS role_badge_color,
                    r.can_be_request_executor
                FROM users u
                INNER JOIN roles r ON r.code = u.role
                WHERE r.can_be_request_executor = 1
                  AND r.is_active = 1
                  AND u.is_approved = 1
                  AND u.is_active = 1
                  AND u.deleted_at IS NULL
                ORDER BY
                    r.sort_order ASC,
                    u.name ASC
                """
            )

            users = cursor.fetchall()

            for user in users:
                user["can_be_request_executor"] = bool(
                    user["can_be_request_executor"]
                )
                user["role_name"] = user.get("role_name") or user.get("role")
                user["role_badge_color"] = user.get("role_badge_color") or "#64748B"

            return users

    finally:
        connection.close()

@router.get("/technicians/lookup")
def get_technicians_lookup(current_user: dict = Depends(get_current_user)):
    """
    Справочник исполнителей для отображения имён в старых заявках.

    Возвращает активных и soft-deleted пользователей.
    НЕ использовать для назначения исполнителя.
    """
    ensure_can_view_request_executors(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    u.id,
                    u.name,
                    u.role,
                    u.city,
                    u.is_approved,
                    u.is_active,
                    u.deleted_at,

                    r.name AS role_name,
                    r.badge_color AS role_badge_color,
                    r.can_be_request_executor
                FROM users u
                INNER JOIN roles r ON r.code = u.role
                WHERE r.can_be_request_executor = 1
                ORDER BY
                    u.deleted_at IS NOT NULL ASC,
                    u.is_active DESC,
                    r.sort_order ASC,
                    u.name ASC
                """
            )

            users = cursor.fetchall()

            for user in users:
                user["is_approved"] = bool(user["is_approved"])
                user["is_active"] = bool(user["is_active"])
                user["can_be_request_executor"] = bool(
                    user["can_be_request_executor"]
                )
                user["role_name"] = user.get("role_name") or user.get("role")
                user["role_badge_color"] = user.get("role_badge_color") or "#64748B"

            return users

    finally:
        connection.close()

@router.get("/responsible-managers")
def get_responsible_managers(current_user: dict = Depends(get_current_user)):
    """
    Список пользователей, которых можно назначить ответственными за клиента.

    Теперь определяется не жёстко по MANAGER/ROP/ADMIN,
    а по roles.can_be_responsible_manager = 1.
    """
    ensure_can_view_responsible_managers(current_user)

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

                    r.name AS role_name,
                    r.badge_color AS role_badge_color,
                    r.can_be_responsible_manager
                FROM users u
                INNER JOIN roles r ON r.code = u.role
                WHERE r.can_be_responsible_manager = 1
                  AND r.is_active = 1
                  AND u.is_approved = 1
                  AND u.is_active = 1
                  AND u.deleted_at IS NULL
                ORDER BY
                    r.sort_order ASC,
                    u.name ASC
                """
            )

            users = cursor.fetchall()

            for user in users:
                user["can_be_responsible_manager"] = bool(
                    user["can_be_responsible_manager"]
                )
                user["role_name"] = user.get("role_name") or user.get("role")
                user["role_badge_color"] = user.get("role_badge_color") or "#64748B"

            return users

    finally:
        connection.close()