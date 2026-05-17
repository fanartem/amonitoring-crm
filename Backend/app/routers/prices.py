from fastapi import APIRouter, Depends, HTTPException
from app.database import get_connection
from app.security import get_current_user
from app.schemas import (
    PriceItemCreate,
    PriceItemUpdate,
    ClientPriceOverrideUpdate,
)

router = APIRouter(prefix="/prices", tags=["Prices"])


PRICE_READ_ROLES = ["ADMIN", "MANAGER", "ACCOUNTANT"]
PRICE_MANAGE_ROLES = ["ADMIN", "MANAGER"]


def require_price_read(current_user: dict):
    if current_user["role"] not in PRICE_READ_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра цен"
        )


def require_price_manage(current_user: dict):
    if current_user["role"] not in PRICE_MANAGE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для управления ценами"
        )


@router.get("")
def get_price_items(
    active_only: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """
    Получить список базовых цен.
    Доступ: ADMIN, MANAGER, ACCOUNTANT.
    """
    require_price_read(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            if active_only:
                cursor.execute(
                    """
                    SELECT
                        id,
                        code,
                        name,
                        category,
                        default_price,
                        unit,
                        is_active,
                        created_at,
                        updated_at
                    FROM price_items
                    WHERE is_active = 1
                    ORDER BY category ASC, id ASC
                    """
                )
            else:
                cursor.execute(
                    """
                    SELECT
                        id,
                        code,
                        name,
                        category,
                        default_price,
                        unit,
                        is_active,
                        created_at,
                        updated_at
                    FROM price_items
                    ORDER BY is_active DESC, category ASC, id ASC
                    """
                )

            return cursor.fetchall()

    finally:
        connection.close()


@router.post("")
def create_price_item(
    data: PriceItemCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Создать новую базовую цену.
    Доступ: ADMIN, MANAGER.
    """
    require_price_manage(current_user)

    code = data.code.strip().upper()
    name = data.name.strip()
    category = data.category.strip().upper()
    unit = data.unit.strip() if data.unit else "шт"

    if not code:
        raise HTTPException(status_code=400, detail="Код цены обязателен")

    if not name:
        raise HTTPException(status_code=400, detail="Название цены обязательно")

    if not category:
        raise HTTPException(status_code=400, detail="Категория обязательна")

    if data.default_price < 0:
        raise HTTPException(status_code=400, detail="Цена не может быть отрицательной")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM price_items
                WHERE code = %s
                """,
                (code,)
            )
            existing = cursor.fetchone()

            if existing:
                raise HTTPException(
                    status_code=400,
                    detail="Цена с таким кодом уже существует"
                )

            cursor.execute(
                """
                INSERT INTO price_items (
                    code,
                    name,
                    category,
                    default_price,
                    unit,
                    is_active
                )
                VALUES (%s, %s, %s, %s, %s, 1)
                """,
                (
                    code,
                    name,
                    category,
                    data.default_price,
                    unit,
                )
            )

            connection.commit()

            return {
                "message": "Цена создана",
                "price_item_id": cursor.lastrowid
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/{price_item_id}")
def update_price_item(
    price_item_id: int,
    data: PriceItemUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Редактировать базовую цену.
    Доступ: ADMIN, MANAGER.
    """
    require_price_manage(current_user)

    update_data = data.dict(exclude_unset=True)

    if not update_data:
        return {"message": "Нет данных для обновления"}

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM price_items
                WHERE id = %s
                """,
                (price_item_id,)
            )
            price_item = cursor.fetchone()

            if not price_item:
                raise HTTPException(status_code=404, detail="Цена не найдена")

            updates = []
            values = []

            if "code" in update_data:
                code = update_data["code"].strip().upper()

                if not code:
                    raise HTTPException(status_code=400, detail="Код цены обязателен")

                cursor.execute(
                    """
                    SELECT id
                    FROM price_items
                    WHERE code = %s
                      AND id != %s
                    """,
                    (code, price_item_id)
                )
                existing = cursor.fetchone()

                if existing:
                    raise HTTPException(
                        status_code=400,
                        detail="Цена с таким кодом уже существует"
                    )

                updates.append("code = %s")
                values.append(code)

            if "name" in update_data:
                name = update_data["name"].strip()

                if not name:
                    raise HTTPException(
                        status_code=400,
                        detail="Название цены обязательно"
                    )

                updates.append("name = %s")
                values.append(name)

            if "category" in update_data:
                category = update_data["category"].strip().upper()

                if not category:
                    raise HTTPException(
                        status_code=400,
                        detail="Категория обязательна"
                    )

                updates.append("category = %s")
                values.append(category)

            if "default_price" in update_data:
                if update_data["default_price"] < 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Цена не может быть отрицательной"
                    )

                updates.append("default_price = %s")
                values.append(update_data["default_price"])

            if "unit" in update_data:
                unit = update_data["unit"].strip() if update_data["unit"] else "шт"

                updates.append("unit = %s")
                values.append(unit)

            if "is_active" in update_data:
                updates.append("is_active = %s")
                values.append(bool(update_data["is_active"]))

            if not updates:
                return {"message": "Нет допустимых полей для обновления"}

            updates.append("updated_at = NOW()")
            values.append(price_item_id)

            cursor.execute(
                f"""
                UPDATE price_items
                SET {', '.join(updates)}
                WHERE id = %s
                """,
                tuple(values)
            )

            connection.commit()

            return {
                "message": "Цена обновлена",
                "price_item_id": price_item_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/{price_item_id}")
def deactivate_price_item(
    price_item_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Отключить базовую цену.
    Физически не удаляем, чтобы не ломать будущие расчёты и историю.
    Доступ: ADMIN, MANAGER.
    """
    require_price_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, is_active
                FROM price_items
                WHERE id = %s
                """,
                (price_item_id,)
            )
            price_item = cursor.fetchone()

            if not price_item:
                raise HTTPException(status_code=404, detail="Цена не найдена")

            if not price_item["is_active"]:
                raise HTTPException(status_code=400, detail="Цена уже отключена")

            cursor.execute(
                """
                UPDATE price_items
                SET is_active = 0,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (price_item_id,)
            )

            connection.commit()

            return {
                "message": "Цена отключена",
                "price_item_id": price_item_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/{price_item_id}/restore")
def restore_price_item(
    price_item_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Включить ранее отключённую базовую цену.
    Доступ: ADMIN, MANAGER.
    """
    require_price_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, is_active
                FROM price_items
                WHERE id = %s
                """,
                (price_item_id,)
            )
            price_item = cursor.fetchone()

            if not price_item:
                raise HTTPException(status_code=404, detail="Цена не найдена")

            if price_item["is_active"]:
                raise HTTPException(status_code=400, detail="Цена уже активна")

            cursor.execute(
                """
                UPDATE price_items
                SET is_active = 1,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (price_item_id,)
            )

            connection.commit()

            return {
                "message": "Цена включена",
                "price_item_id": price_item_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.get("/client/{client_id}")
def get_client_prices(
    client_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Получить цены для конкретного клиента:
    базовая цена + индивидуальная цена + итоговая effective_price.
    Доступ: ADMIN, MANAGER, ACCOUNTANT.
    """
    require_price_read(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, is_deleted
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            if client["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Клиент находится в корзине"
                )

            cursor.execute(
                """
                SELECT
                    pi.id AS price_item_id,
                    pi.code,
                    pi.name,
                    pi.category,
                    pi.default_price,
                    pi.unit,
                    pi.is_active,

                    cpo.id AS override_id,
                    cpo.price AS client_price,

                    CASE
                        WHEN cpo.price IS NOT NULL THEN cpo.price
                        ELSE pi.default_price
                    END AS effective_price,

                    CASE
                        WHEN cpo.price IS NOT NULL THEN 1
                        ELSE 0
                    END AS has_override
                FROM price_items pi
                LEFT JOIN client_price_overrides cpo
                    ON pi.id = cpo.price_item_id
                    AND cpo.client_id = %s
                ORDER BY pi.is_active DESC, pi.category ASC, pi.id ASC
                """,
                (client_id,)
            )

            return cursor.fetchall()

    finally:
        connection.close()


@router.put("/client/{client_id}")
def update_client_prices(
    client_id: int,
    data: ClientPriceOverrideUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Массово задать индивидуальные цены клиента.
    Если цена уже есть — обновит.
    Если нет — создаст.
    Доступ: ADMIN, MANAGER.
    """
    require_price_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, is_deleted
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            if client["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять цены клиента из корзины"
                )

            for item in data.prices:
                if item.price < 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Индивидуальная цена не может быть отрицательной"
                    )

                cursor.execute(
                    """
                    SELECT id
                    FROM price_items
                    WHERE id = %s
                    """,
                    (item.price_item_id,)
                )
                price_item = cursor.fetchone()

                if not price_item:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Цена с id={item.price_item_id} не найдена"
                    )

                cursor.execute(
                    """
                    INSERT INTO client_price_overrides (
                        client_id,
                        price_item_id,
                        price
                    )
                    VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        price = VALUES(price),
                        updated_at = NOW()
                    """,
                    (
                        client_id,
                        item.price_item_id,
                        item.price,
                    )
                )

            connection.commit()

            return {
                "message": "Индивидуальные цены клиента обновлены",
                "client_id": client_id,
                "updated_count": len(data.prices)
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/client/{client_id}/{price_item_id}")
def delete_client_price_override(
    client_id: int,
    price_item_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Сбросить индивидуальную цену клиента по одной позиции.
    После удаления будет использоваться базовая цена.
    Доступ: ADMIN, MANAGER.
    """
    require_price_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM client_price_overrides
                WHERE client_id = %s
                  AND price_item_id = %s
                """,
                (client_id, price_item_id)
            )

            connection.commit()

            return {
                "message": "Индивидуальная цена сброшена",
                "client_id": client_id,
                "price_item_id": price_item_id
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()