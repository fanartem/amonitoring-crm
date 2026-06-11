from fastapi import APIRouter, Depends, HTTPException
from app.database import get_connection
from app.security import get_current_user
from app.permissions import (
    ADMIN,
    ROP,
    SENIOR_TECHNICIAN,
    TECHNICIAN,
    MANAGER,
)

router = APIRouter(prefix="/users", tags=["Users"])

@router.get("/technicians")
def get_technicians(current_user: dict = Depends(get_current_user)):
    """
    Список пользователей, которых можно назначить исполнителем заявки.
    Назначаем только TECHNICIAN и SENIOR_TECHNICIAN.
    """
    if current_user["role"] not in [ADMIN, ROP, SENIOR_TECHNICIAN, TECHNICIAN]:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра списка монтажников"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, role, city
                FROM users
                WHERE role IN (%s, %s)
                  AND is_approved = 1
                ORDER BY
                    role = %s DESC,
                    name ASC
                """,
                (
                    SENIOR_TECHNICIAN,
                    TECHNICIAN,
                    SENIOR_TECHNICIAN,
                )
            )

            return cursor.fetchall()

    finally:
        connection.close()

@router.get("/responsible-managers")
def get_responsible_managers(current_user: dict = Depends(get_current_user)):
    """
    Список пользователей, которых можно назначить ответственными за клиента.
    Используется в Clients.jsx при переназначении клиента.
    """
    if current_user["role"] not in [ADMIN, ROP]:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра ответственных менеджеров"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, email, role, city
                FROM users
                WHERE role IN (%s, %s, %s)
                  AND is_approved = 1
                  AND id > 1
                ORDER BY
                    FIELD(role, %s, %s, %s),
                    name ASC
                """,
                (
                    MANAGER,
                    ROP,
                    ADMIN,
                    MANAGER,
                    ROP,
                    ADMIN,
                )
            )

            return cursor.fetchall()

    finally:
        connection.close()