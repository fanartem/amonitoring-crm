from fastapi import APIRouter, Depends, HTTPException
from app.database import get_connection
from app.security import get_current_user
from app.schemas import (
    PriceItemCreate,
    PriceItemUpdate,
    ClientPriceOverrideUpdate,
    CalculateRequestPrice,
)
from app.permissions import (
    ADMIN,
    ROP,
    MANAGER,
    TECH_SUPPORT,
    ACCOUNTANT,
    has_any_permission,
    is_super_admin,
    is_client_owned_by_user,
)

router = APIRouter(prefix="/prices", tags=["Prices"])

ALLOWED_VISIT_PRICE_CODES = {
    "ON_SITE_CITY",
    "ON_SITE_OUTSIDE_CITY",
    "BUSINESS_TRIP_KM",
}

PRICE_READ_PERMISSION_CODES = [
    "prices.view",
    "prices.manage",
    "base_prices.view",
    "base_prices.manage",
    "client_prices.view",
    "client_prices.manage",
]

# Общий пакет управления базовыми ценами.
BASE_PRICE_MANAGE_PERMISSION_CODES = [
    "prices.manage",
    "prices.base.manage",
    "base_prices.manage",
]

# Отдельные операции. Зависимость base_prices.manage -> create/edit/delete/restore
# уже прописана в permission_dependencies, поэтому общая галочка даёт все четыре.
BASE_PRICE_CREATE_PERMISSION_CODES = [
    *BASE_PRICE_MANAGE_PERMISSION_CODES,
    "base_prices.create",
]

BASE_PRICE_EDIT_PERMISSION_CODES = [
    *BASE_PRICE_MANAGE_PERMISSION_CODES,
    "base_prices.edit",
]

BASE_PRICE_DELETE_PERMISSION_CODES = [
    *BASE_PRICE_MANAGE_PERMISSION_CODES,
    "base_prices.delete",
]

BASE_PRICE_RESTORE_PERMISSION_CODES = [
    *BASE_PRICE_MANAGE_PERMISSION_CODES,
    "base_prices.restore",
]

CLIENT_PRICE_VIEW_ALL_PERMISSION_CODES = [
    "prices.manage",
    "client_prices.view_all",
    "client_prices.manage_all",
]

CLIENT_PRICE_VIEW_OWN_PERMISSION_CODES = [
    "client_prices.view_own",
    "client_prices.manage_own",
]

CLIENT_PRICE_MANAGE_ALL_PERMISSION_CODES = [
    "prices.manage",
    "client_prices.manage_all",
]

CLIENT_PRICE_MANAGE_OWN_PERMISSION_CODES = [
    "client_prices.manage_own",
]

PRICE_CALCULATE_PERMISSION_CODES = [
    "prices.calculate",
    "prices.view",
    "prices.manage",
    "requests.price.calculate",
    "requests.prices.calculate",
    "requests.price.view",
    "requests.prices.view",
]

PRICE_READ_LEGACY_ROLES = [
    ADMIN,
    ROP,
    MANAGER,
    TECH_SUPPORT,
    ACCOUNTANT,
]

BASE_PRICE_MANAGE_LEGACY_ROLES = [
    ADMIN,
    ROP,
    MANAGER,
]

CLIENT_PRICE_VIEW_ALL_LEGACY_ROLES = [
    ADMIN,
    ROP,
    TECH_SUPPORT,
    ACCOUNTANT,
]

CLIENT_PRICE_MANAGE_ALL_LEGACY_ROLES = [
    ADMIN,
    ROP,
]

CLIENT_PRICE_VIEW_OWN_LEGACY_ROLES = [
    MANAGER,
]

CLIENT_PRICE_MANAGE_OWN_LEGACY_ROLES = [
    MANAGER,
]


def permissions_are_loaded(current_user: dict | None) -> bool:
    return current_user is not None and isinstance(current_user.get("permissions"), list)


def has_legacy_role(current_user: dict | None, roles: list[str]) -> bool:
    if not current_user or permissions_are_loaded(current_user):
        return False

    return current_user.get("role") in roles


def user_has_any_permission(current_user: dict, permission_codes: list[str]) -> bool:
    return is_super_admin(current_user) or has_any_permission(current_user, permission_codes)


def can_read_prices(current_user: dict) -> bool:
    return (
        user_has_any_permission(current_user, PRICE_READ_PERMISSION_CODES)
        or has_legacy_role(current_user, PRICE_READ_LEGACY_ROLES)
    )


def can_manage_base_prices_for_user(current_user: dict) -> bool:
    return (
        user_has_any_permission(current_user, BASE_PRICE_MANAGE_PERMISSION_CODES)
        or has_legacy_role(current_user, BASE_PRICE_MANAGE_LEGACY_ROLES)
    )


def can_calculate_prices(current_user: dict) -> bool:
    return (
        user_has_any_permission(current_user, PRICE_CALCULATE_PERMISSION_CODES)
        or has_legacy_role(current_user, PRICE_READ_LEGACY_ROLES)
    )


def can_view_all_client_prices(current_user: dict) -> bool:
    return (
        user_has_any_permission(current_user, CLIENT_PRICE_VIEW_ALL_PERMISSION_CODES)
        or has_legacy_role(current_user, CLIENT_PRICE_VIEW_ALL_LEGACY_ROLES)
    )


def can_view_own_client_prices(current_user: dict) -> bool:
    return (
        user_has_any_permission(current_user, CLIENT_PRICE_VIEW_OWN_PERMISSION_CODES)
        or has_legacy_role(current_user, CLIENT_PRICE_VIEW_OWN_LEGACY_ROLES)
    )


def can_manage_all_client_prices(current_user: dict) -> bool:
    return (
        user_has_any_permission(current_user, CLIENT_PRICE_MANAGE_ALL_PERMISSION_CODES)
        or has_legacy_role(current_user, CLIENT_PRICE_MANAGE_ALL_LEGACY_ROLES)
    )


def can_manage_own_client_prices_for_user(current_user: dict) -> bool:
    return (
        user_has_any_permission(current_user, CLIENT_PRICE_MANAGE_OWN_PERMISSION_CODES)
        or has_legacy_role(current_user, CLIENT_PRICE_MANAGE_OWN_LEGACY_ROLES)
    )


def require_price_read(current_user: dict):
    if not can_read_prices(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра цен"
        )


def require_price_calculate(current_user: dict):
    if not can_calculate_prices(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для расчёта цен"
        )


def require_base_price_action(
    current_user: dict,
    permission_codes: list[str],
    detail: str,
):
    if user_has_any_permission(current_user, permission_codes):
        return

    if has_legacy_role(current_user, BASE_PRICE_MANAGE_LEGACY_ROLES):
        return

    raise HTTPException(status_code=403, detail=detail)


def require_base_price_create(current_user: dict):
    require_base_price_action(
        current_user,
        BASE_PRICE_CREATE_PERMISSION_CODES,
        "Недостаточно прав для создания базовых цен",
    )


def require_base_price_edit(current_user: dict):
    require_base_price_action(
        current_user,
        BASE_PRICE_EDIT_PERMISSION_CODES,
        "Недостаточно прав для редактирования базовых цен",
    )


def require_base_price_delete(current_user: dict):
    require_base_price_action(
        current_user,
        BASE_PRICE_DELETE_PERMISSION_CODES,
        "Недостаточно прав для отключения базовых цен",
    )


def require_base_price_restore(current_user: dict):
    require_base_price_action(
        current_user,
        BASE_PRICE_RESTORE_PERMISSION_CODES,
        "Недостаточно прав для восстановления базовых цен",
    )


def can_access_client_prices(client: dict, current_user: dict) -> bool:
    if can_view_all_client_prices(current_user):
        return True

    if can_view_own_client_prices(current_user):
        return is_client_owned_by_user(client, current_user)

    return False


def can_update_client_prices(client: dict, current_user: dict) -> bool:
    if can_manage_all_client_prices(current_user):
        return True

    if can_manage_own_client_prices_for_user(current_user):
        return is_client_owned_by_user(client, current_user)

    return False


def require_client_price_update(client: dict, current_user: dict):
    if not can_update_client_prices(client, current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для изменения индивидуальных цен этого клиента"
        )


def money(value) -> float:
    if value is None:
        return 0

    return float(value)


def add_price_line(
    lines: list,
    *,
    code: str | None,
    label: str,
    quantity: float,
    unit_price: float,
    unit: str = "шт",
    source: str = "manual",
    vehicle_index: int | None = None,
):
    quantity = float(quantity or 0)
    unit_price = float(unit_price or 0)
    total_price = quantity * unit_price

    if quantity <= 0:
        return

    lines.append({
        "line_key": f"{vehicle_index if vehicle_index is not None else 'request'}:{code or label}",
        "vehicle_index": vehicle_index,
        "code": code,
        "label": label,
        "quantity": quantity,
        "unit": unit,
        "unit_price": unit_price,
        "total_price": total_price,
        "source": source,
    })


def get_effective_price(cursor, price_code: str, client_id: int | None):
    """
    Возвращает цену по code:
    - если client_id есть и для клиента задан override — берём client_price
    - иначе default_price
    """
    if client_id:
        cursor.execute(
            """
            SELECT
                pi.id,
                pi.code,
                pi.name,
                pi.category,
                pi.default_price,
                pi.unit,
                pi.is_active,
                cpo.price AS client_price
            FROM price_items pi
            LEFT JOIN client_price_overrides cpo
                ON pi.id = cpo.price_item_id
                AND cpo.client_id = %s
            WHERE pi.code = %s
              AND pi.is_active = 1
            """,
            (client_id, price_code)
        )
    else:
        cursor.execute(
            """
            SELECT
                pi.id,
                pi.code,
                pi.name,
                pi.category,
                pi.default_price,
                pi.unit,
                pi.is_active,
                NULL AS client_price
            FROM price_items pi
            WHERE pi.code = %s
              AND pi.is_active = 1
            """,
            (price_code,)
        )

    item = cursor.fetchone()

    if not item:
        return None

    has_override = item["client_price"] is not None
    effective_price = money(item["client_price"] if has_override else item["default_price"])

    return {
        "id": item["id"],
        "code": item["code"],
        "name": item["name"],
        "category": item["category"],
        "unit": item["unit"] or "шт",
        "unit_price": effective_price,
        "source": "client_override" if has_override else "base",
    }

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
    require_base_price_create(current_user)

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
    require_base_price_edit(current_user)

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
    require_base_price_delete(current_user)

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
    require_base_price_restore(current_user)

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
                SELECT
                    id,
                    created_by,
                    responsible_manager_id,
                    is_deleted
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
            
            if not can_access_client_prices(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра индивидуальных цен этого клиента"
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
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    created_by,
                    responsible_manager_id,
                    is_deleted
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
            
            require_client_price_update(client, current_user)

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
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    created_by,
                    responsible_manager_id,
                    is_deleted
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

            require_client_price_update(client, current_user)

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

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/calculate-request")
def calculate_request_price(
    data: CalculateRequestPrice,
    current_user: dict = Depends(get_current_user)
):
    """
    Рассчитать стоимость черновика заявки.
    Ничего не сохраняет в БД.
    Доступ: ADMIN, MANAGER, ACCOUNTANT.
    """
    require_price_calculate(current_user)

    work_type = data.work_type.upper()
    visit_type = data.visit_type.upper()

    allowed_work_types = ["INSTALLATION", "REMOVAL", "DIAGNOSTIC", "REFLASHING"]
    allowed_visit_types = ["IN_OFFICE", "ON_SITE"]

    if work_type not in allowed_work_types:
        raise HTTPException(status_code=400, detail="Некорректный тип работ")

    if visit_type not in allowed_visit_types:
        raise HTTPException(status_code=400, detail="Некорректный формат работ")

    lines = []

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            # Проверяем клиента, если client_id передан
            if data.client_id:
                cursor.execute(
                    """
                    SELECT
                        id,
                        created_by,
                        responsible_manager_id,
                        is_deleted
                    FROM clients
                    WHERE id = %s
                    """,
                    (data.client_id,)
                )
                client = cursor.fetchone()

                if not client:
                    raise HTTPException(status_code=404, detail="Клиент не найден")

                if client["is_deleted"]:
                    raise HTTPException(
                        status_code=400,
                        detail="Клиент находится в корзине"
                    )
                
                if not can_access_client_prices(client, current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для расчёта цен этого клиента"
                    )

            # Транспортные расходы
            if visit_type == "ON_SITE":
                visit_code = (data.visit_price_code or "ON_SITE_CITY").strip().upper()

                if visit_code not in ALLOWED_VISIT_PRICE_CODES:
                    raise HTTPException(
                        status_code=400,
                        detail="Некорректный тип выезда",
                    )

                if visit_code == "BUSINESS_TRIP_KM":
                    km = float(data.visit_km or 0)

                    if km <= 0:
                        raise HTTPException(
                            status_code=400,
                            detail="Для командировки укажите километраж больше 0"
                        )

                    item = get_effective_price(cursor, "BUSINESS_TRIP_KM", data.client_id)

                    if item:
                        add_price_line(
                            lines,
                            code=item["code"],
                            label=item["name"],
                            quantity=km,
                            unit_price=item["unit_price"],
                            unit=item["unit"],
                            source=item["source"],
                            vehicle_index=None,
                        )
                else:
                    item = get_effective_price(cursor, visit_code, data.client_id)

                    if item:
                        add_price_line(
                            lines,
                            code=item["code"],
                            label=item["name"],
                            quantity=1,
                            unit_price=item["unit_price"],
                            unit=item["unit"],
                            source=item["source"],
                            vehicle_index=None,
                        )

            # Установка
            if work_type == "INSTALLATION":
                for index, vehicle in enumerate(data.vehicles, start=1):
                    # GPS-трекер необязателен: бывают заявки только с маяком
                    if vehicle.gps_price_code:
                        gps_item = get_effective_price(
                            cursor,
                            vehicle.gps_price_code,
                            data.client_id
                        )

                        if not gps_item:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Цена GPS '{vehicle.gps_price_code}' не найдена или отключена"
                            )

                        add_price_line(
                            lines,
                            code=gps_item["code"],
                            label=f"Авто {index}: {gps_item['name']}",
                            quantity=1,
                            unit_price=gps_item["unit_price"],
                            unit=gps_item["unit"],
                            source=gps_item["source"],
                            vehicle_index=index,
                        )

                        # Подписка трекера отдельной строкой
                        tracker_months = int(vehicle.tracker_subscription_months or 0)

                        if tracker_months < 0:
                            raise HTTPException(
                                status_code=400,
                                detail="Количество месяцев подписки трекера не может быть отрицательным"
                            )

                        if tracker_months > 0:
                            subscription_item = get_effective_price(
                                cursor,
                                "SUBSCRIPTION_TRACKER_MONTH",
                                data.client_id
                            )

                            if subscription_item:
                                add_price_line(
                                    lines,
                                    code=subscription_item["code"],
                                    label=f"Авто {index}: {subscription_item['name']}",
                                    quantity=tracker_months,
                                    unit_price=subscription_item["unit_price"],
                                    unit=subscription_item["unit"],
                                    source=subscription_item["source"],
                                    vehicle_index=index,
                                )

                    # Маяк + подписка маяка
                    if vehicle.has_beacon:
                        beacon_item = get_effective_price(
                            cursor,
                            "BEACON_TAT100",
                            data.client_id
                        )

                        if beacon_item:
                            add_price_line(
                                lines,
                                code=beacon_item["code"],
                                label=f"Авто {index}: {beacon_item['name']}",
                                quantity=1,
                                unit_price=beacon_item["unit_price"],
                                unit=beacon_item["unit"],
                                source=beacon_item["source"],
                                vehicle_index=index,
                            )

                        beacon_months = int(vehicle.beacon_subscription_months or 0)

                        if beacon_months < 0:
                            raise HTTPException(
                                status_code=400,
                                detail="Количество месяцев подписки маяка не может быть отрицательным"
                            )

                        if beacon_months > 0:
                            beacon_subscription_item = get_effective_price(
                                cursor,
                                "SUBSCRIPTION_BEACON_MONTH",
                                data.client_id
                            )

                            if beacon_subscription_item:
                                add_price_line(
                                    lines,
                                    code=beacon_subscription_item["code"],
                                    label=f"Авто {index}: {beacon_subscription_item['name']}",
                                    quantity=beacon_months,
                                    unit_price=beacon_subscription_item["unit_price"],
                                    unit=beacon_subscription_item["unit"],
                                    source=beacon_subscription_item["source"],
                                    vehicle_index=index,
                                )

                    # Услуга установки GPS: с блокировкой или без блокировки.
                    # Важно: GPS_NO_BLOCK добавляем только если выбран GPS-трекер.
                    # Иначе заявка "только маяк" тоже получила бы цену установки GPS.
                    if vehicle.gps_price_code:
                        install_service_code = (
                            "ENGINE_BLOCKING_INSTALL"
                            if vehicle.has_blocking
                            else "GPS_NO_BLOCK"
                        )

                        install_service_item = get_effective_price(
                            cursor,
                            install_service_code,
                            data.client_id
                        )

                        if install_service_item:
                            add_price_line(
                                lines,
                                code=install_service_item["code"],
                                label=f"Авто {index}: {install_service_item['name']}",
                                quantity=1,
                                unit_price=install_service_item["unit_price"],
                                unit=install_service_item["unit"],
                                source=install_service_item["source"],
                                vehicle_index=index,
                            )

                    # Дополнительные датчики из формы авто
                    for sensor in vehicle.extra_sensors:
                        sensor_name = sensor.name.strip()

                        if not sensor_name:
                            continue

                        sensor_price = float(sensor.price or 0)

                        if sensor_price < 0:
                            raise HTTPException(
                                status_code=400,
                                detail="Цена дополнительного датчика не может быть отрицательной"
                            )

                        add_price_line(
                            lines,
                            code=None,
                            label=f"Авто {index}: {sensor_name}",
                            quantity=1,
                            unit_price=sensor_price,
                            unit="шт",
                            source="extra_sensor",
                            vehicle_index=index,
                        )

            # Снятие
            elif work_type == "REMOVAL":
                removal_item = get_effective_price(
                    cursor,
                    "REMOVAL_BASE",
                    data.client_id
                )

                vehicle_count = max(len(data.vehicles), 1)

                if removal_item:
                    for index in range(1, vehicle_count + 1):
                        add_price_line(
                            lines,
                            code=removal_item["code"],
                            label=f"Авто {index}: {removal_item['name']}",
                            quantity=1,
                            unit_price=removal_item["unit_price"],
                            unit=removal_item["unit"],
                            source=removal_item["source"],
                            vehicle_index=index,
                        )

            # Диагностика
            elif work_type == "DIAGNOSTIC":
                if data.has_power_restore:
                    restore_item = get_effective_price(
                        cursor,
                        "POWER_RESTORE",
                        data.client_id
                    )

                    if restore_item:
                        add_price_line(
                            lines,
                            code=restore_item["code"],
                            label=restore_item["name"],
                            quantity=1,
                            unit_price=restore_item["unit_price"],
                            unit=restore_item["unit"],
                            source=restore_item["source"],
                            vehicle_index=None,
                        )

            # Перепрошивка
            elif work_type == "REFLASHING":
                reflashing_item = get_effective_price(
                    cursor,
                    "REFLASHING_BASE",
                    data.client_id
                )

                vehicle_count = max(len(data.vehicles), 1)

                if reflashing_item:
                    for index in range(1, vehicle_count + 1):
                        add_price_line(
                            lines,
                            code=reflashing_item["code"],
                            label=f"Авто {index}: {reflashing_item['name']}",
                            quantity=1,
                            unit_price=reflashing_item["unit_price"],
                            unit=reflashing_item["unit"],
                            source=reflashing_item["source"],
                            vehicle_index=index,
                        )

            # Ручные строки калькулятора
            for manual_line in data.manual_lines:
                label = manual_line.label.strip()

                if not label:
                    continue

                quantity = float(manual_line.quantity or 0)
                unit_price = float(manual_line.unit_price or 0)

                if quantity <= 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Количество в ручной строке должно быть больше 0"
                    )

                if unit_price < 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Цена в ручной строке не может быть отрицательной"
                    )

                add_price_line(
                    lines,
                    code=None,
                    label=label,
                    quantity=quantity,
                    unit_price=unit_price,
                    unit="шт",
                    source="manual",
                    vehicle_index=None,
                )

            total_price = sum(line["total_price"] for line in lines)

            return {
                "total_price": total_price,
                "lines": lines,
                "currency": "KZT",
            }

    finally:
        connection.close()