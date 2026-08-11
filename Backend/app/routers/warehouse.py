from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File, Form
from io import StringIO
import csv
import json

from app.database import get_connection
from app.security import get_current_user
from app.schemas import (
    WarehouseItemCreate,
    WarehouseItemUpdate,
    WarehouseItemTransfer,
    WarehouseItemAssignToUser,
    WarehouseItemReturnToStock,
    WarehouseManualAddToUser,
    WarehouseInventoryTransfer,
    WarehouseConsumableThresholdUpdate,
    RequestEquipmentAttach,
    VehicleEquipmentAttach,
    VehicleEquipmentDetach,
)

router = APIRouter(prefix="/warehouse", tags=["Warehouse"])

WAREHOUSE_MANAGE_ROLES = ["ADMIN", "WAREHOUSE_MANAGER"]

INVENTORY_FULL_READ_ROLES = [
    "ADMIN",
    "WAREHOUSE_MANAGER",
    "SENIOR_TECHNICIAN",
]

REQUEST_EQUIPMENT_DETACH_TIME_LIMIT_SECONDS = 120

REQUEST_EQUIPMENT_LIMITED_DETACH_ROLES = [
    "TECHNICIAN",
    "SENIOR_TECHNICIAN",
]

# Полноценный доступ к странице склада: список, группировка, история, корзина
WAREHOUSE_FULL_READ_ROLES = ["ADMIN", "WAREHOUSE_MANAGER"]

# Просмотр оборудования только внутри заявки/автомобиля
REQUEST_EQUIPMENT_READ_ROLES = [
    "ADMIN",
    "ROP",
    "WAREHOUSE_MANAGER",
    "MANAGER",
    "TECH_SUPPORT",
    "SENIOR_TECHNICIAN",
    "TECHNICIAN",
]

ALLOWED_CATEGORIES = [
    "GPS_TRACKER",
    "BEACON",
    "FUEL_SENSOR",
    "BLE_SENSOR",
    "WIRED_SENSOR",
    "RELAY",
    "CABLE",
    "CONSUMABLE",
    "TOOLS",
    "FIRST_AID",
    "OTHER",
]

ALLOWED_IDENTIFIER_TYPES = [
    "IMEI",
    "MAC",
    "SERIAL",
    "NONE",
    "OTHER",
]

ALLOWED_STATUSES = [
    "IN_STOCK",
    "RESERVED",
    "ASSIGNED_TO_TECH",
    "INSTALLED",
    "USED",
    "REPAIR",
    "LOST",
    "WRITTEN_OFF",
]

ALLOWED_CONDITION_STATUSES = [
    "NEW",
    "USED",
]

def require_warehouse_full_read(current_user: dict):
    if current_user["role"] not in WAREHOUSE_FULL_READ_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра склада"
        )

def require_request_equipment_read(current_user: dict):
    if current_user["role"] not in REQUEST_EQUIPMENT_READ_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра оборудования заявки"
        )

def require_request_equipment_attach(current_user: dict):
    if current_user["role"] not in [
        "ADMIN",
        "WAREHOUSE_MANAGER",
        "SENIOR_TECHNICIAN",
        "TECHNICIAN",
    ]:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для добавления оборудования в заявку"
        )

def enrich_request_equipment_detach_permissions(
    rows: list[dict],
    current_user: dict,
) -> list[dict]:
    """
    Добавляет frontend-поля:
    - can_detach
    - detach_seconds_left
    - detach_time_limit_seconds

    ADMIN / WAREHOUSE_MANAGER могут отвязать всегда.
    TECHNICIAN / SENIOR_TECHNICIAN могут отвязать только своё оборудование
    в течение 2 минут после attached_at.
    """
    role = current_user.get("role")
    user_id = int(current_user["id"])

    can_detach_without_time_limit = role in WAREHOUSE_MANAGE_ROLES
    can_detach_with_time_limit = role in REQUEST_EQUIPMENT_LIMITED_DETACH_ROLES

    for row in rows:
        age_seconds_raw = row.get("detach_age_seconds")
        age_seconds = int(age_seconds_raw or 0)

        seconds_left = max(
            0,
            REQUEST_EQUIPMENT_DETACH_TIME_LIMIT_SECONDS - age_seconds,
        )

        is_attached_by_current_user = (
            row.get("attached_by") is not None
            and int(row["attached_by"]) == user_id
        )

        row["detach_time_limit_seconds"] = REQUEST_EQUIPMENT_DETACH_TIME_LIMIT_SECONDS
        row["detach_seconds_left"] = 0
        row["can_detach"] = False

        if can_detach_without_time_limit:
            row["can_detach"] = True
            row["detach_seconds_left"] = None
            continue

        if (
            can_detach_with_time_limit
            and is_attached_by_current_user
            and seconds_left > 0
        ):
            row["can_detach"] = True
            row["detach_seconds_left"] = seconds_left

    return rows
    
def require_vehicle_equipment_manage(current_user: dict):
    if current_user["role"] not in WAREHOUSE_MANAGE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Привязывать оборудование напрямую к авто могут только Админ или Зав. складом"
        )


def can_user_access_vehicle_equipment(vehicle: dict, current_user: dict) -> bool:
    role = current_user.get("role")
    user_id = int(current_user["id"])

    if role in ["ADMIN", "ROP", "WAREHOUSE_MANAGER", "TECH_SUPPORT"]:
        return True

    if role == "SENIOR_TECHNICIAN":
        return True

    if role == "MANAGER":
        created_by = vehicle.get("client_created_by")
        responsible_manager_id = vehicle.get("responsible_manager_id")

        return (
            created_by is not None and int(created_by) == user_id
        ) or (
            responsible_manager_id is not None
            and int(responsible_manager_id) == user_id
        )

    return False
    
def normalize_city(value):
    if value is None:
        return None
    return str(value).strip().lower()


def can_user_access_request_equipment(request: dict, current_user: dict) -> bool:
    role = current_user.get("role")
    user_id = int(current_user["id"])

    if role in ["ADMIN", "ROP", "WAREHOUSE_MANAGER", "TECH_SUPPORT"]:
        return True

    if role == "SENIOR_TECHNICIAN":
        return True

    if role == "MANAGER":
        created_by = request.get("created_by")
        responsible_manager_id = request.get("responsible_manager_id")

        return (
            created_by is not None and int(created_by) == user_id
        ) or (
            responsible_manager_id is not None
            and int(responsible_manager_id) == user_id
        )

    if role == "TECHNICIAN":
        assigned_to = request.get("assigned_to")

        # Если заявка уже назначена этому монтажнику — даём доступ к оборудованию,
        # даже если оплата/город отличаются. Он уже исполнитель заявки.
        if assigned_to is not None:
            return int(assigned_to) == user_id

        # Если заявка ещё свободная — монтажник может видеть оборудование
        # только для оплаченной заявки своего города.
        if not request.get("is_paid"):
            return False

        if normalize_city(request.get("city")) != normalize_city(current_user.get("city")):
            return False

        return True

    return False

def require_warehouse_manage(current_user: dict):
    if current_user["role"] not in WAREHOUSE_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Недостаточно прав для управления складом")
    
def require_inventory_full_read(current_user: dict):
    if current_user["role"] not in INVENTORY_FULL_READ_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра инвентаря монтажников"
        )

def validate_warehouse_item(data: dict):
    category = data.get("category")
    identifier_type = data.get("identifier_type", "NONE")
    identifier_value = data.get("identifier_value")
    is_serialized = data.get("is_serialized", True)
    quantity = data.get("quantity", 1)
    city_id = data.get("city_id")
    condition_status = normalize_condition_status(data.get("condition_status"))
    data["condition_status"] = condition_status

    if category is not None and category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Некорректная категория оборудования")

    if identifier_type is not None and identifier_type not in ALLOWED_IDENTIFIER_TYPES:
        raise HTTPException(status_code=400, detail="Некорректный тип идентификатора")

    if quantity is not None and quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")
    
    if city_id is None:
        raise HTTPException(status_code=400, detail="Необходимо выбрать город склада")

    if is_serialized:
        if quantity != 1:
            raise HTTPException(status_code=400, detail="У серийного оборудования quantity должен быть 1")

        if identifier_type == "NONE":
            raise HTTPException(status_code=400, detail="Для серийного оборудования нужен identifier_type")

        if not identifier_value:
            raise HTTPException(status_code=400, detail="Для серийного оборудования нужен identifier_value")

    if not is_serialized:
        if identifier_type == "NONE":
            return

        if identifier_type != "NONE" and identifier_value:
            raise HTTPException(
                status_code=400,
                detail="Несерийное оборудование не должно иметь уникальный identifier_value"
            )

def parse_bool(value):
    if isinstance(value, bool):
        return value

    if value is None:
        return False

    value = str(value).strip().lower()

    if value in ["true", "1", "yes", "y", "да"]:
        return True

    if value in ["false", "0", "no", "n", "нет", ""]:
        return False

    raise HTTPException(status_code=400, detail=f"Некорректное boolean значение: {value}")

def normalize_condition_status(value):
    if value is None:
        return "NEW"

    value = str(value).strip().upper()

    if value in ["", "NEW", "НОВОЕ", "НОВЫЙ", "НОВАЯ", "0", "FALSE", "NO", "N", "НЕТ"]:
        return "NEW"

    if value in ["USED", "БУ", "Б/У", "B/U", "БЫВШЕЕ", "БЫВШИЙ", "1", "TRUE", "YES", "Y", "ДА"]:
        return "USED"

    raise HTTPException(
        status_code=400,
        detail="Некорректное состояние оборудования. Допустимо: пусто/NEW/Новое или USED/БУ"
    )

def parse_int(value, default=0):
    if value is None or str(value).strip() == "":
        return default

    try:
        return int(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Некорректное числовое значение: {value}")
    
def normalize_group_key(value):
    return " ".join(str(value or "").strip().lower().split())

def empty_status_counts():
    return {status: 0 for status in ALLOWED_STATUSES}

def add_status_count(counts: dict, status: str, quantity: int):
    status_key = status if status in ALLOWED_STATUSES else "IN_STOCK"
    counts[status_key] = int(counts.get(status_key, 0)) + int(quantity or 0)

def get_warehouse_item_quantity(row):
    if bool(row.get("is_serialized")):
        return 1

    return int(row.get("quantity") or 0)

def get_item_group_name(row):
    """
    Группируем по name, потому что заведующий складом при импорте
    чаще всего заполняет только 'Наименование'.
    """
    return str(row.get("name") or "Без наименования").strip() or "Без наименования"

def get_city_by_id(cursor, city_id: int):
    cursor.execute(
        """
        SELECT id, name
        FROM cities
        WHERE id = %s AND is_active = 1
        """,
        (city_id,)
    )
    return cursor.fetchone()


def require_city(cursor, city_id: int):
    city = get_city_by_id(cursor, city_id)

    if not city:
        raise HTTPException(status_code=400, detail="Город не найден или отключён")

    return city

def add_warehouse_movement(
    cursor,
    warehouse_item_id: int,
    action: str,
    current_user: dict,
    from_city_id: int | None = None,
    to_city_id: int | None = None,
    request_id: int | None = None,
    request_vehicle_id: int | None = None,
    vehicle_id: int | None = None,
    request_equipment_id: int | None = None,
    target_user_id: int | None = None,
    from_user_id: int | None = None,
    quantity: int | None = None,
    old_status: str | None = None,
    new_status: str | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
    reason: str | None = None,
):
    cursor.execute(
        """
        INSERT INTO warehouse_item_movements (
            warehouse_item_id,
            action,
            from_city_id,
            to_city_id,
            request_id,
            request_vehicle_id,
            vehicle_id,
            request_equipment_id,
            target_user_id,
            from_user_id,
            quantity,
            old_status,
            new_status,
            old_value,
            new_value,
            reason,
            created_by
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            warehouse_item_id,
            action,
            from_city_id,
            to_city_id,
            request_id,
            request_vehicle_id,
            vehicle_id,
            request_equipment_id,
            target_user_id,
            from_user_id,
            quantity,
            old_status,
            new_status,
            old_value,
            new_value,
            reason,
            current_user["id"],
        )
    )

def normalize_consumable_key(row: dict):
    return (
        str(row.get("category") or "").strip(),
        normalize_group_key(row.get("name")),
        normalize_group_key(row.get("manufacturer")),
        normalize_group_key(row.get("model")),
    )


def find_consumable_in_city(cursor, item: dict, city_id: int):
    cursor.execute(
        """
        SELECT *
        FROM warehouse_items
        WHERE is_deleted = 0
          AND is_serialized = 0
          AND status = 'IN_STOCK'
          AND assigned_to_user_id IS NULL
          AND category = %s
          AND LOWER(TRIM(name)) = LOWER(TRIM(%s))
          AND COALESCE(LOWER(TRIM(manufacturer)), '') = COALESCE(LOWER(TRIM(%s)), '')
          AND COALESCE(LOWER(TRIM(model)), '') = COALESCE(LOWER(TRIM(%s)), '')
          AND condition_status = %s
          AND city_id = %s
        LIMIT 1
        """,
        (
            item.get("category"),
            item.get("name"),
            item.get("manufacturer"),
            item.get("model"),
            normalize_condition_status(item.get("condition_status")),
            city_id,
        )
    )

    return cursor.fetchone()

def find_serialized_by_identifier(cursor, identifier_type: str, identifier_value: str):
    cursor.execute(
        """
        SELECT *
        FROM warehouse_items
        WHERE is_deleted = 0
          AND is_serialized = 1
          AND identifier_type = %s
          AND identifier_value = %s
        LIMIT 1
        """,
        (identifier_type, identifier_value)
    )

    return cursor.fetchone()

def require_inventory_target_user(cursor, target_user_id: int):
    cursor.execute(
        """
        SELECT id, name, role, city, is_approved
        FROM users
        WHERE id = %s
        LIMIT 1
        """,
        (target_user_id,)
    )

    user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="Монтажник не найден")

    if user["role"] not in ["TECHNICIAN", "SENIOR_TECHNICIAN"]:
        raise HTTPException(
            status_code=400,
            detail="Инвентарь можно выдавать только монтажнику или старшему монтажнику"
        )

    if not user["is_approved"]:
        raise HTTPException(
            status_code=400,
            detail="Нельзя выдать инвентарь неутверждённому пользователю"
        )

    return user


def find_assigned_consumable_for_user(
    cursor,
    item: dict,
    city_id: int,
    target_user_id: int,
):
    cursor.execute(
        """
        SELECT *
        FROM warehouse_items
        WHERE is_deleted = 0
          AND is_serialized = 0
          AND status = 'ASSIGNED_TO_TECH'
          AND assigned_to_user_id = %s
          AND category = %s
          AND LOWER(TRIM(name)) = LOWER(TRIM(%s))
          AND COALESCE(LOWER(TRIM(manufacturer)), '') = COALESCE(LOWER(TRIM(%s)), '')
          AND COALESCE(LOWER(TRIM(model)), '') = COALESCE(LOWER(TRIM(%s)), '')
          AND condition_status = %s
          AND city_id = %s
        LIMIT 1
        """,
        (
            target_user_id,
            item.get("category"),
            item.get("name"),
            item.get("manufacturer"),
            item.get("model"),
            normalize_condition_status(item.get("condition_status")),
            city_id,
        )
    )

    return cursor.fetchone()


def get_consumable_threshold(cursor, item: dict, city_id: int) -> int:
    cursor.execute(
        """
        SELECT threshold_quantity
        FROM warehouse_consumable_thresholds
        WHERE city_id = %s
          AND category = %s
          AND LOWER(TRIM(name)) = LOWER(TRIM(%s))
          AND LOWER(TRIM(manufacturer)) = COALESCE(LOWER(TRIM(%s)), '')
          AND LOWER(TRIM(model)) = COALESCE(LOWER(TRIM(%s)), '')
        LIMIT 1
        """,
        (
            city_id,
            item.get("category"),
            item.get("name"),
            item.get("manufacturer"),
            item.get("model"),
        )
    )

    row = cursor.fetchone()

    if not row:
        return 20

    return int(row["threshold_quantity"] or 20)


def fetch_inventory_rows(
    cursor,
    user_id: int | None = None,
    city_id: int | None = None,
    category: str | None = None,
    status: str | None = None,
    search: str | None = None,
    low_stock: bool = False,
):
    conditions = [
        "wi.is_deleted = 0",
        "wi.assigned_to_user_id IS NOT NULL",
    ]
    values = []

    if user_id:
        conditions.append("wi.assigned_to_user_id = %s")
        values.append(user_id)

    if city_id:
        conditions.append("wi.city_id = %s")
        values.append(city_id)

    if category:
        conditions.append("wi.category = %s")
        values.append(category)

    if status:
        conditions.append("wi.status = %s")
        values.append(status)

    if search:
        conditions.append(
            """
            (
                wi.name LIKE %s OR
                wi.manufacturer LIKE %s OR
                wi.model LIKE %s OR
                wi.identifier_value LIKE %s OR
                wi.serial_number LIKE %s OR
                wi.note LIKE %s OR
                assigned_user.name LIKE %s
            )
            """
        )
        like_value = f"%{search}%"
        values.extend([
            like_value,
            like_value,
            like_value,
            like_value,
            like_value,
            like_value,
            like_value,
        ])

    where_clause = " AND ".join(conditions)

    cursor.execute(
        f"""
        SELECT
            wi.id,
            wi.category,
            wi.name,
            wi.manufacturer,
            wi.model,
            wi.identifier_type,
            wi.identifier_value,
            wi.serial_number,
            wi.is_serialized,
            wi.quantity,
            wi.city_id,
            city.name AS city_name,
            wi.assigned_to_user_id,
            assigned_user.name AS assigned_to_user_name,
            assigned_user.role AS assigned_to_user_role,
            assigned_user.city AS assigned_to_user_city,
            wi.assigned_at,
            assigned_by_user.name AS assigned_by_name,
            wi.status,
            wi.condition_status,
            wi.note,
            wi.created_at,
            wi.updated_at,
            creator.name AS created_by_name,

            COALESCE(thresholds.threshold_quantity, 20) AS threshold_quantity

        FROM warehouse_items wi

        LEFT JOIN cities city ON wi.city_id = city.id
        LEFT JOIN users assigned_user ON wi.assigned_to_user_id = assigned_user.id
        LEFT JOIN users assigned_by_user ON wi.assigned_by = assigned_by_user.id
        LEFT JOIN users creator ON wi.created_by = creator.id

        LEFT JOIN warehouse_consumable_thresholds thresholds
            ON thresholds.city_id = wi.city_id
            AND thresholds.category = wi.category
            AND LOWER(TRIM(thresholds.name)) = LOWER(TRIM(wi.name))
            AND LOWER(TRIM(thresholds.manufacturer)) = COALESCE(LOWER(TRIM(wi.manufacturer)), '')
            AND LOWER(TRIM(thresholds.model)) = COALESCE(LOWER(TRIM(wi.model)), '')

        WHERE {where_clause}

        ORDER BY
            city.name ASC,
            assigned_user.name ASC,
            wi.category ASC,
            wi.name ASC,
            wi.status ASC,
            wi.created_at DESC
        """,
        tuple(values),
    )

    rows = cursor.fetchall()

    for row in rows:
        quantity = get_warehouse_item_quantity(row)
        threshold_quantity = int(row.get("threshold_quantity") or 20)

        row["is_low_stock"] = (
            not bool(row.get("is_serialized"))
            and quantity <= threshold_quantity
        )

    if low_stock:
        rows = [row for row in rows if row.get("is_low_stock")]

    return rows


def group_inventory_rows(rows: list[dict]) -> list[dict]:
    categories_map = {}

    for row in rows:
        item_quantity = get_warehouse_item_quantity(row)
        category_key = row.get("category") or "OTHER"
        category_name = category_key

        if category_key not in categories_map:
            categories_map[category_key] = {
                "category": category_key,
                "category_name": category_name,
                "counts": empty_status_counts(),
                "total_quantity": 0,
                "total_rows": 0,
                "groups": {},
            }

        category_group = categories_map[category_key]

        add_status_count(
            category_group["counts"],
            row.get("status"),
            item_quantity,
        )

        category_group["total_quantity"] += item_quantity
        category_group["total_rows"] += 1

        item_group_name = get_item_group_name(row)
        item_group_key = normalize_group_key(
            f"{item_group_name}|{row.get('manufacturer') or ''}|{row.get('model') or ''}"
        )

        if item_group_key not in category_group["groups"]:
            category_group["groups"][item_group_key] = {
                "group_key": item_group_key,
                "name": item_group_name,
                "manufacturer": row.get("manufacturer"),
                "model": row.get("model"),
                "is_consumable_group": not bool(row.get("is_serialized")),
                "counts": empty_status_counts(),
                "total_quantity": 0,
                "total_rows": 0,
                "items": [],
            }

        item_group = category_group["groups"][item_group_key]

        add_status_count(
            item_group["counts"],
            row.get("status"),
            item_quantity,
        )

        item_group["total_quantity"] += item_quantity
        item_group["total_rows"] += 1

        if bool(row.get("is_serialized")):
            item_group["is_consumable_group"] = False

        item_group["items"].append(row)

    result = []

    for category_data in categories_map.values():
        groups = list(category_data["groups"].values())

        groups.sort(
            key=lambda group: (
                group["name"].lower(),
                group["manufacturer"] or "",
                group["model"] or "",
            )
        )

        for group in groups:
            group["items"].sort(
                key=lambda item: (
                    item.get("assigned_to_user_name") or "",
                    item.get("status") or "",
                    item.get("identifier_value") or "",
                    item.get("serial_number") or "",
                    -int(item.get("id") or 0),
                )
            )

        category_data["groups"] = groups
        result.append(category_data)

    result.sort(key=lambda item: item["category"])

    return result

@router.get("/inventory/my")
def get_my_inventory(
    category: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    low_stock: bool = Query(False),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] not in ["TECHNICIAN", "SENIOR_TECHNICIAN"]:
        raise HTTPException(
            status_code=403,
            detail="Этот раздел доступен только монтажникам"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            rows = fetch_inventory_rows(
                cursor=cursor,
                user_id=current_user["id"],
                category=category,
                status=status,
                search=search,
                low_stock=low_stock,
            )

            return group_inventory_rows(rows)

    finally:
        connection.close()

@router.get("/inventory")
def get_inventory(
    city_id: int | None = Query(None),
    user_id: int | None = Query(None),
    category: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    low_stock: bool = Query(False),
    current_user: dict = Depends(get_current_user),
):
    require_inventory_full_read(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            rows = fetch_inventory_rows(
                cursor=cursor,
                user_id=user_id,
                city_id=city_id,
                category=category,
                status=status,
                search=search,
                low_stock=low_stock,
            )

            return group_inventory_rows(rows)

    finally:
        connection.close()

@router.post("/items/{item_id}/assign-to-user")
def assign_warehouse_item_to_user(
    item_id: int,
    data: WarehouseItemAssignToUser,
    current_user: dict = Depends(get_current_user),
):
    require_warehouse_manage(current_user)

    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            target_user = require_inventory_target_user(cursor, data.target_user_id)

            cursor.execute(
                """
                SELECT *
                FROM warehouse_items
                WHERE id = %s
                  AND is_deleted = 0
                FOR UPDATE
                """,
                (item_id,)
            )

            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["status"] != "IN_STOCK" or item.get("assigned_to_user_id"):
                raise HTTPException(
                    status_code=400,
                    detail="Выдать можно только предмет со статусом 'На складе'"
                )

            is_serialized = bool(item["is_serialized"])

            if is_serialized:
                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET status = 'ASSIGNED_TO_TECH',
                        assigned_to_user_id = %s,
                        assigned_at = NOW(),
                        assigned_by = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        data.target_user_id,
                        current_user["id"],
                        item_id,
                    )
                )

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="ASSIGNED_TO_TECH",
                    current_user=current_user,
                    from_city_id=item.get("city_id"),
                    to_city_id=item.get("city_id"),
                    target_user_id=data.target_user_id,
                    quantity=1,
                    old_status=item.get("status"),
                    new_status="ASSIGNED_TO_TECH",
                    reason=data.reason or f"Выдано монтажнику: {target_user['name']}",
                )

                connection.commit()

                return {
                    "message": "Оборудование выдано монтажнику",
                    "item_id": item_id,
                    "target_user_id": data.target_user_id,
                    "target_user_name": target_user["name"],
                    "quantity": 1,
                }

            available_quantity = int(item["quantity"] or 0)

            if data.quantity > available_quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Недостаточно количества на складе. Доступно: {available_quantity}"
                )

            target_item = find_assigned_consumable_for_user(
                cursor=cursor,
                item=item,
                city_id=item["city_id"],
                target_user_id=data.target_user_id,
            )

            if target_item:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = quantity + %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.quantity, target_item["id"])
                )

                target_item_id = target_item["id"]
            else:
                cursor.execute(
                    """
                    INSERT INTO warehouse_items (
                        category,
                        name,
                        manufacturer,
                        model,
                        identifier_type,
                        identifier_value,
                        serial_number,
                        is_serialized,
                        quantity,
                        city_id,
                        assigned_to_user_id,
                        assigned_at,
                        assigned_by,
                        status,
                        condition_status,
                        note,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s)
                    """,
                    (
                        item["category"],
                        item["name"],
                        item["manufacturer"],
                        item["model"],
                        "NONE",
                        None,
                        None,
                        False,
                        data.quantity,
                        item["city_id"],
                        data.target_user_id,
                        current_user["id"],
                        "ASSIGNED_TO_TECH",
                        normalize_condition_status(item.get("condition_status")),
                        item.get("note"),
                        current_user["id"],
                    )
                )

                target_item_id = cursor.lastrowid

            new_source_quantity = available_quantity - data.quantity

            cursor.execute(
                """
                UPDATE warehouse_items
                SET quantity = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (new_source_quantity, item_id)
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="CONSUMABLE_ASSIGNED_OUT",
                current_user=current_user,
                from_city_id=item.get("city_id"),
                to_city_id=item.get("city_id"),
                target_user_id=data.target_user_id,
                quantity=data.quantity,
                old_status="IN_STOCK",
                new_status="IN_STOCK",
                reason=data.reason or f"Выдача расходника монтажнику: {target_user['name']}",
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=target_item_id,
                action="CONSUMABLE_ASSIGNED_TO_TECH",
                current_user=current_user,
                from_city_id=item.get("city_id"),
                to_city_id=item.get("city_id"),
                target_user_id=data.target_user_id,
                quantity=data.quantity,
                old_status="ASSIGNED_TO_TECH",
                new_status="ASSIGNED_TO_TECH",
                reason=data.reason or f"Получено монтажником: {target_user['name']}",
            )

            connection.commit()

            return {
                "message": "Расходник выдан монтажнику",
                "source_item_id": item_id,
                "target_item_id": target_item_id,
                "target_user_id": data.target_user_id,
                "target_user_name": target_user["name"],
                "quantity": data.quantity,
                "source_quantity_left": new_source_quantity,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/items/{item_id}/return-to-stock")
def return_inventory_item_to_stock(
    item_id: int,
    data: WarehouseItemReturnToStock,
    current_user: dict = Depends(get_current_user),
):
    require_warehouse_manage(current_user)

    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            target_city = require_city(cursor, data.city_id)

            cursor.execute(
                """
                SELECT *
                FROM warehouse_items
                WHERE id = %s
                  AND is_deleted = 0
                FOR UPDATE
                """,
                (item_id,)
            )

            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Предмет инвентаря не найден")

            if item["status"] != "ASSIGNED_TO_TECH" or not item.get("assigned_to_user_id"):
                raise HTTPException(
                    status_code=400,
                    detail="Вернуть на склад можно только предмет из инвентаря монтажника"
                )

            is_serialized = bool(item["is_serialized"])

            if is_serialized:
                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

                old_user_id = item.get("assigned_to_user_id")

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET status = 'IN_STOCK',
                        city_id = %s,
                        assigned_to_user_id = NULL,
                        assigned_at = NULL,
                        assigned_by = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        data.city_id,
                        item_id,
                    )
                )

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="RETURNED_TO_STOCK",
                    current_user=current_user,
                    from_city_id=item.get("city_id"),
                    to_city_id=data.city_id,
                    from_user_id=old_user_id,
                    quantity=1,
                    old_status="ASSIGNED_TO_TECH",
                    new_status="IN_STOCK",
                    reason=data.reason or f"Возвращено на склад: {target_city['name']}",
                )

                connection.commit()

                return {
                    "message": "Оборудование возвращено на склад",
                    "item_id": item_id,
                    "city_id": data.city_id,
                    "city_name": target_city["name"],
                    "quantity": 1,
                }

            available_quantity = int(item["quantity"] or 0)

            if data.quantity > available_quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Недостаточно количества у монтажника. Доступно: {available_quantity}"
                )

            stock_item = find_consumable_in_city(
                cursor=cursor,
                item=item,
                city_id=data.city_id,
            )

            if stock_item:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = quantity + %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.quantity, stock_item["id"])
                )

                stock_item_id = stock_item["id"]
            else:
                cursor.execute(
                    """
                    INSERT INTO warehouse_items (
                        category,
                        name,
                        manufacturer,
                        model,
                        identifier_type,
                        identifier_value,
                        serial_number,
                        is_serialized,
                        quantity,
                        city_id,
                        status,
                        condition_status,
                        note,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        item["category"],
                        item["name"],
                        item["manufacturer"],
                        item["model"],
                        "NONE",
                        None,
                        None,
                        False,
                        data.quantity,
                        data.city_id,
                        "IN_STOCK",
                        normalize_condition_status(item.get("condition_status")),
                        item.get("note"),
                        current_user["id"],
                    )
                )

                stock_item_id = cursor.lastrowid

            new_inventory_quantity = available_quantity - data.quantity

            cursor.execute(
                """
                UPDATE warehouse_items
                SET quantity = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (new_inventory_quantity, item_id)
            )

            if new_inventory_quantity == 0:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET is_deleted = 1,
                        deleted_at = NOW(),
                        deleted_by = %s
                    WHERE id = %s
                    """,
                    (current_user["id"], item_id)
                )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="CONSUMABLE_RETURNED_FROM_TECH_OUT",
                current_user=current_user,
                from_city_id=item.get("city_id"),
                to_city_id=data.city_id,
                from_user_id=item.get("assigned_to_user_id"),
                quantity=data.quantity,
                old_status="ASSIGNED_TO_TECH",
                new_status="ASSIGNED_TO_TECH",
                reason=data.reason or "Расходник возвращён монтажником",
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=stock_item_id,
                action="CONSUMABLE_RETURNED_TO_STOCK",
                current_user=current_user,
                from_city_id=item.get("city_id"),
                to_city_id=data.city_id,
                from_user_id=item.get("assigned_to_user_id"),
                quantity=data.quantity,
                old_status="IN_STOCK",
                new_status="IN_STOCK",
                reason=data.reason or f"Расходник возвращён на склад: {target_city['name']}",
            )

            connection.commit()

            return {
                "message": "Расходник возвращён на склад",
                "inventory_item_id": item_id,
                "stock_item_id": stock_item_id,
                "city_id": data.city_id,
                "city_name": target_city["name"],
                "quantity": data.quantity,
                "inventory_quantity_left": new_inventory_quantity,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/inventory/manual-add-to-user")
def manual_add_item_to_user_inventory(
    data: WarehouseManualAddToUser,
    current_user: dict = Depends(get_current_user),
):
    require_warehouse_manage(current_user)

    item_data = data.dict()
    item_data["city_id"] = data.city_id

    validate_warehouse_item(item_data)

    condition_status = normalize_condition_status(item_data.get("condition_status"))

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            city = require_city(cursor, data.city_id)
            target_user = require_inventory_target_user(cursor, data.target_user_id)

            if data.is_serialized:
                identifier_value = data.identifier_value.strip() if data.identifier_value else None

                if identifier_value:
                    existing = find_serialized_by_identifier(
                        cursor,
                        data.identifier_type,
                        identifier_value,
                    )

                    if existing:
                        raise HTTPException(
                            status_code=400,
                            detail="Оборудование с таким идентификатором уже существует"
                        )

                cursor.execute(
                    """
                    INSERT INTO warehouse_items (
                        category,
                        name,
                        manufacturer,
                        model,
                        identifier_type,
                        identifier_value,
                        serial_number,
                        is_serialized,
                        quantity,
                        city_id,
                        assigned_to_user_id,
                        assigned_at,
                        assigned_by,
                        status,
                        condition_status,
                        note,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s)
                    """,
                    (
                        data.category,
                        data.name,
                        data.manufacturer,
                        data.model,
                        data.identifier_type,
                        identifier_value,
                        data.serial_number,
                        True,
                        1,
                        data.city_id,
                        data.target_user_id,
                        current_user["id"],
                        "ASSIGNED_TO_TECH",
                        condition_status,
                        data.note,
                        current_user["id"],
                    )
                )

                item_id = cursor.lastrowid

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="MANUAL_ADDED_TO_TECH",
                    current_user=current_user,
                    from_city_id=None,
                    to_city_id=data.city_id,
                    target_user_id=data.target_user_id,
                    quantity=1,
                    old_status=None,
                    new_status="ASSIGNED_TO_TECH",
                    reason=data.reason or f"Ручное добавление в инвентарь монтажника: {target_user['name']}",
                )

                connection.commit()

                return {
                    "message": "Предмет вручную добавлен в инвентарь монтажника",
                    "item_id": item_id,
                    "city_id": data.city_id,
                    "city_name": city["name"],
                    "target_user_id": data.target_user_id,
                    "target_user_name": target_user["name"],
                    "quantity": 1,
                }

            item_for_search = {
                "category": data.category,
                "name": data.name,
                "manufacturer": data.manufacturer,
                "model": data.model,
                "condition_status": condition_status,
            }

            target_item = find_assigned_consumable_for_user(
                cursor=cursor,
                item=item_for_search,
                city_id=data.city_id,
                target_user_id=data.target_user_id,
            )

            if target_item:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = quantity + %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.quantity, target_item["id"])
                )

                item_id = target_item["id"]
            else:
                cursor.execute(
                    """
                    INSERT INTO warehouse_items (
                        category,
                        name,
                        manufacturer,
                        model,
                        identifier_type,
                        identifier_value,
                        serial_number,
                        is_serialized,
                        quantity,
                        city_id,
                        assigned_to_user_id,
                        assigned_at,
                        assigned_by,
                        status,
                        condition_status,
                        note,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s)
                    """,
                    (
                        data.category,
                        data.name,
                        data.manufacturer,
                        data.model,
                        "NONE",
                        None,
                        None,
                        False,
                        data.quantity,
                        data.city_id,
                        data.target_user_id,
                        current_user["id"],
                        "ASSIGNED_TO_TECH",
                        condition_status,
                        data.note,
                        current_user["id"],
                    )
                )

                item_id = cursor.lastrowid

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="MANUAL_CONSUMABLE_ADDED_TO_TECH",
                current_user=current_user,
                from_city_id=None,
                to_city_id=data.city_id,
                target_user_id=data.target_user_id,
                quantity=data.quantity,
                old_status=None,
                new_status="ASSIGNED_TO_TECH",
                reason=data.reason or f"Ручное добавление расходника монтажнику: {target_user['name']}",
            )

            connection.commit()

            return {
                "message": "Расходник вручную добавлен в инвентарь монтажника",
                "item_id": item_id,
                "city_id": data.city_id,
                "city_name": city["name"],
                "target_user_id": data.target_user_id,
                "target_user_name": target_user["name"],
                "quantity": data.quantity,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/inventory/items/{item_id}/transfer")
def transfer_inventory_item(
    item_id: int,
    data: WarehouseInventoryTransfer,
    current_user: dict = Depends(get_current_user),
):
    require_warehouse_manage(current_user)

    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")

    if not data.target_user_id and not data.to_city_id:
        raise HTTPException(
            status_code=400,
            detail="Нужно указать target_user_id или to_city_id"
        )

    if data.target_user_id and data.to_city_id:
        raise HTTPException(
            status_code=400,
            detail="Нельзя одновременно указать target_user_id и to_city_id"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT *
                FROM warehouse_items
                WHERE id = %s
                  AND is_deleted = 0
                FOR UPDATE
                """,
                (item_id,)
            )

            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Предмет инвентаря не найден")

            if item["status"] != "ASSIGNED_TO_TECH" or not item.get("assigned_to_user_id"):
                raise HTTPException(
                    status_code=400,
                    detail="Переносить можно только предмет из инвентаря монтажника"
                )

            old_user_id = int(item["assigned_to_user_id"])

            if data.from_user_id and int(data.from_user_id) != old_user_id:
                raise HTTPException(
                    status_code=400,
                    detail="Предмет находится не у выбранного монтажника-отправителя"
                )

            is_serialized = bool(item["is_serialized"])

            if data.target_user_id:
                target_user = require_inventory_target_user(cursor, data.target_user_id)

                if int(data.target_user_id) == old_user_id:
                    raise HTTPException(
                        status_code=400,
                        detail="Нельзя перенести предмет тому же самому монтажнику"
                    )

                if is_serialized:
                    if data.quantity != 1:
                        raise HTTPException(
                            status_code=400,
                            detail="Для серийного оборудования количество должно быть 1"
                        )

                    cursor.execute(
                        """
                        UPDATE warehouse_items
                        SET assigned_to_user_id = %s,
                            assigned_at = NOW(),
                            assigned_by = %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (
                            data.target_user_id,
                            current_user["id"],
                            item_id,
                        )
                    )

                    add_warehouse_movement(
                        cursor=cursor,
                        warehouse_item_id=item_id,
                        action="INVENTORY_TRANSFERRED_TO_USER",
                        current_user=current_user,
                        from_city_id=item.get("city_id"),
                        to_city_id=item.get("city_id"),
                        from_user_id=old_user_id,
                        target_user_id=data.target_user_id,
                        quantity=1,
                        old_status="ASSIGNED_TO_TECH",
                        new_status="ASSIGNED_TO_TECH",
                        reason=data.reason or f"Передано монтажнику: {target_user['name']}",
                    )

                    connection.commit()

                    return {
                        "message": "Предмет передан другому монтажнику",
                        "item_id": item_id,
                        "from_user_id": old_user_id,
                        "target_user_id": data.target_user_id,
                        "target_user_name": target_user["name"],
                        "quantity": 1,
                    }

                available_quantity = int(item["quantity"] or 0)

                if data.quantity > available_quantity:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Недостаточно количества у монтажника. Доступно: {available_quantity}"
                    )

                target_item = find_assigned_consumable_for_user(
                    cursor=cursor,
                    item=item,
                    city_id=item["city_id"],
                    target_user_id=data.target_user_id,
                )

                if target_item:
                    cursor.execute(
                        """
                        UPDATE warehouse_items
                        SET quantity = quantity + %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (data.quantity, target_item["id"])
                    )

                    target_item_id = target_item["id"]
                else:
                    cursor.execute(
                        """
                        INSERT INTO warehouse_items (
                            category,
                            name,
                            manufacturer,
                            model,
                            identifier_type,
                            identifier_value,
                            serial_number,
                            is_serialized,
                            quantity,
                            city_id,
                            assigned_to_user_id,
                            assigned_at,
                            assigned_by,
                            status,
                            condition_status,
                            note,
                            created_by
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s)
                        """,
                        (
                            item["category"],
                            item["name"],
                            item["manufacturer"],
                            item["model"],
                            "NONE",
                            None,
                            None,
                            False,
                            data.quantity,
                            item["city_id"],
                            data.target_user_id,
                            current_user["id"],
                            "ASSIGNED_TO_TECH",
                            normalize_condition_status(item.get("condition_status")),
                            item.get("note"),
                            current_user["id"],
                        )
                    )

                    target_item_id = cursor.lastrowid

                new_source_quantity = available_quantity - data.quantity

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (new_source_quantity, item_id)
                )

                if new_source_quantity == 0:
                    cursor.execute(
                        """
                        UPDATE warehouse_items
                        SET is_deleted = 1,
                            deleted_at = NOW(),
                            deleted_by = %s
                        WHERE id = %s
                        """,
                        (current_user["id"], item_id)
                    )

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="CONSUMABLE_INVENTORY_TRANSFERRED_OUT",
                    current_user=current_user,
                    from_city_id=item.get("city_id"),
                    to_city_id=item.get("city_id"),
                    from_user_id=old_user_id,
                    target_user_id=data.target_user_id,
                    quantity=data.quantity,
                    old_status="ASSIGNED_TO_TECH",
                    new_status="ASSIGNED_TO_TECH",
                    reason=data.reason or "Передача расходника другому монтажнику",
                )

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=target_item_id,
                    action="CONSUMABLE_INVENTORY_TRANSFERRED_IN",
                    current_user=current_user,
                    from_city_id=item.get("city_id"),
                    to_city_id=item.get("city_id"),
                    from_user_id=old_user_id,
                    target_user_id=data.target_user_id,
                    quantity=data.quantity,
                    old_status="ASSIGNED_TO_TECH",
                    new_status="ASSIGNED_TO_TECH",
                    reason=data.reason or f"Получено от другого монтажника: {target_user['name']}",
                )

                connection.commit()

                return {
                    "message": "Расходник передан другому монтажнику",
                    "source_item_id": item_id,
                    "target_item_id": target_item_id,
                    "from_user_id": old_user_id,
                    "target_user_id": data.target_user_id,
                    "target_user_name": target_user["name"],
                    "quantity": data.quantity,
                    "source_quantity_left": new_source_quantity,
                }

            # Если указан to_city_id — возвращаем на склад.
            target_city = require_city(cursor, data.to_city_id)

            if is_serialized:
                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET status = 'IN_STOCK',
                        city_id = %s,
                        assigned_to_user_id = NULL,
                        assigned_at = NULL,
                        assigned_by = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        data.to_city_id,
                        item_id,
                    )
                )

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="INVENTORY_TRANSFERRED_TO_STOCK",
                    current_user=current_user,
                    from_city_id=item.get("city_id"),
                    to_city_id=data.to_city_id,
                    from_user_id=old_user_id,
                    quantity=1,
                    old_status="ASSIGNED_TO_TECH",
                    new_status="IN_STOCK",
                    reason=data.reason or f"Возврат на склад: {target_city['name']}",
                )

                connection.commit()

                return {
                    "message": "Предмет возвращён на склад",
                    "item_id": item_id,
                    "from_user_id": old_user_id,
                    "to_city_id": data.to_city_id,
                    "to_city_name": target_city["name"],
                    "quantity": 1,
                }

            available_quantity = int(item["quantity"] or 0)

            if data.quantity > available_quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Недостаточно количества у монтажника. Доступно: {available_quantity}"
                )

            stock_item = find_consumable_in_city(
                cursor=cursor,
                item=item,
                city_id=data.to_city_id,
            )

            if stock_item:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = quantity + %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.quantity, stock_item["id"])
                )

                stock_item_id = stock_item["id"]
            else:
                cursor.execute(
                    """
                    INSERT INTO warehouse_items (
                        category,
                        name,
                        manufacturer,
                        model,
                        identifier_type,
                        identifier_value,
                        serial_number,
                        is_serialized,
                        quantity,
                        city_id,
                        status,
                        condition_status,
                        note,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        item["category"],
                        item["name"],
                        item["manufacturer"],
                        item["model"],
                        "NONE",
                        None,
                        None,
                        False,
                        data.quantity,
                        data.to_city_id,
                        "IN_STOCK",
                        normalize_condition_status(item.get("condition_status")),
                        item.get("note"),
                        current_user["id"],
                    )
                )

                stock_item_id = cursor.lastrowid

            new_source_quantity = available_quantity - data.quantity

            cursor.execute(
                """
                UPDATE warehouse_items
                SET quantity = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (new_source_quantity, item_id)
            )

            if new_source_quantity == 0:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET is_deleted = 1,
                        deleted_at = NOW(),
                        deleted_by = %s
                    WHERE id = %s
                    """,
                    (current_user["id"], item_id)
                )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_OUT",
                current_user=current_user,
                from_city_id=item.get("city_id"),
                to_city_id=data.to_city_id,
                from_user_id=old_user_id,
                quantity=data.quantity,
                old_status="ASSIGNED_TO_TECH",
                new_status="ASSIGNED_TO_TECH",
                reason=data.reason or "Расходник возвращён на склад",
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=stock_item_id,
                action="CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_IN",
                current_user=current_user,
                from_city_id=item.get("city_id"),
                to_city_id=data.to_city_id,
                from_user_id=old_user_id,
                quantity=data.quantity,
                old_status="IN_STOCK",
                new_status="IN_STOCK",
                reason=data.reason or f"Расходник возвращён на склад: {target_city['name']}",
            )

            connection.commit()

            return {
                "message": "Расходник возвращён на склад",
                "source_item_id": item_id,
                "stock_item_id": stock_item_id,
                "from_user_id": old_user_id,
                "to_city_id": data.to_city_id,
                "to_city_name": target_city["name"],
                "quantity": data.quantity,
                "source_quantity_left": new_source_quantity,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/consumable-thresholds")
def upsert_consumable_threshold(
    data: WarehouseConsumableThresholdUpdate,
    current_user: dict = Depends(get_current_user),
):
    require_warehouse_manage(current_user)

    if data.threshold_quantity < 0:
        raise HTTPException(
            status_code=400,
            detail="Порог остатка не может быть отрицательным"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            city = require_city(cursor, data.city_id)

            manufacturer = data.manufacturer or ""
            model = data.model or ""

            cursor.execute(
                """
                INSERT INTO warehouse_consumable_thresholds (
                    city_id,
                    category,
                    name,
                    manufacturer,
                    model,
                    threshold_quantity,
                    created_by,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                    threshold_quantity = VALUES(threshold_quantity),
                    updated_at = NOW()
                """,
                (
                    data.city_id,
                    data.category,
                    data.name,
                    manufacturer,
                    model,
                    data.threshold_quantity,
                    current_user["id"],
                )
            )

            connection.commit()

            return {
                "message": "Порог расходника обновлён",
                "city_id": data.city_id,
                "city_name": city["name"],
                "category": data.category,
                "name": data.name,
                "manufacturer": manufacturer,
                "model": model,
                "threshold_quantity": data.threshold_quantity,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/template")
def download_warehouse_template(current_user: dict = Depends(get_current_user)):
    """
    Скачать CSV-шаблон для импорта оборудования.
    """
    require_warehouse_manage(current_user)

    output = StringIO()

    writer = csv.writer(output, delimiter=";")

    writer.writerow([
        "category",
        "name",
        "manufacturer",
        "model",
        "identifier_type",
        "identifier_value",
        "serial_number",
        "is_serialized",
        "quantity",
        "condition_status",
        "note"
    ])

    writer.writerow([
        "GPS_TRACKER",
        "Teltonika FMC920",
        "Teltonika",
        "FMC920",
        "IMEI",
        "352093087123456",
        "",
        "true",
        "1",
        "",
        "Основной GPS-трекер"
    ])

    writer.writerow([
        "BLE_SENSOR",
        "ADM35",
        "ADM",
        "ADM35",
        "MAC",
        "AA:BB:CC:DD:EE:FF",
        "",
        "true",
        "1",
        "БУ",
        "BLE-датчик"
    ])

    writer.writerow([
        "RELAY",
        "Реле блокировки",
        "",
        "",
        "NONE",
        "",
        "",
        "false",
        "50",
        "",
        "Расходник"
    ])

    response = Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8"
    )

    response.headers["Content-Disposition"] = "attachment; filename=warehouse_import_template.csv"

    return response

@router.post("/import")
async def import_warehouse_items(
    file: UploadFile = File(...),
    from_city_id: int = Form(...),
    to_city_id: int = Form(...),
    edited_quantities_json: str | None = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Импорт оборудования из CSV с учётом городов склада.

    Серийное оборудование:
    - новое добавляется в to_city_id;
    - если уже есть в to_city_id — пропускается;
    - если есть в from_city_id и to_city_id другой — переносится;
    - если находится не в from_city_id — ошибка.

    Расходники:
    - если from_city_id == to_city_id — приход/суммирование в этом городе;
    - если from_city_id != to_city_id — перенос количества из from_city_id в to_city_id.
    """
    require_warehouse_manage(current_user)

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Поддерживается только CSV-файл")

    edited_quantities = {}

    if edited_quantities_json:
        try:
            edited_quantities = json.loads(edited_quantities_json)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Некорректный формат edited_quantities_json"
            )

    content = await file.read()

    try:
        decoded_content = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV должен быть в кодировке UTF-8")

    csv_file = StringIO(decoded_content)

    try:
        sample = decoded_content[:2048]
        dialect = csv.Sniffer().sniff(sample, delimiters=";,")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"

    csv_file.seek(0)
    reader = csv.DictReader(csv_file, dialect=dialect)

    required_columns = [
        "category",
        "name",
        "manufacturer",
        "model",
        "identifier_type",
        "identifier_value",
        "serial_number",
        "is_serialized",
        "quantity",
        "note",
    ]

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV-файл пустой или не содержит заголовков")

    missing_columns = [col for col in required_columns if col not in reader.fieldnames]

    if missing_columns:
        raise HTTPException(
            status_code=400,
            detail=f"В CSV отсутствуют колонки: {', '.join(missing_columns)}"
        )

    rows = list(reader)

    if not rows:
        raise HTTPException(status_code=400, detail="CSV не содержит строк для импорта")

    imported_count = 0
    transferred_count = 0
    skipped_count = 0
    consumables_updated_count = 0
    errors = []

    file_keys = set()

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            from_city = require_city(cursor, from_city_id)
            to_city = require_city(cursor, to_city_id)

            for index, row in enumerate(rows, start=2):
                try:
                    category = (row.get("category") or "").strip()
                    name = (row.get("name") or "").strip()
                    manufacturer = (row.get("manufacturer") or "").strip() or None
                    model = (row.get("model") or "").strip() or None
                    identifier_type = (row.get("identifier_type") or "NONE").strip() or "NONE"
                    identifier_value = (row.get("identifier_value") or "").strip() or None
                    serial_number = (row.get("serial_number") or "").strip() or None
                    is_serialized = parse_bool(row.get("is_serialized"))

                    raw_quantity = parse_int(row.get("quantity"), default=1)
                    quantity = int(edited_quantities.get(str(index), raw_quantity))

                    note = (row.get("note") or "").strip() or None

                    condition_status = normalize_condition_status(row.get("condition_status"))

                    if not name:
                        raise HTTPException(status_code=400, detail="name обязателен")

                    item_data = {
                        "category": category,
                        "name": name,
                        "manufacturer": manufacturer,
                        "model": model,
                        "identifier_type": identifier_type,
                        "identifier_value": identifier_value,
                        "serial_number": serial_number,
                        "is_serialized": is_serialized,
                        "condition_status": condition_status,
                        "quantity": quantity,
                        "city_id": to_city_id,
                        "note": note,
                    }

                    validate_warehouse_item(item_data)

                    # -------------------------
                    # Серийное оборудование
                    # -------------------------
                    if is_serialized:
                        key = f"{identifier_type}:{identifier_value}".lower()

                        if key in file_keys:
                            skipped_count += 1
                            errors.append({
                                "row": index,
                                "error": "Дубликат внутри CSV",
                                "identifier_type": identifier_type,
                                "identifier_value": identifier_value,
                            })
                            continue

                        file_keys.add(key)

                        existing = find_serialized_by_identifier(
                            cursor,
                            identifier_type,
                            identifier_value,
                        )

                        if existing:
                            existing_city_id = int(existing["city_id"])

                            if existing_city_id == int(to_city_id):
                                skipped_count += 1
                                errors.append({
                                    "row": index,
                                    "error": "Оборудование уже есть в выбранном городе",
                                    "identifier_type": identifier_type,
                                    "identifier_value": identifier_value,
                                })
                                continue

                            if existing_city_id != int(from_city_id):
                                skipped_count += 1
                                errors.append({
                                    "row": index,
                                    "error": "Оборудование найдено, но находится не в выбранном городе отправления",
                                    "current_city_id": existing_city_id,
                                    "from_city_id": from_city_id,
                                    "to_city_id": to_city_id,
                                    "identifier_type": identifier_type,
                                    "identifier_value": identifier_value,
                                })
                                continue

                            if existing["status"] != "IN_STOCK":
                                skipped_count += 1
                                errors.append({
                                    "row": index,
                                    "error": "Оборудование найдено, но его нельзя перенести, так как оно не на складе",
                                    "status": existing["status"],
                                    "identifier_type": identifier_type,
                                    "identifier_value": identifier_value,
                                })
                                continue

                            cursor.execute(
                                """
                                UPDATE warehouse_items
                                SET city_id = %s,
                                    updated_at = NOW()
                                WHERE id = %s
                                """,
                                (to_city_id, existing["id"])
                            )

                            add_warehouse_movement(
                                cursor=cursor,
                                warehouse_item_id=existing["id"],
                                action="IMPORT_SERIALIZED_TRANSFERRED",
                                current_user=current_user,
                                from_city_id=from_city_id,
                                to_city_id=to_city_id,
                                quantity=1,
                                reason=f"Перенос через CSV-импорт: {file.filename}",
                            )

                            transferred_count += 1
                            continue

                        cursor.execute(
                            """
                            INSERT INTO warehouse_items (
                                category,
                                name,
                                manufacturer,
                                model,
                                identifier_type,
                                identifier_value,
                                serial_number,
                                is_serialized,
                                quantity,
                                city_id,
                                status,
                                condition_status,
                                note,
                                created_by
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                category,
                                name,
                                manufacturer,
                                model,
                                identifier_type,
                                identifier_value,
                                serial_number,
                                True,
                                1,
                                to_city_id,
                                "IN_STOCK",
                                condition_status,
                                note,
                                current_user["id"],
                            )
                        )

                        item_id = cursor.lastrowid

                        add_warehouse_movement(
                            cursor=cursor,
                            warehouse_item_id=item_id,
                            action="IMPORT_CREATED",
                            current_user=current_user,
                            from_city_id=None,
                            to_city_id=to_city_id,
                            quantity=1,
                            reason=f"Создано через CSV-импорт: {file.filename}",
                        )

                        imported_count += 1
                        continue

                    # -------------------------
                    # Расходники
                    # -------------------------
                    item_for_search = {
                        "category": category,
                        "name": name,
                        "manufacturer": manufacturer,
                        "model": model,
                        "condition_status": condition_status,
                    }

                    if from_city_id == to_city_id:
                        target_item = find_consumable_in_city(
                            cursor,
                            item_for_search,
                            to_city_id,
                        )

                        if target_item:
                            cursor.execute(
                                """
                                UPDATE warehouse_items
                                SET quantity = quantity + %s,
                                    updated_at = NOW()
                                WHERE id = %s
                                """,
                                (quantity, target_item["id"])
                            )

                            target_item_id = target_item["id"]
                        else:
                            cursor.execute(
                                """
                                INSERT INTO warehouse_items (
                                    category,
                                    name,
                                    manufacturer,
                                    model,
                                    identifier_type,
                                    identifier_value,
                                    serial_number,
                                    is_serialized,
                                    quantity,
                                    city_id,
                                    status,
                                    condition_status,
                                    note,
                                    created_by
                                )
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                """,
                                (
                                    category,
                                    name,
                                    manufacturer,
                                    model,
                                    "NONE",
                                    None,
                                    None,
                                    False,
                                    quantity,
                                    to_city_id,
                                    "IN_STOCK",
                                    condition_status,
                                    note,
                                    current_user["id"],
                                )
                            )

                            target_item_id = cursor.lastrowid

                        add_warehouse_movement(
                            cursor=cursor,
                            warehouse_item_id=target_item_id,
                            action="IMPORT_CONSUMABLE_ADDED",
                            current_user=current_user,
                            from_city_id=None,
                            to_city_id=to_city_id,
                            quantity=quantity,
                            reason=f"Приход расходника через CSV-импорт: {file.filename}",
                        )

                        consumables_updated_count += 1
                        continue

                    source_item = find_consumable_in_city(
                        cursor,
                        item_for_search,
                        from_city_id,
                    )

                    if not source_item:
                        skipped_count += 1
                        errors.append({
                            "row": index,
                            "error": "Расходник не найден в городе отправления",
                            "from_city_id": from_city_id,
                            "to_city_id": to_city_id,
                            "name": name,
                        })
                        continue

                    available_quantity = int(source_item["quantity"] or 0)

                    if quantity > available_quantity:
                        skipped_count += 1
                        errors.append({
                            "row": index,
                            "error": f"Недостаточно расходника в городе отправления. Доступно: {available_quantity}",
                            "from_city_id": from_city_id,
                            "to_city_id": to_city_id,
                            "name": name,
                        })
                        continue

                    target_item = find_consumable_in_city(
                        cursor,
                        item_for_search,
                        to_city_id,
                    )

                    if target_item:
                        cursor.execute(
                            """
                            UPDATE warehouse_items
                            SET quantity = quantity + %s,
                                updated_at = NOW()
                            WHERE id = %s
                            """,
                            (quantity, target_item["id"])
                        )

                        target_item_id = target_item["id"]
                    else:
                        cursor.execute(
                            """
                            INSERT INTO warehouse_items (
                                category,
                                name,
                                manufacturer,
                                model,
                                identifier_type,
                                identifier_value,
                                serial_number,
                                is_serialized,
                                quantity,
                                city_id,
                                status,
                                condition_status,
                                note,
                                created_by
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                category,
                                name,
                                manufacturer,
                                model,
                                "NONE",
                                None,
                                None,
                                False,
                                quantity,
                                to_city_id,
                                "IN_STOCK",
                                condition_status,
                                note,
                                current_user["id"],
                            )
                        )

                        target_item_id = cursor.lastrowid

                    cursor.execute(
                        """
                        UPDATE warehouse_items
                        SET quantity = quantity - %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (quantity, source_item["id"])
                    )

                    add_warehouse_movement(
                        cursor=cursor,
                        warehouse_item_id=source_item["id"],
                        action="IMPORT_CONSUMABLE_TRANSFERRED_OUT",
                        current_user=current_user,
                        from_city_id=from_city_id,
                        to_city_id=to_city_id,
                        quantity=quantity,
                        reason=f"Перенос расходника через CSV-импорт: {file.filename}",
                    )

                    add_warehouse_movement(
                        cursor=cursor,
                        warehouse_item_id=target_item_id,
                        action="IMPORT_CONSUMABLE_TRANSFERRED_IN",
                        current_user=current_user,
                        from_city_id=from_city_id,
                        to_city_id=to_city_id,
                        quantity=quantity,
                        reason=f"Перенос расходника через CSV-импорт: {file.filename}",
                    )

                    consumables_updated_count += 1

                except HTTPException as e:
                    skipped_count += 1
                    errors.append({
                        "row": index,
                        "error": e.detail
                    })
                except Exception as e:
                    skipped_count += 1
                    errors.append({
                        "row": index,
                        "error": str(e)
                    })

            connection.commit()

            return {
                "message": "Импорт завершён",
                "from_city_id": from_city_id,
                "from_city_name": from_city["name"],
                "to_city_id": to_city_id,
                "to_city_name": to_city["name"],
                "imported_count": imported_count,
                "transferred_count": transferred_count,
                "consumables_updated_count": consumables_updated_count,
                "skipped_count": skipped_count,
                "errors": errors,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/items/grouped")
def get_warehouse_items_grouped(
    category: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    city_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Иерархический список склада:
    Категория -> Наименование -> позиции.

    Для серийного оборудования quantity считается как 1 на строку.
    Для расходников quantity берется из warehouse_items.quantity.
    """
    require_warehouse_full_read(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                wi.id,
                wi.category,
                wi.name,
                wi.manufacturer,
                wi.model,
                wi.identifier_type,
                wi.identifier_value,
                wi.serial_number,
                wi.is_serialized,
                wi.quantity,
                wi.city_id,
                city.name AS city_name,
                wi.status,
                wi.condition_status,
                wi.note,
                wi.created_at,
                wi.updated_at,
                u.name AS created_by_name,

                wi.assigned_to_user_id,
                assigned_user.name AS assigned_to_user_name,
                assigned_user.role AS assigned_to_user_role,
                assigned_user.city AS assigned_to_user_city,
                wi.assigned_at,
                assigned_by_user.name AS assigned_by_name,

                req_r.id AS installed_request_id,
                req_r.city AS installed_city,
                req_r.address AS installed_address,

                COALESCE(direct_c.id, req_c.id) AS installed_client_id,
                COALESCE(direct_c.type, req_c.type) AS client_type,
                COALESCE(direct_c.name, req_c.name) AS client_name,
                COALESCE(direct_c.company_name, req_c.company_name) AS company_name,

                req_rv.id AS installed_request_vehicle_id,
                COALESCE(direct_v.id, req_v.id) AS installed_vehicle_id,
                COALESCE(direct_v.brand, req_v.brand) AS brand,
                COALESCE(direct_v.model, req_v.model) AS vehicle_model,
                COALESCE(direct_v.plate_number, req_v.plate_number) AS plate_number,
                COALESCE(direct_v.vin, req_v.vin) AS vin,

                CASE
                    WHEN direct_ve.id IS NOT NULL THEN 'DIRECT'
                    WHEN re.id IS NOT NULL THEN 'REQUEST'
                    ELSE NULL
                END AS installed_source_type
                
            FROM warehouse_items wi

            LEFT JOIN users u ON wi.created_by = u.id
            LEFT JOIN users assigned_user ON wi.assigned_to_user_id = assigned_user.id
            LEFT JOIN users assigned_by_user ON wi.assigned_by = assigned_by_user.id
            LEFT JOIN cities city ON wi.city_id = city.id

            LEFT JOIN (
                SELECT 
                    warehouse_item_id,
                    MAX(id) AS last_equipment_link_id
                FROM request_equipment
                GROUP BY warehouse_item_id
            ) latest_eq ON wi.id = latest_eq.warehouse_item_id

            LEFT JOIN request_equipment re ON latest_eq.last_equipment_link_id = re.id
            LEFT JOIN requests req_r ON re.request_id = req_r.id AND req_r.is_deleted = 0
            LEFT JOIN clients req_c ON req_r.client_id = req_c.id
            LEFT JOIN request_vehicles req_rv ON re.request_vehicle_id = req_rv.id
            LEFT JOIN vehicles req_v ON req_rv.vehicle_id = req_v.id

            LEFT JOIN (
                SELECT
                    warehouse_item_id,
                    MAX(id) AS last_vehicle_equipment_id
                FROM vehicle_equipment
                WHERE is_active = 1
                GROUP BY warehouse_item_id
            ) latest_direct_eq ON wi.id = latest_direct_eq.warehouse_item_id

            LEFT JOIN vehicle_equipment direct_ve ON latest_direct_eq.last_vehicle_equipment_id = direct_ve.id
            LEFT JOIN vehicles direct_v ON direct_ve.vehicle_id = direct_v.id AND direct_v.is_deleted = 0
            LEFT JOIN clients direct_c ON direct_v.client_id = direct_c.id AND direct_c.is_deleted = 0

            WHERE wi.is_deleted = 0
            """
            values = []

            if category:
                sql += " AND wi.category = %s"
                values.append(category)

            if status:
                sql += " AND wi.status = %s"
                values.append(status)

            if city_id:
                sql += " AND wi.city_id = %s"
                values.append(city_id)

            if search:
                sql += """
                AND (
                    wi.name LIKE %s OR
                    wi.manufacturer LIKE %s OR
                    wi.model LIKE %s OR
                    wi.identifier_value LIKE %s OR
                    wi.serial_number LIKE %s OR
                    wi.note LIKE %s
                )
                """
                like_value = f"%{search}%"
                values.extend([
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                ])

            sql += """
            ORDER BY
                city.name ASC,
                wi.category ASC,
                wi.name ASC,
                wi.status ASC,
                wi.created_at DESC
            """

            cursor.execute(sql, tuple(values))
            rows = cursor.fetchall()

            categories_map = {}

            for row in rows:
                item_quantity = get_warehouse_item_quantity(row)
                category_key = row.get("category") or "OTHER"
                category_name = category_key

                if category_key not in categories_map:
                    categories_map[category_key] = {
                        "category": category_key,
                        "category_name": category_name,
                        "counts": empty_status_counts(),
                        "total_quantity": 0,
                        "total_rows": 0,
                        "groups": {},
                    }

                category_group = categories_map[category_key]

                add_status_count(
                    category_group["counts"],
                    row.get("status"),
                    item_quantity,
                )
                category_group["total_quantity"] += item_quantity
                category_group["total_rows"] += 1

                item_group_name = get_item_group_name(row)
                item_group_key = normalize_group_key(item_group_name)

                if item_group_key not in category_group["groups"]:
                    category_group["groups"][item_group_key] = {
                        "group_key": item_group_key,
                        "name": item_group_name,
                        "manufacturer": row.get("manufacturer"),
                        "model": row.get("model"),
                        "is_consumable_group": not bool(row.get("is_serialized")),
                        "counts": empty_status_counts(),
                        "total_quantity": 0,
                        "total_rows": 0,
                        "items": [],
                    }

                item_group = category_group["groups"][item_group_key]

                add_status_count(
                    item_group["counts"],
                    row.get("status"),
                    item_quantity,
                )
                item_group["total_quantity"] += item_quantity
                item_group["total_rows"] += 1

                # Если в одной группе есть и серийные, и несерийные позиции,
                # группа считается смешанной, но расходники всё равно видны по quantity.
                if bool(row.get("is_serialized")):
                    item_group["is_consumable_group"] = False

                item_group["items"].append(row)

            result = []

            for category_data in categories_map.values():
                groups = list(category_data["groups"].values())

                groups.sort(
                    key=lambda group: (
                        group["name"].lower(),
                        group["group_key"],
                    )
                )

                for group in groups:
                    group["items"].sort(
                        key=lambda item: (
                            item.get("status") or "",
                            item.get("identifier_value") or "",
                            item.get("serial_number") or "",
                            -int(item.get("id") or 0),
                        )
                    )

                category_data["groups"] = groups

                result.append(category_data)

            result.sort(key=lambda item: item["category"])

            return result

    finally:
        connection.close()

@router.get("/items")
def get_warehouse_items(
    category: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    city_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Список оборудования на складе.
    Доступ: ADMIN, WAREHOUSE_MANAGER, MANAGER.
    """
    require_warehouse_full_read(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                wi.id,
                wi.category,
                wi.name,
                wi.manufacturer,
                wi.model,
                wi.identifier_type,
                wi.identifier_value,
                wi.serial_number,
                wi.is_serialized,
                wi.quantity,
                wi.city_id,
                city.name AS city_name,
                wi.status,
                wi.condition_status,
                wi.note,
                wi.created_at,
                wi.updated_at,
                u.name AS created_by_name,

                wi.assigned_to_user_id,
                assigned_user.name AS assigned_to_user_name,
                assigned_user.role AS assigned_to_user_role,
                assigned_user.city AS assigned_to_user_city,
                wi.assigned_at,
                assigned_by_user.name AS assigned_by_name,

                -- кому и куда установлено
                r.id AS installed_request_id,
                r.city AS installed_city,
                r.address AS installed_address,

                c.id AS installed_client_id,
                c.type AS client_type,
                c.name AS client_name,
                c.company_name,

                rv.id AS installed_request_vehicle_id,
                v.id AS installed_vehicle_id,
                v.brand,
                v.model AS vehicle_model,
                v.plate_number,
                v.vin
                
            FROM warehouse_items wi

            LEFT JOIN users u ON wi.created_by = u.id
            LEFT JOIN users assigned_user ON wi.assigned_to_user_id = assigned_user.id
            LEFT JOIN users assigned_by_user ON wi.assigned_by = assigned_by_user.id
            LEFT JOIN cities city ON wi.city_id = city.id

            LEFT JOIN (
                SELECT 
                    warehouse_item_id,
                    MAX(id) AS last_equipment_link_id
                FROM request_equipment
                GROUP BY warehouse_item_id
            ) latest_eq ON wi.id = latest_eq.warehouse_item_id

            LEFT JOIN request_equipment re ON latest_eq.last_equipment_link_id = re.id
            LEFT JOIN requests r ON re.request_id = r.id AND r.is_deleted = 0
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
            LEFT JOIN vehicles v ON rv.vehicle_id = v.id

            WHERE wi.is_deleted = 0
            """
            values = []

            if category:
                sql += " AND wi.category = %s"
                values.append(category)

            if status:
                sql += " AND wi.status = %s"
                values.append(status)

            if city_id:
                sql += " AND wi.city_id = %s"
                values.append(city_id)

            if search:
                sql += """
                AND (
                    wi.name LIKE %s OR
                    wi.manufacturer LIKE %s OR
                    wi.model LIKE %s OR
                    wi.identifier_value LIKE %s OR
                    wi.serial_number LIKE %s
                )
                """
                like_value = f"%{search}%"
                values.extend([like_value, like_value, like_value, like_value, like_value])

            sql += " ORDER BY city.name ASC, wi.created_at DESC"

            cursor.execute(sql, tuple(values))
            return cursor.fetchall()
    finally:
        connection.close()

@router.get("/items/{item_id}/history")
def get_warehouse_item_history(
    item_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    История действий по оборудованию.
    Доступ: роли, которые могут просматривать склад.
    """
    require_warehouse_full_read(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM warehouse_items
                WHERE id = %s
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            cursor.execute(
                """
                SELECT
                    wh.id,
                    wh.warehouse_item_id,
                    wh.action,

                    wh.from_city_id,
                    from_city.name AS from_city_name,

                    wh.to_city_id,
                    to_city.name AS to_city_name,

                    wh.request_id,
                    wh.request_vehicle_id,
                    wh.vehicle_id,
                    wh.request_equipment_id,
                    wh.target_user_id,
                    target_user.name AS target_user_name,
                    wh.from_user_id,
                    from_user.name AS from_user_name,

                    wh.quantity,
                    wh.old_status,
                    wh.new_status,
                    wh.old_value,
                    wh.new_value,
                    wh.reason,

                    wh.created_by,
                    actor.name AS created_by_name,
                    wh.created_at,

                    r.city AS request_city,
                    r.address AS request_address,

                    v.brand,
                    v.model AS vehicle_model,
                    v.plate_number,
                    v.vin
                FROM warehouse_item_movements wh
                LEFT JOIN cities from_city ON wh.from_city_id = from_city.id
                LEFT JOIN cities to_city ON wh.to_city_id = to_city.id
                LEFT JOIN users actor ON wh.created_by = actor.id
                LEFT JOIN users target_user ON wh.target_user_id = target_user.id
                LEFT JOIN users from_user ON wh.from_user_id = from_user.id
                LEFT JOIN requests r ON wh.request_id = r.id
                LEFT JOIN vehicles v ON wh.vehicle_id = v.id
                WHERE wh.warehouse_item_id = %s
                ORDER BY wh.created_at DESC, wh.id DESC
                """,
                (item_id,)
            )

            return cursor.fetchall()

    finally:
        connection.close()

@router.post("/items")
def create_warehouse_item(
    data: WarehouseItemCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Добавить оборудование на склад.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    item_data = data.dict()
    validate_warehouse_item(item_data)
    condition_status = normalize_condition_status(item_data.get("condition_status"))

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            require_city(cursor, data.city_id)

            if data.identifier_value:
                cursor.execute(
                    """
                    SELECT id
                    FROM warehouse_items
                    WHERE identifier_type = %s
                    AND identifier_value = %s
                    AND is_deleted = 0
                    """,
                    (data.identifier_type, data.identifier_value)
                )
                existing = cursor.fetchone()

                if existing:
                    raise HTTPException(
                        status_code=400,
                        detail="Оборудование с таким идентификатором уже существует"
                    )

            sql = """
            INSERT INTO warehouse_items (
                category,
                name,
                manufacturer,
                model,
                identifier_type,
                identifier_value,
                serial_number,
                is_serialized,
                quantity,
                city_id,
                status,
                condition_status,
                note,
                created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """

            cursor.execute(sql, (
                data.category,
                data.name,
                data.manufacturer,
                data.model,
                data.identifier_type,
                data.identifier_value,
                data.serial_number,
                data.is_serialized,
                data.quantity,
                data.city_id,
                "IN_STOCK",
                condition_status,
                data.note,
                current_user["id"],
            ))

            item_id = cursor.lastrowid

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="CREATED",
                current_user=current_user,
                from_city_id=None,
                to_city_id=data.city_id,
                quantity=data.quantity,
                reason="Создано вручную"
            )

            connection.commit()

            return {
                "message": "Оборудование добавлено на склад",
                "item_id": item_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/items/{item_id}")
def update_warehouse_item(
    item_id: int,
    data: WarehouseItemUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Редактировать оборудование.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    update_data = data.dict(exclude_unset=True)

    if not update_data:
        return {"message": "Нет данных для обновления"}

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT *
                FROM warehouse_items
                WHERE id = %s
                FOR UPDATE
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["is_deleted"]:
                raise HTTPException(status_code=400, detail="Нельзя редактировать оборудование из корзины")

            merged_data = dict(item)
            merged_data.update(update_data)
            validate_warehouse_item(merged_data)

            if "status" in update_data and update_data["status"] not in ALLOWED_STATUSES:
                raise HTTPException(status_code=400, detail="Некорректный статус оборудования")

            if "condition_status" in update_data:
                update_data["condition_status"] = normalize_condition_status(
                    update_data.get("condition_status")
                )
            
            status_is_really_changed = (
                "status" in update_data
                and str(update_data["status"]) != str(item.get("status"))
            )

            if status_is_really_changed:
                cursor.execute(
                    """
                    SELECT
                        re.id AS request_equipment_id,
                        re.request_id,
                        re.request_vehicle_id,

                        r.status AS request_status,
                        r.city AS request_city,
                        r.address AS request_address,

                        rv.vehicle_id,

                        v.brand,
                        v.model AS vehicle_model,
                        v.plate_number,
                        v.vin,

                        c.name AS client_name,
                        c.company_name
                    FROM request_equipment re
                    LEFT JOIN requests r ON re.request_id = r.id
                    LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
                    LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                    LEFT JOIN clients c ON r.client_id = c.id
                    WHERE re.warehouse_item_id = %s
                    AND r.is_deleted = 0
                    ORDER BY re.id DESC
                    LIMIT 1
                    """,
                    (item_id,)
                )

                request_equipment_link = cursor.fetchone()

                if request_equipment_link:
                    vehicle_title = f"{request_equipment_link.get('brand') or ''} {request_equipment_link.get('vehicle_model') or ''}".strip()

                    if request_equipment_link.get("plate_number"):
                        vehicle_title += f" ({request_equipment_link.get('plate_number')})"

                    if request_equipment_link.get("vin"):
                        vehicle_title += f" VIN: {request_equipment_link.get('vin')}"

                    client_title = (
                        request_equipment_link.get("company_name")
                        or request_equipment_link.get("client_name")
                        or "клиент не указан"
                    )

                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Нельзя изменить статус оборудования через склад, "
                            f"так как оно привязано к заявке #{request_equipment_link['request_id']}. "
                            f"Клиент: {client_title}. "
                            f"Авто: {vehicle_title or 'не указано'}. "
                            "Сначала отвяжите оборудование в заявке."
                        )
                    )
            
            if "city_id" in update_data:
                if not bool(item["is_serialized"]):
                    raise HTTPException(
                        status_code=400,
                        detail="Для расходников используйте перенос количества между городами"
                    )

                require_city(cursor, update_data["city_id"])

            direct_vehicle_link_to_detach = None

            status_changed_from_installed = (
                status_is_really_changed
                and item.get("status") == "INSTALLED"
                and update_data["status"] != "INSTALLED"
            )

            if status_changed_from_installed:
                cursor.execute(
                    """
                    SELECT
                        ve.id,
                        ve.vehicle_id,
                        ve.quantity,

                        v.brand,
                        v.model AS vehicle_model,
                        v.plate_number,
                        v.vin
                    FROM vehicle_equipment ve
                    LEFT JOIN vehicles v ON ve.vehicle_id = v.id
                    WHERE ve.warehouse_item_id = %s
                    AND ve.is_active = 1
                    ORDER BY ve.id DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (item_id,)
                )

                direct_vehicle_link_to_detach = cursor.fetchone()

            if "identifier_value" in update_data or "identifier_type" in update_data:
                identifier_type = merged_data.get("identifier_type")
                identifier_value = merged_data.get("identifier_value")

                if identifier_value:
                    cursor.execute(
                        """
                        SELECT id
                        FROM warehouse_items
                        WHERE identifier_type = %s
                            AND identifier_value = %s
                            AND id != %s
                            AND is_deleted = 0
                        """,
                        (identifier_type, identifier_value, item_id)
                    )
                    existing = cursor.fetchone()

                    if existing:
                        raise HTTPException(
                            status_code=400,
                            detail="Оборудование с таким идентификатором уже существует"
                        )

            allowed_fields = [
                "category",
                "name",
                "manufacturer",
                "model",
                "identifier_type",
                "identifier_value",
                "serial_number",
                "is_serialized",
                "quantity",
                "city_id",
                "status",
                "condition_status",
                "note",
            ]

            updates = []
            values = []

            for field in allowed_fields:
                if field in update_data:
                    updates.append(f"{field} = %s")
                    values.append(update_data[field])

            updates.append("updated_at = NOW()")

            values.append(item_id)

            sql = f"""
            UPDATE warehouse_items
            SET {', '.join(updates)}
            WHERE id = %s
            """

            cursor.execute(sql, tuple(values))

            changed_fields = []

            for field in allowed_fields:
                if field in update_data and field not in ["city_id"]:
                    old = item.get(field)
                    new = update_data.get(field)

                    if str(old) != str(new):
                        changed_fields.append(f"{field}: {old} → {new}")

            if changed_fields:
                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="UPDATED",
                    current_user=current_user,
                    quantity=item.get("quantity"),
                    old_status=item.get("status"),
                    new_status=update_data.get("status", item.get("status")),
                    old_value="\n".join(changed_fields),
                    new_value=None,
                    reason="Редактирование оборудования"
                )

            if direct_vehicle_link_to_detach:
                cursor.execute(
                    """
                    UPDATE vehicle_equipment
                    SET is_active = 0,
                        detached_by = %s,
                        detached_at = NOW(),
                        detach_reason = %s
                    WHERE id = %s
                    """,
                    (
                        current_user["id"],
                        "Автоматическая отвязка при изменении статуса оборудования через редактирование",
                        direct_vehicle_link_to_detach["id"],
                    )
                )

                vehicle_title = f"{direct_vehicle_link_to_detach.get('brand') or ''} {direct_vehicle_link_to_detach.get('vehicle_model') or ''}".strip()

                if direct_vehicle_link_to_detach.get("plate_number"):
                    vehicle_title += f" ({direct_vehicle_link_to_detach.get('plate_number')})"

                if direct_vehicle_link_to_detach.get("vin"):
                    vehicle_title += f" VIN: {direct_vehicle_link_to_detach.get('vin')}"

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="DETACHED_FROM_VEHICLE_DIRECT",
                    current_user=current_user,
                    vehicle_id=direct_vehicle_link_to_detach["vehicle_id"],
                    quantity=direct_vehicle_link_to_detach.get("quantity") or item.get("quantity"),
                    old_status=item.get("status"),
                    new_status=update_data.get("status"),
                    old_value=vehicle_title or None,
                    new_value=None,
                    reason="Оборудование автоматически отвязано от авто при изменении статуса через редактирование"
                )

            if (
                "status" in update_data
                and item.get("status") != "WRITTEN_OFF"
                and update_data["status"] == "WRITTEN_OFF"
            ):
                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="WRITTEN_OFF",
                    current_user=current_user,
                    quantity=item.get("quantity"),
                    old_status=item.get("status"),
                    new_status="WRITTEN_OFF",
                    reason="Списание через редактирование оборудования"
                )

            if "city_id" in update_data and int(update_data["city_id"]) != int(item["city_id"]):
                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="CITY_CHANGED",
                    current_user=current_user,
                    from_city_id=item["city_id"],
                    to_city_id=update_data["city_id"],
                    quantity=1,
                    reason="Город изменён через редактирование оборудования"
                )

            connection.commit()

            return {
                "message": "Оборудование обновлено",
                "item_id": item_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/items/{item_id}/transfer")
def transfer_warehouse_item(
    item_id: int,
    data: WarehouseItemTransfer,
    current_user: dict = Depends(get_current_user)
):
    """
    Перенос оборудования между городами.
    Серийное оборудование переносится целиком.
    Расходники переносятся выбранным количеством.
    """
    require_warehouse_manage(current_user)

    if data.from_city_id == data.to_city_id:
        raise HTTPException(
            status_code=400,
            detail="Город отправления и город назначения не должны совпадать"
        )

    if data.quantity <= 0:
        raise HTTPException(
            status_code=400,
            detail="Количество для переноса должно быть больше 0"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            from_city = require_city(cursor, data.from_city_id)
            to_city = require_city(cursor, data.to_city_id)

            cursor.execute(
                """
                SELECT *
                FROM warehouse_items
                WHERE id = %s
                  AND is_deleted = 0
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["status"] != "IN_STOCK":
                raise HTTPException(
                    status_code=400,
                    detail="Переносить можно только оборудование со статусом 'На складе'"
                )

            is_serialized = bool(item["is_serialized"])

            if is_serialized:
                if int(item["city_id"]) != int(data.from_city_id):
                    raise HTTPException(
                        status_code=400,
                        detail="Оборудование находится не в выбранном городе отправления"
                    )

                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET city_id = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.to_city_id, item_id)
                )

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="CITY_TRANSFERRED",
                    current_user=current_user,
                    from_city_id=data.from_city_id,
                    to_city_id=data.to_city_id,
                    quantity=1,
                    old_status=item.get("status"),
                    new_status=item.get("status"),
                    reason=data.reason,
                )

                connection.commit()

                return {
                    "message": "Оборудование перенесено",
                    "item_id": item_id,
                    "from_city": from_city["name"],
                    "to_city": to_city["name"],
                    "quantity": 1,
                }

            available_quantity = int(item["quantity"] or 0)

            if int(item["city_id"]) != int(data.from_city_id):
                raise HTTPException(
                    status_code=400,
                    detail="Расходник находится не в выбранном городе отправления"
                )

            if data.quantity > available_quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Недостаточно количества для переноса. Доступно: {available_quantity}"
                )

            target_item = find_consumable_in_city(cursor, item, data.to_city_id)

            if target_item:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = quantity + %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.quantity, target_item["id"])
                )

                target_item_id = target_item["id"]
            else:
                cursor.execute(
                    """
                    INSERT INTO warehouse_items (
                        category,
                        name,
                        manufacturer,
                        model,
                        identifier_type,
                        identifier_value,
                        serial_number,
                        is_serialized,
                        quantity,
                        city_id,
                        status,
                        condition_status,
                        note,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        item["category"],
                        item["name"],
                        item["manufacturer"],
                        item["model"],
                        "NONE",
                        None,
                        None,
                        False,
                        data.quantity,
                        data.to_city_id,
                        "IN_STOCK",
                        normalize_condition_status(item.get("condition_status")),
                        item["note"],
                        current_user["id"],
                    )
                )

                target_item_id = cursor.lastrowid

            new_source_quantity = available_quantity - data.quantity

            cursor.execute(
                """
                UPDATE warehouse_items
                SET quantity = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (new_source_quantity, item_id)
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="CONSUMABLE_TRANSFERRED_OUT",
                current_user=current_user,
                from_city_id=data.from_city_id,
                to_city_id=data.to_city_id,
                quantity=data.quantity,
                reason=data.reason,
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=target_item_id,
                action="CONSUMABLE_TRANSFERRED_IN",
                current_user=current_user,
                from_city_id=data.from_city_id,
                to_city_id=data.to_city_id,
                quantity=data.quantity,
                reason=data.reason,
            )

            connection.commit()

            return {
                "message": "Расходник перенесён",
                "source_item_id": item_id,
                "target_item_id": target_item_id,
                "from_city": from_city["name"],
                "to_city": to_city["name"],
                "quantity": data.quantity,
                "source_quantity_left": new_source_quantity,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/items/{item_id}")
def delete_warehouse_item(
    item_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Soft delete оборудования.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, is_deleted, quantity, city_id
                FROM warehouse_items
                WHERE id = %s
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["is_deleted"]:
                raise HTTPException(status_code=400, detail="Оборудование уже в корзине")

            if item["status"] in ["RESERVED", "INSTALLED"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя удалить оборудование, которое зарезервировано или установлено"
                )

            cursor.execute(
                """
                UPDATE warehouse_items
                SET is_deleted = 1,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], item_id)
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="DELETED",
                current_user=current_user,
                from_city_id=item["city_id"],
                to_city_id=None,
                quantity=item.get("quantity"),
                old_status=item.get("status"),
                new_status=item.get("status"),
                reason="Перемещено в корзину"
            )

            connection.commit()

            return {
                "message": "Оборудование перемещено в корзину",
                "item_id": item_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_warehouse_items(current_user: dict = Depends(get_current_user)):
    """
    Корзина склада.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                wi.id,
                wi.category,
                wi.name,
                wi.manufacturer,
                wi.model,
                wi.identifier_type,
                wi.identifier_value,
                wi.serial_number,
                wi.is_serialized,
                wi.quantity,
                wi.city_id,
                city.name AS city_name,
                wi.status,
                wi.condition_status,
                wi.note,
                wi.deleted_at,
                wi.deleted_by,
                u.name AS deleted_by_name
            FROM warehouse_items wi
            LEFT JOIN users u ON wi.deleted_by = u.id
            LEFT JOIN cities city ON wi.city_id = city.id
            WHERE wi.is_deleted = 1
            ORDER BY wi.deleted_at DESC
            """
            cursor.execute(sql)
            return cursor.fetchall()
    finally:
        connection.close()

@router.patch("/items/{item_id}/restore")
def restore_warehouse_item(
    item_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Восстановить оборудование из корзины.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, is_deleted, status, quantity, city_id
                FROM warehouse_items
                WHERE id = %s
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if not item["is_deleted"]:
                raise HTTPException(status_code=400, detail="Оборудование не находится в корзине")

            cursor.execute(
                """
                UPDATE warehouse_items
                SET is_deleted = 0,
                    deleted_at = NULL,
                    deleted_by = NULL
                WHERE id = %s
                """,
                (item_id,)
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="RESTORED",
                current_user=current_user,
                from_city_id=None,
                to_city_id=item["city_id"],
                quantity=item.get("quantity"),
                old_status=item.get("status"),
                new_status=item.get("status"),
                reason="Восстановлено из корзины"
            )

            connection.commit()

            return {
                "message": "Оборудование восстановлено",
                "item_id": item_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/requests/{request_id}/equipment")
def get_request_equipment(
    request_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Получить всё оборудование, привязанное к заявке.
    Доступ: все авторизованные пользователи.
    """
    require_request_equipment_read(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.responsible_manager_id
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s
                AND r.is_deleted = 0
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")
            
            if not can_user_access_request_equipment(request, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра оборудования этой заявки"
                )

            cursor.execute(
                """
                SELECT 
                    re.id AS link_id,
                    re.request_id,
                    re.request_vehicle_id,
                    re.warehouse_item_id,
                    re.quantity,
                    re.attached_by,
                    re.attached_at,
                    TIMESTAMPDIFF(SECOND, re.attached_at, NOW()) AS detach_age_seconds,
                    DATE_ADD(
                        re.attached_at,
                        INTERVAL 120 SECOND
                    ) AS detach_deadline_at,
                    re.note,

                    wi.city_id,
                    city.name AS city_name,

                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.serial_number,
                    wi.is_serialized,
                    wi.status,
                    wi.condition_status,

                    rv.vehicle_id,
                    v.brand,
                    v.model AS vehicle_model,
                    v.plate_number,
                    v.vin,

                    u.name AS attached_by_name
                FROM request_equipment re
                LEFT JOIN warehouse_items wi ON re.warehouse_item_id = wi.id
                LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
                LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                LEFT JOIN users u ON re.attached_by = u.id
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE re.request_id = %s
                ORDER BY re.attached_at DESC
                """,
                (request_id,)
            )

            rows = cursor.fetchall()
            return enrich_request_equipment_detach_permissions(rows, current_user)

    finally:
        connection.close()

@router.get("/available-equipment")
def get_available_equipment_for_vehicle_attach(
    category: str | None = Query(None),
    search: str | None = Query(None),
    city_id: int | None = Query(None),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """
    Список оборудования для прямой привязки к автомобилю без заявки.

    Доступ: ADMIN / WAREHOUSE_MANAGER.
    Берём только свободное оборудование со склада:
    - status = IN_STOCK
    - assigned_to_user_id IS NULL
    - quantity > 0
    - серийное оборудование не должно быть уже привязано к заявке или авто
    """
    require_vehicle_equipment_manage(current_user)

    conditions = [
        "wi.is_deleted = 0",
        "wi.quantity > 0",
        "wi.status = 'IN_STOCK'",
        "wi.assigned_to_user_id IS NULL",
        """
        (
            wi.is_serialized = 0
            OR (
                NOT EXISTS (
                    SELECT 1
                    FROM request_equipment re_check
                    WHERE re_check.warehouse_item_id = wi.id
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM vehicle_equipment ve_check
                    WHERE ve_check.warehouse_item_id = wi.id
                      AND ve_check.is_active = 1
                )
            )
        )
        """,
    ]
    values = []

    if category:
        conditions.append("wi.category = %s")
        values.append(category)

    if city_id:
        conditions.append("wi.city_id = %s")
        values.append(city_id)

    if search:
        conditions.append(
            """
            (
                wi.name LIKE %s OR
                wi.manufacturer LIKE %s OR
                wi.model LIKE %s OR
                wi.identifier_value LIKE %s OR
                wi.serial_number LIKE %s OR
                city.name LIKE %s
            )
            """
        )
        like_value = f"%{search}%"
        values.extend([
            like_value,
            like_value,
            like_value,
            like_value,
            like_value,
            like_value,
        ])

    where_clause = " AND ".join(conditions)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                    wi.id,
                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.serial_number,
                    wi.is_serialized,
                    wi.quantity,
                    wi.city_id,
                    city.name AS city_name,
                    wi.status,
                    wi.condition_status,
                    wi.note,

                    CASE
                        WHEN wi.is_serialized = 1 THEN 1
                        ELSE wi.quantity
                    END AS available_quantity,

                    'STOCK' AS source_type,
                    CONCAT('Склад: ', COALESCE(city.name, '—')) AS source_label

                FROM warehouse_items wi
                LEFT JOIN cities city ON wi.city_id = city.id

                WHERE {where_clause}

                ORDER BY
                    city.name ASC,
                    wi.category ASC,
                    wi.name ASC,
                    wi.identifier_value ASC,
                    wi.id DESC

                LIMIT %s
                """,
                tuple(values + [limit])
            )

            return cursor.fetchall()

    finally:
        connection.close()

@router.get("/vehicles/{vehicle_id}/equipment")
def get_vehicle_equipment(
    vehicle_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Получить оборудование автомобиля.

    Возвращает:
    - прямые привязки из vehicle_equipment;
    - привязки через заявки из request_equipment.
    """
    require_request_equipment_read(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    v.id,
                    v.client_id,
                    v.brand,
                    v.model,
                    v.plate_number,
                    v.vin,
                    v.is_deleted,

                    c.name AS client_name,
                    c.company_name,
                    c.created_by AS client_created_by,
                    c.responsible_manager_id,
                    c.is_deleted AS client_is_deleted
                FROM vehicles v
                LEFT JOIN clients c ON v.client_id = c.id
                WHERE v.id = %s
                LIMIT 1
                """,
                (vehicle_id,)
            )

            vehicle = cursor.fetchone()

            if not vehicle:
                raise HTTPException(status_code=404, detail="Машина не найдена")

            if vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Машина находится в корзине"
                )

            if vehicle["client_is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Клиент машины находится в корзине"
                )

            if not can_user_access_vehicle_equipment(vehicle, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра оборудования этой машины"
                )

            cursor.execute(
                """
                SELECT
                    ve.id AS link_id,
                    ve.vehicle_id,
                    NULL AS request_id,
                    NULL AS request_vehicle_id,
                    ve.warehouse_item_id,
                    ve.quantity,
                    ve.attached_at,
                    ve.note,

                    wi.city_id,
                    city.name AS city_name,
                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.serial_number,
                    wi.is_serialized,
                    wi.status,
                    wi.condition_status,
                    wi.is_deleted AS warehouse_item_is_deleted,

                    v.brand,
                    v.model AS vehicle_model,
                    v.plate_number,
                    v.vin,

                    u.name AS attached_by_name,

                    'DIRECT' AS source_type,
                    NULL AS request_status
                FROM vehicle_equipment ve
                LEFT JOIN warehouse_items wi ON ve.warehouse_item_id = wi.id
                LEFT JOIN vehicles v ON ve.vehicle_id = v.id
                LEFT JOIN users u ON ve.attached_by = u.id
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE rv.vehicle_id = %s
                    AND r.is_deleted = 0
                    AND wi.is_deleted = 0
                    AND wi.status = 'INSTALLED'
                ORDER BY re.attached_at DESC
                """,
                (vehicle_id,)
            )

            direct_rows = cursor.fetchall()

            cursor.execute(
                """
                SELECT
                    re.id AS link_id,
                    rv.vehicle_id,
                    re.request_id,
                    re.request_vehicle_id,
                    re.warehouse_item_id,
                    re.quantity,
                    re.attached_at,
                    re.note,

                    wi.city_id,
                    city.name AS city_name,
                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.serial_number,
                    wi.is_serialized,
                    wi.status,
                    wi.condition_status,
                    wi.is_deleted AS warehouse_item_is_deleted,

                    v.brand,
                    v.model AS vehicle_model,
                    v.plate_number,
                    v.vin,

                    u.name AS attached_by_name,

                    'REQUEST' AS source_type,
                    r.status AS request_status
                FROM request_equipment re
                LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
                LEFT JOIN requests r ON re.request_id = r.id
                LEFT JOIN warehouse_items wi ON re.warehouse_item_id = wi.id
                LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                LEFT JOIN users u ON re.attached_by = u.id
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE rv.vehicle_id = %s
                  AND r.is_deleted = 0
                ORDER BY re.attached_at DESC
                """,
                (vehicle_id,)
            )

            request_rows = cursor.fetchall()

            result = []

            all_rows = list(direct_rows or []) + list(request_rows or [])

            for row in all_rows:
                row["source_key"] = f"{row['source_type']}-{row['link_id']}"
                result.append(row)

            return result

    finally:
        connection.close()

@router.post("/vehicles/{vehicle_id}/equipment")
def attach_equipment_to_vehicle(
    vehicle_id: int,
    data: VehicleEquipmentAttach,
    current_user: dict = Depends(get_current_user),
):
    """
    Прямая привязка оборудования к машине без заявки.

    Доступ: ADMIN / WAREHOUSE_MANAGER.
    Источник: только свободное оборудование со склада IN_STOCK.
    """
    require_vehicle_equipment_manage(current_user)

    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    v.id,
                    v.client_id,
                    v.brand,
                    v.model,
                    v.plate_number,
                    v.vin,
                    v.is_deleted,

                    c.name AS client_name,
                    c.company_name,
                    c.is_deleted AS client_is_deleted
                FROM vehicles v
                LEFT JOIN clients c ON v.client_id = c.id
                WHERE v.id = %s
                LIMIT 1
                """,
                (vehicle_id,)
            )

            vehicle = cursor.fetchone()

            if not vehicle:
                raise HTTPException(status_code=404, detail="Машина не найдена")

            if vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя привязать оборудование к машине из корзины"
                )

            if vehicle["client_is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя привязать оборудование к машине клиента из корзины"
                )

            cursor.execute(
                """
                SELECT
                    wi.id,
                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.serial_number,
                    wi.is_serialized,
                    wi.quantity,
                    wi.city_id,
                    city.name AS city_name,
                    wi.status,
                    wi.is_deleted,
                    wi.assigned_to_user_id
                FROM warehouse_items wi
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE wi.id = %s
                FOR UPDATE
                """,
                (data.warehouse_item_id,)
            )

            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя привязать оборудование из корзины"
                )

            if item["status"] != "IN_STOCK" or item.get("assigned_to_user_id"):
                raise HTTPException(
                    status_code=400,
                    detail="Прямо к авто можно привязать только свободное оборудование со склада"
                )

            is_serialized = bool(item["is_serialized"])
            old_status = item.get("status")

            if is_serialized:
                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

                cursor.execute(
                    """
                    SELECT id
                    FROM request_equipment
                    WHERE warehouse_item_id = %s
                    LIMIT 1
                    """,
                    (data.warehouse_item_id,)
                )
                existing_request_link = cursor.fetchone()

                if existing_request_link:
                    raise HTTPException(
                        status_code=400,
                        detail="Это серийное оборудование уже привязано к заявке"
                    )

                cursor.execute(
                    """
                    SELECT id
                    FROM vehicle_equipment
                    WHERE warehouse_item_id = %s
                      AND is_active = 1
                    LIMIT 1
                    """,
                    (data.warehouse_item_id,)
                )
                existing_vehicle_link = cursor.fetchone()

                if existing_vehicle_link:
                    raise HTTPException(
                        status_code=400,
                        detail="Это серийное оборудование уже привязано к машине"
                    )

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET status = 'INSTALLED',
                        assigned_to_user_id = NULL,
                        assigned_at = NULL,
                        assigned_by = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.warehouse_item_id,)
                )

                movement_action = "INSTALLED_TO_VEHICLE_DIRECT"
                new_status_for_history = "INSTALLED"

            else:
                available_quantity = int(item["quantity"] or 0)

                if data.quantity > available_quantity:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Недостаточно количества. Доступно: {available_quantity}"
                    )

                new_quantity = available_quantity - data.quantity

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = %s,
                        is_deleted = CASE WHEN %s = 0 THEN 1 ELSE is_deleted END,
                        deleted_at = CASE WHEN %s = 0 THEN NOW() ELSE deleted_at END,
                        deleted_by = CASE WHEN %s = 0 THEN %s ELSE deleted_by END,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        new_quantity,
                        new_quantity,
                        new_quantity,
                        new_quantity,
                        current_user["id"],
                        data.warehouse_item_id,
                    )
                )

                movement_action = "CONSUMABLE_USED_TO_VEHICLE_DIRECT"
                new_status_for_history = old_status

            cursor.execute(
                """
                INSERT INTO vehicle_equipment (
                    vehicle_id,
                    warehouse_item_id,
                    quantity,
                    attached_by,
                    note,
                    source_type
                )
                VALUES (%s, %s, %s, %s, %s, 'DIRECT')
                """,
                (
                    vehicle_id,
                    data.warehouse_item_id,
                    data.quantity,
                    current_user["id"],
                    data.note,
                )
            )

            link_id = cursor.lastrowid

            vehicle_title = f"{vehicle.get('brand') or ''} {vehicle.get('model') or ''}".strip()
            if vehicle.get("plate_number"):
                vehicle_title += f" ({vehicle.get('plate_number')})"
            if vehicle.get("vin"):
                vehicle_title += f" VIN: {vehicle.get('vin')}"

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=data.warehouse_item_id,
                action=movement_action,
                current_user=current_user,
                from_city_id=item.get("city_id"),
                to_city_id=None,
                vehicle_id=vehicle_id,
                quantity=data.quantity,
                old_status=old_status,
                new_status=new_status_for_history,
                old_value=None,
                new_value=vehicle_title,
                reason=data.note or "Оборудование привязано напрямую к машине"
            )

            connection.commit()

            return {
                "message": "Оборудование привязано к машине",
                "link_id": link_id,
                "vehicle_id": vehicle_id,
                "warehouse_item_id": data.warehouse_item_id,
                "quantity": data.quantity,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/vehicle-equipment/{link_id}/detach")
def detach_equipment_from_vehicle(
    link_id: int,
    data: VehicleEquipmentDetach,
    current_user: dict = Depends(get_current_user),
):
    """
    Отвязать оборудование, которое было привязано напрямую к машине.
    Возвращает серийное оборудование в IN_STOCK, расходник возвращает количеством.
    """
    require_vehicle_equipment_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    ve.id,
                    ve.vehicle_id,
                    ve.warehouse_item_id,
                    ve.quantity,
                    ve.is_active,

                    wi.name,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.is_serialized,
                    wi.quantity AS current_quantity,
                    wi.city_id,
                    wi.status,

                    v.brand,
                    v.model AS vehicle_model,
                    v.plate_number,
                    v.vin
                FROM vehicle_equipment ve
                LEFT JOIN warehouse_items wi ON ve.warehouse_item_id = wi.id
                LEFT JOIN vehicles v ON ve.vehicle_id = v.id
                WHERE ve.id = %s
                FOR UPDATE
                """,
                (link_id,)
            )

            link = cursor.fetchone()

            if not link:
                raise HTTPException(
                    status_code=404,
                    detail="Привязка оборудования к машине не найдена"
                )

            if not link["is_active"]:
                raise HTTPException(
                    status_code=400,
                    detail="Оборудование уже отвязано от машины"
                )

            is_serialized = bool(link["is_serialized"])
            old_status = link.get("status")

            if is_serialized:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET status = 'IN_STOCK',
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (link["warehouse_item_id"],)
                )

                new_status_for_history = "IN_STOCK"

            else:
                new_quantity = int(link["current_quantity"] or 0) + int(link["quantity"] or 0)

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = %s,
                        is_deleted = 0,
                        deleted_at = NULL,
                        deleted_by = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        new_quantity,
                        link["warehouse_item_id"],
                    )
                )

                new_status_for_history = old_status

            cursor.execute(
                """
                UPDATE vehicle_equipment
                SET is_active = 0,
                    detached_by = %s,
                    detached_at = NOW(),
                    detach_reason = %s
                WHERE id = %s
                """,
                (
                    current_user["id"],
                    data.reason,
                    link_id,
                )
            )

            vehicle_title = f"{link.get('brand') or ''} {link.get('vehicle_model') or ''}".strip()
            if link.get("plate_number"):
                vehicle_title += f" ({link.get('plate_number')})"
            if link.get("vin"):
                vehicle_title += f" VIN: {link.get('vin')}"

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=link["warehouse_item_id"],
                action="DETACHED_FROM_VEHICLE_DIRECT",
                current_user=current_user,
                from_city_id=None,
                to_city_id=link.get("city_id"),
                vehicle_id=link.get("vehicle_id"),
                quantity=link.get("quantity"),
                old_status=old_status,
                new_status=new_status_for_history,
                old_value=vehicle_title,
                new_value=None,
                reason=data.reason or "Оборудование отвязано от машины и возвращено на склад"
            )

            connection.commit()

            return {
                "message": "Оборудование отвязано от машины",
                "link_id": link_id,
                "vehicle_id": link["vehicle_id"],
                "warehouse_item_id": link["warehouse_item_id"],
                "quantity": link["quantity"],
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/requests/{request_id}/equipment/{link_id}")
def detach_equipment_from_request(
    request_id: int,
    link_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Отвязать оборудование от заявки.

    ADMIN / WAREHOUSE_MANAGER:
    - могут отвязать всегда.

    TECHNICIAN / SENIOR_TECHNICIAN:
    - могут отвязать только то оборудование, которое сами привязали;
    - только в течение 2 минут после attached_at.
    """
    require_request_equipment_read(current_user)

    role = current_user.get("role")
    user_id = int(current_user["id"])

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    re.id,
                    re.request_id,
                    re.request_vehicle_id,
                    re.warehouse_item_id,
                    re.quantity,
                    re.attached_by,
                    re.attached_at,

                    TIMESTAMPDIFF(SECOND, re.attached_at, NOW()) AS detach_age_seconds,

                    r.is_deleted AS request_is_deleted,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,

                    c.responsible_manager_id,

                    wi.name,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.is_serialized,
                    wi.quantity AS current_quantity,
                    wi.city_id,
                    city.name AS city_name,
                    wi.status,

                    (
                        SELECT wm.from_user_id
                        FROM warehouse_item_movements wm
                        WHERE wm.request_equipment_id = re.id
                          AND wm.action IN (
                              'INSTALLED_FROM_TECH',
                              'INSTALLED_FROM_STOCK',
                              'CONSUMABLE_USED_FROM_TECH',
                              'CONSUMABLE_USED_FROM_STOCK'
                          )
                        ORDER BY wm.id ASC
                        LIMIT 1
                    ) AS source_user_id,

                    (
                        SELECT wm.action
                        FROM warehouse_item_movements wm
                        WHERE wm.request_equipment_id = re.id
                          AND wm.action IN (
                              'INSTALLED_FROM_TECH',
                              'INSTALLED_FROM_STOCK',
                              'CONSUMABLE_USED_FROM_TECH',
                              'CONSUMABLE_USED_FROM_STOCK'
                          )
                        ORDER BY wm.id ASC
                        LIMIT 1
                    ) AS source_action,

                    v.id AS vehicle_id,
                    v.brand,
                    v.model AS vehicle_model,
                    v.plate_number

                FROM request_equipment re
                LEFT JOIN requests r ON re.request_id = r.id
                LEFT JOIN clients c ON r.client_id = c.id
                LEFT JOIN warehouse_items wi ON re.warehouse_item_id = wi.id
                LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
                LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                LEFT JOIN cities city ON wi.city_id = city.id

                WHERE re.id = %s
                  AND re.request_id = %s

                FOR UPDATE
                """,
                (link_id, request_id)
            )

            link = cursor.fetchone()

            if not link:
                raise HTTPException(
                    status_code=404,
                    detail="Привязка оборудования не найдена"
                )

            if link.get("request_is_deleted"):
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя отвязать оборудование от удалённой заявки"
                )

            if not can_user_access_request_equipment(link, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для отвязки оборудования этой заявки"
                )

            can_detach = False
            is_warehouse_manager = role in WAREHOUSE_MANAGE_ROLES
            is_limited_detach_role = role in REQUEST_EQUIPMENT_LIMITED_DETACH_ROLES

            if is_warehouse_manager:
                can_detach = True

            elif is_limited_detach_role:
                is_attached_by_current_user = (
                    link.get("attached_by") is not None
                    and int(link["attached_by"]) == user_id
                )

                if not is_attached_by_current_user:
                    raise HTTPException(
                        status_code=403,
                        detail="Можно отвязать только оборудование, которое вы сами привязали"
                    )

                age_seconds = int(link.get("detach_age_seconds") or 0)

                if age_seconds > REQUEST_EQUIPMENT_DETACH_TIME_LIMIT_SECONDS:
                    raise HTTPException(
                        status_code=400,
                        detail="Отвязать ошибочно привязанное оборудование можно только в течение 2 минут после привязки"
                    )

                can_detach = True

            if not can_detach:
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для отвязки оборудования"
                )

            is_serialized = bool(link["is_serialized"])
            source_user_id = link.get("source_user_id")

            if is_serialized:
                if source_user_id:
                    cursor.execute(
                        """
                        UPDATE warehouse_items
                        SET status = 'ASSIGNED_TO_TECH',
                            assigned_to_user_id = %s,
                            assigned_at = NOW(),
                            assigned_by = %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (
                            source_user_id,
                            current_user["id"],
                            link["warehouse_item_id"],
                        )
                    )

                    new_status_for_history = "ASSIGNED_TO_TECH"
                    detach_reason = (
                        "Оборудование отвязано от заявки и возвращено в инвентарь монтажника"
                    )

                else:
                    cursor.execute(
                        """
                        UPDATE warehouse_items
                        SET status = 'IN_STOCK',
                            assigned_to_user_id = NULL,
                            assigned_at = NULL,
                            assigned_by = NULL,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (link["warehouse_item_id"],)
                    )

                    new_status_for_history = "IN_STOCK"
                    detach_reason = (
                        "Оборудование отвязано от заявки и возвращено на склад"
                    )

            else:
                new_quantity = int(link["current_quantity"] or 0) + int(link["quantity"] or 0)

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = %s,
                        is_deleted = 0,
                        deleted_at = NULL,
                        deleted_by = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        new_quantity,
                        link["warehouse_item_id"],
                    )
                )

                new_status_for_history = link.get("status")
                detach_reason = (
                    "Расходник отвязан от заявки и возвращён в исходную складскую/инвентарную позицию"
                )

            cursor.execute(
                """
                DELETE FROM request_equipment
                WHERE id = %s
                """,
                (link_id,)
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=link["warehouse_item_id"],
                action="DETACHED_FROM_REQUEST",
                current_user=current_user,
                from_city_id=None,
                to_city_id=link.get("city_id"),
                request_id=request_id,
                request_vehicle_id=link.get("request_vehicle_id"),
                vehicle_id=link.get("vehicle_id"),
                request_equipment_id=link_id,
                target_user_id=source_user_id,
                quantity=link.get("quantity"),
                old_status=link.get("status"),
                new_status=new_status_for_history,
                reason=detach_reason
            )

            item_title = f"{link['name']}"
            if link["model"]:
                item_title += f" {link['model']}"
            if link["identifier_value"]:
                item_title += f" ({link['identifier_type']}: {link['identifier_value']})"

            vehicle_title = f"{link['brand'] or ''} {link['vehicle_model'] or ''}".strip()
            if link["plate_number"]:
                vehicle_title += f" ({link['plate_number']})"

            history_action = (
                "EQUIPMENT_DETACHED_BY_TECH_WITHIN_TIME_LIMIT"
                if is_limited_detach_role and not is_warehouse_manager
                else "EQUIPMENT_DETACHED"
            )

            cursor.execute(
                """
                INSERT INTO request_history (
                    request_id,
                    user_id,
                    action,
                    old_value,
                    new_value
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    history_action,
                    f"{item_title}, quantity={link['quantity']}, vehicle={vehicle_title}",
                    None
                )
            )

            connection.commit()

            return {
                "message": "Оборудование отвязано от заявки",
                "link_id": link_id,
                "request_id": request_id,
                "request_vehicle_id": link["request_vehicle_id"]
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/request-vehicles/{request_vehicle_id}/available-inventory")
def get_available_inventory_for_request_vehicle(
    request_vehicle_id: int,
    category: str | None = Query(None),
    search: str | None = Query(None),
    assigned_to_user_id: int | None = Query(None),
    include_stock: bool = Query(True),
    current_user: dict = Depends(get_current_user),
):
    """
    Список оборудования для селектора в панели "Оборудование" внутри заявки.

    TECHNICIAN / SENIOR_TECHNICIAN:
    - видит только свой инвентарь со статусом ASSIGNED_TO_TECH.

    ADMIN / WAREHOUSE_MANAGER:
    - видит инвентарь монтажников;
    - может дополнительно видеть складские позиции IN_STOCK.
    """
    require_request_equipment_attach(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    rv.id,
                    rv.request_id,
                    r.is_deleted,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.responsible_manager_id
                FROM request_vehicles rv
                INNER JOIN requests r ON rv.request_id = r.id
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE rv.id = %s
                """,
                (request_vehicle_id,)
            )
            request_vehicle = cursor.fetchone()

            if not request_vehicle:
                raise HTTPException(
                    status_code=404,
                    detail="Автомобиль в заявке не найден"
                )

            if request_vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Заявка удалена"
                )

            if not can_user_access_request_equipment(request_vehicle, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра оборудования этой заявки"
                )

            conditions = [
                "wi.is_deleted = 0",
                "wi.quantity > 0",
                """
                (
                    wi.is_serialized = 0
                    OR (
                        NOT EXISTS (
                            SELECT 1
                            FROM request_equipment re_check
                            WHERE re_check.warehouse_item_id = wi.id
                        )
                        AND NOT EXISTS (
                            SELECT 1
                            FROM vehicle_equipment ve_check
                            WHERE ve_check.warehouse_item_id = wi.id
                            AND ve_check.is_active = 1
                        )
                    )
                )
                """
            ]
            values = []

            role = current_user["role"]

            if role in WAREHOUSE_MANAGE_ROLES:
                availability_clauses = []

                if assigned_to_user_id:
                    availability_clauses.append(
                        """
                        (
                            wi.status = 'ASSIGNED_TO_TECH'
                            AND wi.assigned_to_user_id = %s
                        )
                        """
                    )
                    values.append(assigned_to_user_id)
                else:
                    availability_clauses.append(
                        """
                        (
                            wi.status = 'ASSIGNED_TO_TECH'
                            AND wi.assigned_to_user_id IS NOT NULL
                        )
                        """
                    )

                if include_stock:
                    availability_clauses.append(
                        """
                        (
                            wi.status = 'IN_STOCK'
                            AND wi.assigned_to_user_id IS NULL
                        )
                        """
                    )

                conditions.append("(" + " OR ".join(availability_clauses) + ")")

            else:
                # Монтажник / старший монтажник видит только свой инвентарь.
                conditions.append(
                    """
                    wi.status = 'ASSIGNED_TO_TECH'
                    AND wi.assigned_to_user_id = %s
                    """
                )
                values.append(current_user["id"])

            if category:
                conditions.append("wi.category = %s")
                values.append(category)

            if search:
                conditions.append(
                    """
                    (
                        wi.name LIKE %s OR
                        wi.manufacturer LIKE %s OR
                        wi.model LIKE %s OR
                        wi.identifier_value LIKE %s OR
                        wi.serial_number LIKE %s OR
                        assigned_user.name LIKE %s OR
                        city.name LIKE %s
                    )
                    """
                )
                like_value = f"%{search}%"
                values.extend([
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                ])

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    wi.id,
                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.serial_number,
                    wi.is_serialized,
                    wi.quantity,
                    wi.city_id,
                    city.name AS city_name,
                    wi.status,
                    wi.condition_status,
                    wi.note,

                    wi.assigned_to_user_id,
                    assigned_user.name AS assigned_to_user_name,
                    assigned_user.role AS assigned_to_user_role,
                    assigned_user.city AS assigned_to_user_city,

                    CASE
                        WHEN wi.assigned_to_user_id IS NULL THEN 'STOCK'
                        ELSE 'TECH_INVENTORY'
                    END AS source_type

                FROM warehouse_items wi
                LEFT JOIN cities city ON wi.city_id = city.id
                LEFT JOIN users assigned_user ON wi.assigned_to_user_id = assigned_user.id

                WHERE {where_clause}

                ORDER BY
                    source_type ASC,
                    assigned_user.name ASC,
                    city.name ASC,
                    wi.category ASC,
                    wi.name ASC,
                    wi.identifier_value ASC,
                    wi.id DESC
                """,
                tuple(values)
            )

            rows = cursor.fetchall()

            for row in rows:
                row["available_quantity"] = get_warehouse_item_quantity(row)

                if row.get("assigned_to_user_id"):
                    row["source_label"] = f"Инвентарь: {row.get('assigned_to_user_name') or '—'}"
                else:
                    row["source_label"] = f"Склад: {row.get('city_name') or '—'}"

            return rows

    finally:
        connection.close()

@router.post("/request-vehicles/{request_vehicle_id}/equipment")
def attach_equipment_to_request_vehicle(
    request_vehicle_id: int,
    data: RequestEquipmentAttach,
    current_user: dict = Depends(get_current_user)
):
    """
    Привязать оборудование к конкретному авто внутри заявки.

    TECHNICIAN / SENIOR_TECHNICIAN:
    - может добавить только своё оборудование из инвентаря.

    ADMIN / WAREHOUSE_MANAGER:
    - может добавить оборудование из инвентаря любого монтажника;
    - может добавить оборудование напрямую со склада IN_STOCK.
    """
    require_request_equipment_attach(current_user)

    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")

    if data.request_vehicle_id != request_vehicle_id:
        raise HTTPException(
            status_code=400,
            detail="request_vehicle_id в URL и body не совпадают"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    rv.id AS request_vehicle_id,
                    rv.request_id,
                    rv.vehicle_id,

                    r.status,
                    r.is_deleted,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,

                    c.responsible_manager_id,

                    v.brand,
                    v.model,
                    v.plate_number
                FROM request_vehicles rv
                INNER JOIN requests r ON rv.request_id = r.id
                LEFT JOIN clients c ON r.client_id = c.id
                LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                WHERE rv.id = %s
                """,
                (request_vehicle_id,)
            )
            request_vehicle = cursor.fetchone()

            if not request_vehicle:
                raise HTTPException(
                    status_code=404,
                    detail="Автомобиль в заявке не найден"
                )

            if request_vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя привязать оборудование к удалённой заявке"
                )

            if not can_user_access_request_equipment(request_vehicle, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для добавления оборудования в эту заявку"
                )

            request_id = request_vehicle["request_id"]

            cursor.execute(
                """
                SELECT
                    wi.id,
                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.serial_number,
                    wi.is_serialized,
                    wi.quantity,
                    wi.city_id,
                    city.name AS city_name,
                    wi.status,
                    wi.is_deleted,
                    wi.assigned_to_user_id,
                    assigned_user.name AS assigned_to_user_name
                FROM warehouse_items wi
                LEFT JOIN cities city ON wi.city_id = city.id
                LEFT JOIN users assigned_user ON wi.assigned_to_user_id = assigned_user.id
                WHERE wi.id = %s
                FOR UPDATE
                """,
                (data.warehouse_item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя привязать оборудование из корзины"
                )

            role = current_user["role"]
            is_warehouse_manager = role in WAREHOUSE_MANAGE_ROLES

            item_assigned_user_id = item.get("assigned_to_user_id")
            item_is_from_inventory = (
                item["status"] == "ASSIGNED_TO_TECH"
                and item_assigned_user_id is not None
            )
            item_is_from_stock = (
                item["status"] == "IN_STOCK"
                and item_assigned_user_id is None
            )

            if not item_is_from_inventory and not item_is_from_stock:
                raise HTTPException(
                    status_code=400,
                    detail="Оборудование недоступно для добавления в заявку"
                )

            if not is_warehouse_manager:
                if not item_is_from_inventory:
                    raise HTTPException(
                        status_code=403,
                        detail="Монтажник может добавить только оборудование из своего инвентаря"
                    )

                if int(item_assigned_user_id) != int(current_user["id"]):
                    raise HTTPException(
                        status_code=403,
                        detail="Нельзя добавить оборудование из чужого инвентаря"
                    )

            if item_is_from_stock and not is_warehouse_manager:
                raise HTTPException(
                    status_code=403,
                    detail="Добавлять оборудование напрямую со склада может только админ или заведующий складом"
                )

            installed_by_user_id = None

            if data.installed_by_user_id:
                if not is_warehouse_manager and int(data.installed_by_user_id) != int(current_user["id"]):
                    raise HTTPException(
                        status_code=403,
                        detail="Нельзя указать другого монтажника как установившего"
                    )

                target_user = require_inventory_target_user(
                    cursor,
                    data.installed_by_user_id
                )
                installed_by_user_id = int(target_user["id"])

            elif item_is_from_inventory:
                installed_by_user_id = int(item_assigned_user_id)

            else:
                installed_by_user_id = int(current_user["id"])

            is_serialized = bool(item["is_serialized"])

            if is_serialized:
                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

                cursor.execute(
                    """
                    SELECT id
                    FROM request_equipment
                    WHERE warehouse_item_id = %s
                    """,
                    (data.warehouse_item_id,)
                )
                existing_link = cursor.fetchone()

                if existing_link:
                    raise HTTPException(
                        status_code=400,
                        detail="Это серийное оборудование уже привязано к заявке"
                    )

                cursor.execute(
                    """
                    SELECT
                        ve.id,
                        ve.vehicle_id,

                        v.brand,
                        v.model AS vehicle_model,
                        v.plate_number,
                        v.vin
                    FROM vehicle_equipment ve
                    LEFT JOIN vehicles v ON ve.vehicle_id = v.id
                    WHERE ve.warehouse_item_id = %s
                    AND ve.is_active = 1
                    ORDER BY ve.id DESC
                    LIMIT 1
                    """,
                    (data.warehouse_item_id,)
                )

                existing_direct_link = cursor.fetchone()

                if existing_direct_link:
                    vehicle_title = f"{existing_direct_link.get('brand') or ''} {existing_direct_link.get('vehicle_model') or ''}".strip()

                    if existing_direct_link.get("plate_number"):
                        vehicle_title += f" ({existing_direct_link.get('plate_number')})"

                    if existing_direct_link.get("vin"):
                        vehicle_title += f" VIN: {existing_direct_link.get('vin')}"

                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Это серийное оборудование уже напрямую привязано к машине"
                            f"{': ' + vehicle_title if vehicle_title else ''}. "
                            "Сначала отвяжите его от автомобиля."
                        )
                    )

                old_status = item.get("status")
                from_user_id = int(item_assigned_user_id) if item_assigned_user_id else None

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET status = 'INSTALLED',
                        assigned_to_user_id = NULL,
                        assigned_at = NULL,
                        assigned_by = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.warehouse_item_id,)
                )

                movement_action = (
                    "INSTALLED_FROM_TECH"
                    if item_is_from_inventory
                    else "INSTALLED_FROM_STOCK"
                )

                new_status_for_history = "INSTALLED"

            else:
                available_quantity = int(item["quantity"] or 0)

                if data.quantity > available_quantity:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Недостаточно количества. Доступно: {available_quantity}"
                    )

                new_quantity = available_quantity - data.quantity
                old_status = item.get("status")
                from_user_id = int(item_assigned_user_id) if item_assigned_user_id else None

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (new_quantity, data.warehouse_item_id)
                )

                if item_is_from_inventory and new_quantity == 0:
                    cursor.execute(
                        """
                        UPDATE warehouse_items
                        SET is_deleted = 1,
                            deleted_at = NOW(),
                            deleted_by = %s
                        WHERE id = %s
                        """,
                        (
                            current_user["id"],
                            data.warehouse_item_id,
                        )
                    )

                movement_action = (
                    "CONSUMABLE_USED_FROM_TECH"
                    if item_is_from_inventory
                    else "CONSUMABLE_USED_FROM_STOCK"
                )

                new_status_for_history = old_status

            cursor.execute(
                """
                INSERT INTO request_equipment (
                    request_id,
                    request_vehicle_id,
                    warehouse_item_id,
                    quantity,
                    attached_by,
                    note
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    request_vehicle_id,
                    data.warehouse_item_id,
                    data.quantity,
                    current_user["id"],
                    data.note
                )
            )

            link_id = cursor.lastrowid

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=data.warehouse_item_id,
                action=movement_action,
                current_user=current_user,
                from_city_id=item.get("city_id"),
                to_city_id=None,
                request_id=request_id,
                request_vehicle_id=request_vehicle_id,
                vehicle_id=request_vehicle.get("vehicle_id"),
                request_equipment_id=link_id,
                target_user_id=installed_by_user_id,
                from_user_id=from_user_id,
                quantity=data.quantity,
                old_status=old_status,
                new_status=new_status_for_history,
                reason=data.note or "Оборудование добавлено в заявку"
            )

            item_title = f"{item['name']}"
            if item.get("model"):
                item_title += f" {item['model']}"
            if item.get("identifier_value"):
                item_title += f" ({item['identifier_type']}: {item['identifier_value']})"

            vehicle_title = f"{request_vehicle['brand'] or ''} {request_vehicle['model'] or ''}".strip()
            if request_vehicle["plate_number"]:
                vehicle_title += f" ({request_vehicle['plate_number']})"

            source_title = (
                f"инвентарь: {item.get('assigned_to_user_name') or '—'}"
                if item_is_from_inventory
                else f"склад: {item.get('city_name') or '—'}"
            )

            cursor.execute(
                """
                INSERT INTO request_history (
                    request_id,
                    user_id,
                    action,
                    old_value,
                    new_value
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "EQUIPMENT_ATTACHED",
                    None,
                    f"{item_title}, quantity={data.quantity}, vehicle={vehicle_title}, source={source_title}, installed_by_user_id={installed_by_user_id}"
                )
            )

            connection.commit()

            return {
                "message": "Оборудование привязано к автомобилю в заявке",
                "link_id": link_id,
                "request_id": request_id,
                "request_vehicle_id": request_vehicle_id,
                "warehouse_item_id": data.warehouse_item_id,
                "source": "TECH_INVENTORY" if item_is_from_inventory else "STOCK",
                "installed_by_user_id": installed_by_user_id,
                "quantity": data.quantity,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/request-vehicles/{request_vehicle_id}/equipment")
def get_request_vehicle_equipment(
    request_vehicle_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Получить оборудование конкретного автомобиля внутри заявки.
    Доступ: все авторизованные пользователи.
    """
    require_request_equipment_read(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    rv.id,
                    rv.request_id,
                    r.is_deleted,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.responsible_manager_id
                FROM request_vehicles rv
                INNER JOIN requests r ON rv.request_id = r.id
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE rv.id = %s
                """,
                (request_vehicle_id,)
            )
            request_vehicle = cursor.fetchone()

            if not request_vehicle:
                raise HTTPException(
                    status_code=404,
                    detail="Автомобиль в заявке не найден"
                )

            if request_vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Заявка удалена"
                )
            
            if not can_user_access_request_equipment(request_vehicle, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра оборудования этой заявки"
                )

            cursor.execute(
                """
                SELECT 
                    re.id AS link_id,
                    re.request_id,
                    re.request_vehicle_id,
                    re.warehouse_item_id,
                    re.quantity,
                    re.attached_by,
                    re.attached_at,
                    TIMESTAMPDIFF(SECOND, re.attached_at, NOW()) AS detach_age_seconds,
                    DATE_ADD(
                        re.attached_at,
                        INTERVAL 120 SECOND
                    ) AS detach_deadline_at,
                    re.note,

                    wi.city_id,
                    city.name AS city_name,

                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.serial_number,
                    wi.is_serialized,
                    wi.status,
                    wi.condition_status,

                    u.name AS attached_by_name
                FROM request_equipment re
                LEFT JOIN warehouse_items wi ON re.warehouse_item_id = wi.id
                LEFT JOIN users u ON re.attached_by = u.id
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE re.request_vehicle_id = %s
                ORDER BY re.attached_at DESC
                """,
                (request_vehicle_id,)
            )

            rows = cursor.fetchall()
            return enrich_request_equipment_detach_permissions(rows, current_user)

    finally:
        connection.close()

