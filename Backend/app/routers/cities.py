from fastapi import APIRouter, Depends, HTTPException
from app.database import get_connection
from app.security import get_current_user
from app.schemas import CityCreate, CityUpdate

router = APIRouter(prefix="/cities", tags=["Cities"])


def require_admin(current_user: dict):
    if current_user["role"] != "ADMIN":
        raise HTTPException(
            status_code=403,
            detail="Только Админ может управлять городами"
        )


@router.get("")
def get_cities(
    active_only: bool = True,
    current_user: dict = Depends(get_current_user)
):
    """
    Получить список городов.
    Доступ: все авторизованные пользователи.
    По умолчанию возвращает только активные города.
    """
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            if active_only:
                cursor.execute(
                    """
                    SELECT id, name, is_active, created_at, updated_at
                    FROM cities
                    WHERE is_active = 1
                    ORDER BY name ASC
                    """
                )
            else:
                cursor.execute(
                    """
                    SELECT id, name, is_active, created_at, updated_at
                    FROM cities
                    ORDER BY is_active DESC, name ASC
                    """
                )

            return cursor.fetchall()
    finally:
        connection.close()


@router.post("")
def create_city(
    data: CityCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Добавить город.
    Доступ: только ADMIN.
    """
    require_admin(current_user)

    name = data.name.strip()

    if not name:
        raise HTTPException(status_code=400, detail="Название города обязательно")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM cities
                WHERE LOWER(name) = LOWER(%s)
                """,
                (name,)
            )
            existing = cursor.fetchone()

            if existing:
                raise HTTPException(
                    status_code=400,
                    detail="Такой город уже существует"
                )

            cursor.execute(
                """
                INSERT INTO cities (name, is_active)
                VALUES (%s, 1)
                """,
                (name,)
            )

            connection.commit()

            return {
                "message": "Город добавлен",
                "city_id": cursor.lastrowid
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/{city_id}")
def update_city(
    city_id: int,
    data: CityUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Редактировать город или включить/отключить его.
    Доступ: только ADMIN.
    """
    require_admin(current_user)

    update_data = data.dict(exclude_unset=True)

    if not update_data:
        return {"message": "Нет данных для обновления"}

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, is_active
                FROM cities
                WHERE id = %s
                """,
                (city_id,)
            )
            city = cursor.fetchone()

            if not city:
                raise HTTPException(status_code=404, detail="Город не найден")

            updates = []
            values = []

            if "name" in update_data:
                name = update_data["name"].strip()

                if not name:
                    raise HTTPException(
                        status_code=400,
                        detail="Название города обязательно"
                    )

                cursor.execute(
                    """
                    SELECT id
                    FROM cities
                    WHERE LOWER(name) = LOWER(%s)
                      AND id != %s
                    """,
                    (name, city_id)
                )
                existing = cursor.fetchone()

                if existing:
                    raise HTTPException(
                        status_code=400,
                        detail="Такой город уже существует"
                    )

                updates.append("name = %s")
                values.append(name)

            if "is_active" in update_data:
                updates.append("is_active = %s")
                values.append(bool(update_data["is_active"]))

            if not updates:
                return {"message": "Нет допустимых полей для обновления"}

            updates.append("updated_at = NOW()")
            values.append(city_id)

            cursor.execute(
                f"""
                UPDATE cities
                SET {', '.join(updates)}
                WHERE id = %s
                """,
                tuple(values)
            )

            connection.commit()

            return {
                "message": "Город обновлён",
                "city_id": city_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/{city_id}")
def deactivate_city(
    city_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Отключить город.
    Доступ: только ADMIN.

    Не удаляем физически, чтобы старые заявки и пользователи с этим городом не сломались.
    """
    require_admin(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, is_active
                FROM cities
                WHERE id = %s
                """,
                (city_id,)
            )
            city = cursor.fetchone()

            if not city:
                raise HTTPException(status_code=404, detail="Город не найден")

            if not city["is_active"]:
                raise HTTPException(status_code=400, detail="Город уже отключён")

            cursor.execute(
                """
                UPDATE cities
                SET is_active = 0,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (city_id,)
            )

            connection.commit()

            return {
                "message": "Город отключён",
                "city_id": city_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()