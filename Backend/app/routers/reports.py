from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_connection
from app.security import get_current_user
from app.permissions import (
    has_any_permission,
    is_super_admin,
    is_client_user,
    require_employee_user,
    get_data_scope,
    DATA_SCOPE_CITY,
    DATA_SCOPE_CITY_ASSIGNED,
)


def ensure_employee_access(current_user: dict = Depends(get_current_user)):
    """
    Отчёты по своей природе сводят данные всех клиентов сразу.
    Клиентской учётной записи здесь делать нечего ни в одном разрезе.

    Проверка на роутере, а не в эндпоинтах: новый отчёт, добавленный
    завтра, окажется закрыт по умолчанию.
    """
    require_employee_user(
        current_user,
        detail="Отчёты доступны только сотрудникам",
    )

    return current_user


router = APIRouter(
    prefix="/reports",
    tags=["Reports"],
    dependencies=[Depends(ensure_employee_access)],
)


WORK_TYPE_LABELS = {
    "INSTALLATION": "Установка",
    "DIAGNOSTIC": "Диагностика",
    "REMOVAL": "Снятие",
    "REFLASHING": "Перепрошивка",
}

STATUS_LABELS = {
    "NEW": "В ожидании",
    "IN_PROGRESS": "В работе",
    "COMPLETED": "Завершено",
    "CANCELLED": "Отменено",
}

WAREHOUSE_CATEGORIES = {
    "GPS_TRACKER": "Трекер",
    "BEACON": "Маяк",
    "FUEL_SENSOR": "ДУТ",
    "BLE_SENSOR": "BLE-датчик",
    "WIRED_SENSOR": "Проводной датчик",
    "RELAY": "Реле",
    "CABLE": "Кабель",
    "CONSUMABLE": "Расходники",
    "TOOLS": "Инструменты",
    "FIRST_AID": "Аптечки",
    "OTHER": "Другое",
}

WAREHOUSE_DUPLICATE_ACTIONS = {
    "CONSUMABLE_TRANSFERRED_IN",
    "IMPORT_CONSUMABLE_TRANSFERRED_IN",
    "CONSUMABLE_INVENTORY_TRANSFERRED_IN",
    "CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_IN",
    "CONSUMABLE_ASSIGNED_TO_TECH",
    "CONSUMABLE_RETURNED_TO_STOCK",
}

WAREHOUSE_IGNORED_ACTIONS = {"UPDATED"}

WAREHOUSE_ACTION_REASONS = {
    "CREATED": "NEW",
    "IMPORT_CREATED": "NEW",
    "IMPORT_CONSUMABLE_ADDED": "NEW",
    "MANUAL_ADDED_TO_TECH": "NEW",
    "MANUAL_CONSUMABLE_ADDED_TO_TECH": "NEW",
    "RESTORED": "RESTORED",

    "CITY_TRANSFERRED": "TRANSFER",
    "CITY_CHANGED": "TRANSFER",
    "CONSUMABLE_TRANSFERRED_OUT": "TRANSFER",
    "IMPORT_SERIALIZED_TRANSFERRED": "TRANSFER",
    "IMPORT_CONSUMABLE_TRANSFERRED_OUT": "TRANSFER",

    "ASSIGNED_TO_TECH": "TO_TECH",
    "CONSUMABLE_ASSIGNED_OUT": "TO_TECH",
    "INVENTORY_TRANSFERRED_TO_USER": "TO_TECH",
    "CONSUMABLE_INVENTORY_TRANSFERRED_OUT": "TO_TECH",
    "ISSUED_TO_USER": "TO_TECH",

    "RETURNED_TO_STOCK": "FROM_TECH",
    "CONSUMABLE_RETURNED_FROM_TECH_OUT": "FROM_TECH",
    "INVENTORY_TRANSFERRED_TO_STOCK": "FROM_TECH",
    "CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_OUT": "FROM_TECH",
    "RETURNED_FROM_USER": "FROM_TECH",

    "DETACHED_FROM_REQUEST": "FROM_REQUEST",
    "DETACHED_FROM_VEHICLE_DIRECT": "FROM_REQUEST",
    "REMOVAL_COMPLETED_MARKED_USED": "FROM_REQUEST",
    "RETURNABLE_CONSUMABLE_RETURNED_AFTER_REMOVAL": "FROM_REQUEST",

    "ATTACHED_TO_REQUEST": "INSTALLED",
    "INSTALLED_FROM_STOCK": "INSTALLED",
    "INSTALLED_FROM_TECH": "INSTALLED",
    "INSTALLED_TO_VEHICLE_DIRECT": "INSTALLED",
    "CONSUMABLE_USED_FROM_STOCK": "INSTALLED",
    "CONSUMABLE_USED_FROM_TECH": "INSTALLED",
    "CONSUMABLE_USED_TO_VEHICLE_DIRECT": "INSTALLED",

    "WRITTEN_OFF": "WRITTEN_OFF",
    "DELETED": "WRITTEN_OFF",
}

WAREHOUSE_REASON_LABELS = {
    "NEW": "Новое поступление",
    "RESTORED": "Восстановлено из корзины",
    "TRANSFER": "Перемещение между городами",
    "TO_TECH": "Выдано монтажнику",
    "FROM_TECH": "Возврат от монтажника",
    "FROM_REQUEST": "Снято / отвязано от заявки",
    "INSTALLED": "Установлено / израсходовано",
    "WRITTEN_OFF": "Списание и удаление",
    "OTHER": "Прочее",
}

WAREHOUSE_ISSUE_ACTIONS = {
    "ASSIGNED_TO_TECH",
    "CONSUMABLE_ASSIGNED_OUT",
    "INVENTORY_TRANSFERRED_TO_USER",
    "CONSUMABLE_INVENTORY_TRANSFERRED_OUT",
    "MANUAL_ADDED_TO_TECH",
    "MANUAL_CONSUMABLE_ADDED_TO_TECH",
    "ISSUED_TO_USER",
}

WAREHOUSE_RETURN_ACTIONS = {
    "RETURNED_TO_STOCK",
    "CONSUMABLE_RETURNED_FROM_TECH_OUT",
    "INVENTORY_TRANSFERRED_TO_STOCK",
    "CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_OUT",
    "RETURNED_FROM_USER",
}


def user_has_any_permission(current_user: dict, permission_codes: list[str]) -> bool:
    # Вторая линия на случай снятия зависимости с роутера.
    if is_client_user(current_user):
        return False

    return has_any_permission(current_user, permission_codes)


def can_view_request_reports(current_user: dict) -> bool:
    # reports.view — общий корень дерева отчётов, он есть у всех,
    # у кого открыт хоть один отчёт. Здесь нужен конкретный код.
    return user_has_any_permission(current_user, [
        "reports.requests.view",
        "reports.requests.view_own",
        "reports.requests.view_all",
        "reports.manage",
    ])


def can_view_all_request_reports(current_user: dict) -> bool:
    return user_has_any_permission(current_user, [
        "reports.requests.view_all",
        "reports.manage",
    ])


def can_view_manager_reports(current_user: dict) -> bool:
    return user_has_any_permission(current_user, [
        "reports.managers.view",
        "reports.manage",
    ])


def can_view_warehouse_reports(current_user: dict) -> bool:
    return user_has_any_permission(current_user, [
        "reports.warehouse.view",
        "reports.manage",
        "warehouse.reports.view",
        "warehouse.manage",
    ])


def can_view_report_money(current_user: dict) -> bool:
    return user_has_any_permission(current_user, [
        "reports.money.view",
        "reports.manage",
    ])


def require_any_reports(current_user: dict):
    if not (can_view_request_reports(current_user) or can_view_warehouse_reports(current_user)):
        raise HTTPException(status_code=403, detail="Недостаточно прав для просмотра отчётов")


def require_request_reports(current_user: dict):
    if not can_view_request_reports(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для просмотра отчётов по заявкам")


def require_warehouse_reports(current_user: dict):
    if not can_view_warehouse_reports(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для просмотра отчётов по складу")


CITY_SCOPED_DATA_SCOPES = [DATA_SCOPE_CITY, DATA_SCOPE_CITY_ASSIGNED]


def is_city_scoped_reports_user(current_user: dict) -> bool:
    """
    Те же правила, что в warehouse.py: область роли сужает склад до
    одного города, а управление складом или отчётами снимает ограничение.
    """
    if is_super_admin(current_user):
        return False

    if user_has_any_permission(current_user, ["warehouse.manage", "reports.manage"]):
        return False

    return get_data_scope(current_user) in CITY_SCOPED_DATA_SCOPES


def resolve_reports_user_city_id(cursor, current_user: dict) -> int | None:
    user_city = str(current_user.get("city") or "").strip()

    if not user_city:
        return None

    cursor.execute(
        """
        SELECT id
        FROM cities
        WHERE is_active = 1
          AND LOWER(TRIM(name)) = LOWER(TRIM(%s))
        LIMIT 1
        """,
        (user_city,),
    )

    row = cursor.fetchone()

    return int(row["id"]) if row else None


def to_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def to_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def get_client_display_name(row: dict) -> str:
    client_type = row.get("client_type") or row.get("type")

    if client_type in ["TOO", "IP", "ТОО", "ИП"]:
        return row.get("company_name") or row.get("client_name") or "Без названия"

    return row.get("client_name") or row.get("company_name") or "Без названия"


def get_client_key(row: dict) -> str:
    return str(row.get("client_id") or row.get("phone") or get_client_display_name(row))


def parse_executor_concat(value: str | None) -> list[dict]:
    if not value:
        return []

    result = []

    for chunk in str(value).split("||"):
        if not chunk:
            continue

        user_id_raw, _, user_name = chunk.partition("::")
        try:
            user_id = int(user_id_raw)
        except (TypeError, ValueError):
            user_id = None

        result.append({
            "user_id": user_id,
            "user_name": user_name or (f"ID: {user_id}" if user_id else "Исполнитель"),
        })

    return result


def get_scope_owner_ids(row: dict, scope: str) -> list[int]:
    responsible = row.get("responsible_manager_id")
    creator = row.get("created_by")

    responsible_id = int(responsible) if responsible is not None else None
    creator_id = int(creator) if creator is not None else None

    if scope == "my_clients":
        return [responsible_id] if responsible_id is not None else []

    if scope == "created_by_me":
        return [creator_id] if creator_id is not None else []

    ids = []

    if responsible_id is not None:
        ids.append(responsible_id)

    if creator_id is not None and creator_id != responsible_id:
        ids.append(creator_id)

    return ids


def matches_personal_scope(row: dict, scope: str, user_id: int | None) -> bool:
    if user_id is None:
        return True

    responsible = row.get("responsible_manager_id")
    creator = row.get("created_by")

    is_my_client = responsible is not None and int(responsible) == int(user_id)
    is_my_request = creator is not None and int(creator) == int(user_id)

    if scope == "my_clients":
        return is_my_client

    if scope == "created_by_me":
        return is_my_request

    return is_my_client or is_my_request


def date_to_iso(value):
    if value is None:
        return None

    if hasattr(value, "isoformat"):
        return value.isoformat()

    return value


def period_key(value, granularity: str) -> str | None:
    if not value:
        return None

    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    elif isinstance(value, datetime):
        dt = value
    else:
        return None

    if granularity == "month":
        return f"{dt.year:04d}-{dt.month:02d}"

    if granularity == "week":
        monday = dt - timedelta(days=dt.isoweekday() - 1)
        return f"{monday.year:04d}-{monday.month:02d}-{monday.day:02d}"

    return f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}"


def add_counter(bucket: dict, key, label: str, amount: int = 1, color: str | None = None):
    key = str(key or "none")

    if key not in bucket:
        bucket[key] = {
            "key": key,
            "label": label or "Не указано",
            "count": 0,
        }

        if color:
            bucket[key]["color"] = color

    bucket[key]["count"] += amount


def finalize_counter(bucket: dict, limit: int | None = None) -> list[dict]:
    rows = sorted(
        bucket.values(),
        key=lambda row: (-to_int(row.get("count")), str(row.get("label") or "")),
    )

    if limit:
        return rows[:limit]

    return rows


def add_nested_counter(bucket: dict, parent_key, parent_label: str, child_key, child_label: str, request: dict):
    parent_key = str(parent_key or "none")

    if parent_key not in bucket:
        bucket[parent_key] = {
            "key": parent_key,
            "label": parent_label or "Не указано",
            "count": 0,
            "requests": [],
            "children_map": {},
        }

    parent = bucket[parent_key]
    parent["count"] += 1
    parent["requests"].append(request)

    child_key = str(child_key or "none")

    if child_key not in parent["children_map"]:
        parent["children_map"][child_key] = {
            "key": child_key,
            "label": child_label or "Не указано",
            "count": 0,
            "requests": [],
        }

    child = parent["children_map"][child_key]
    child["count"] += 1
    child["requests"].append(request)


def finalize_nested(bucket: dict, limit: int | None = None) -> list[dict]:
    result = []

    for parent in bucket.values():
        row = {
            key: value
            for key, value in parent.items()
            if key != "children_map"
        }
        row["children"] = sorted(
            parent["children_map"].values(),
            key=lambda item: (-to_int(item.get("count")), str(item.get("label") or "")),
        )
        result.append(row)

    result.sort(key=lambda item: (-to_int(item.get("count")), str(item.get("label") or "")))

    if limit:
        return result[:limit]

    return result


def get_request_rows(cursor, current_user: dict, can_see_money: bool) -> list[dict]:
    conditions = ["r.is_deleted = 0"]
    values = []

    if not can_view_all_request_reports(current_user):
        conditions.append(
            """
            (
                c.responsible_manager_id = %s
                OR r.created_by = %s
            )
            """
        )
        values.extend([current_user["id"], current_user["id"]])

    where_clause = " AND ".join(conditions)

    cursor.execute(
        f"""
        SELECT
            r.id,
            r.client_id,
            r.work_type,
            r.visit_type,
            r.address,
            r.city,
            r.platform,
            r.scheduled_at,
            r.status,
            r.created_at,
            r.assigned_to,
            r.is_paid,
            r.paid_at,
            r.total_price,
            r.created_by,

            creator.name AS created_by_name,
            creator.role AS created_by_role,

            c.name AS client_name,
            c.company_name,
            c.phone,
            c.type AS client_type,
            c.responsible_manager_id,

            responsible.name AS responsible_manager_name,
            responsible.role AS responsible_manager_role,

            GROUP_CONCAT(
                DISTINCT CONCAT(executor_user.id, '::', executor_user.name)
                ORDER BY executor_user.name ASC
                SEPARATOR '||'
            ) AS executors_concat
        FROM requests r
        LEFT JOIN clients c ON r.client_id = c.id
        LEFT JOIN users creator ON r.created_by = creator.id
        LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
        LEFT JOIN request_executors re ON re.request_id = r.id
        LEFT JOIN users executor_user ON re.user_id = executor_user.id
        WHERE {where_clause}
        GROUP BY
            r.id,
            r.client_id,
            r.work_type,
            r.visit_type,
            r.address,
            r.city,
            r.platform,
            r.scheduled_at,
            r.status,
            r.created_at,
            r.assigned_to,
            r.is_paid,
            r.paid_at,
            r.total_price,
            r.created_by,
            creator.name,
            creator.role,
            c.name,
            c.company_name,
            c.phone,
            c.type,
            c.responsible_manager_id,
            responsible.name,
            responsible.role
        ORDER BY r.created_at DESC, r.id DESC
        """,
        tuple(values),
    )

    rows = cursor.fetchall()

    for row in rows:
        row["executors"] = parse_executor_concat(row.pop("executors_concat", None))
        row["client_display_name"] = get_client_display_name(row)
        row["client_key"] = get_client_key(row)
        row["can_view_prices"] = can_see_money

        if not can_see_money:
            row["total_price"] = None

        for date_field in ["scheduled_at", "created_at", "paid_at"]:
            row[date_field] = date_to_iso(row.get(date_field))

    return rows


def parse_report_date(value: str, field_name: str, end_of_day: bool = False) -> datetime:
    suffix = "T23:59:59" if end_of_day else "T00:00:00"

    try:
        return datetime.fromisoformat(f"{value}{suffix}")
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Некорректная дата {field_name}. Используйте формат ГГГГ-ММ-ДД",
        )


def apply_request_filters(
    rows: list[dict],
    *,
    client_key: str | None,
    date_from: str | None,
    date_to: str | None,
    city: str | None,
    work_type: str | None,
    status: str | None,
    manager_id: int | None,
    personal_scope: str,
) -> list[dict]:
    result = list(rows)

    if client_key:
        result = [row for row in result if str(row.get("client_key")) == str(client_key)]

    if city:
        result = [row for row in result if str(row.get("city") or "") == str(city)]

    if work_type:
        work_type = work_type.upper()
        result = [row for row in result if row.get("work_type") == work_type]

    if status:
        status = status.upper()
        result = [row for row in result if row.get("status") == status]

    if date_from:
        from_value = parse_report_date(date_from, "date_from")
        result = [
            row for row in result
            if row.get("created_at") and datetime.fromisoformat(str(row["created_at"])) >= from_value
        ]

    if date_to:
        to_value = parse_report_date(date_to, "date_to", end_of_day=True)
        result = [
            row for row in result
            if row.get("created_at") and datetime.fromisoformat(str(row["created_at"])) <= to_value
        ]

    if manager_id:
        result = [
            row for row in result
            if matches_personal_scope(row, personal_scope, manager_id)
        ]

    return result


def build_request_report(rows: list[dict], all_rows: list[dict], *, granularity: str, can_see_money: bool, can_see_manager_reports: bool):
    summary = {
        "total": len(rows),
        "new": 0,
        "in_progress": 0,
        "completed": 0,
        "cancelled": 0,
        "paid_count": 0,
        "paid_sum": 0,
        "unpaid_sum": 0,
    }

    by_status = {}
    by_work_type = {}
    by_city = {}
    by_client = {}
    by_technician_completed = {}
    by_technician_all = {}
    timeline = {}

    for row in rows:
        status = row.get("status")
        work_type = row.get("work_type")

        if status == "NEW":
            summary["new"] += 1
        elif status == "IN_PROGRESS":
            summary["in_progress"] += 1
        elif status == "COMPLETED":
            summary["completed"] += 1
        elif status == "CANCELLED":
            summary["cancelled"] += 1

        if row.get("is_paid"):
            summary["paid_count"] += 1
            if can_see_money:
                summary["paid_sum"] += to_float(row.get("total_price"))
        elif can_see_money:
            summary["unpaid_sum"] += to_float(row.get("total_price"))

        add_counter(
            by_status,
            status,
            STATUS_LABELS.get(status, status or "Не указано"),
        )
        add_counter(
            by_work_type,
            work_type,
            WORK_TYPE_LABELS.get(work_type, work_type or "Не указано"),
        )
        add_counter(by_city, row.get("city"), row.get("city") or "Город не указан")
        add_counter(by_client, row.get("client_key"), row.get("client_display_name") or "Клиент")

        key = period_key(row.get("created_at"), granularity)
        if key:
            if key not in timeline:
                timeline[key] = {
                    "key": key,
                    "label": key,
                    "total": 0,
                    "completed": 0,
                    "paid_sum": 0,
                }

            timeline[key]["total"] += 1

            if status == "COMPLETED":
                timeline[key]["completed"] += 1

            if can_see_money and row.get("is_paid"):
                timeline[key]["paid_sum"] += to_float(row.get("total_price"))

        executors = row.get("executors") or []

        if not executors and row.get("assigned_to"):
            executors = [{
                "user_id": row.get("assigned_to"),
                "user_name": f"ID: {row.get('assigned_to')}",
            }]

        for executor in executors:
            executor_key = executor.get("user_id") or executor.get("user_name")
            executor_label = executor.get("user_name") or f"ID: {executor.get('user_id')}"

            add_nested_counter(
                by_technician_all,
                executor_key,
                executor_label,
                row.get("client_key"),
                row.get("client_display_name"),
                row,
            )

            if status == "COMPLETED":
                add_nested_counter(
                    by_technician_completed,
                    executor_key,
                    executor_label,
                    row.get("client_key"),
                    row.get("client_display_name"),
                    row,
                )

    client_options_map = {}

    for row in all_rows:
        key = row.get("client_key")

        if key and key not in client_options_map:
            client_options_map[key] = {
                "key": key,
                "label": row.get("client_display_name") or "Клиент",
                "phone": row.get("phone") or "",
            }

    manager_options_map = {}
    manager_rows = {}

    for row in all_rows:
        for owner_id in get_scope_owner_ids(row, "all_mine"):
            if owner_id is None:
                continue

            name = None
            role = None

            if row.get("responsible_manager_id") is not None and int(row["responsible_manager_id"]) == int(owner_id):
                name = row.get("responsible_manager_name")
                role = row.get("responsible_manager_role")

            if not name and row.get("created_by") is not None and int(row["created_by"]) == int(owner_id):
                name = row.get("created_by_name")
                role = row.get("created_by_role")

            manager_options_map[owner_id] = {
                "id": owner_id,
                "name": name or f"ID: {owner_id}",
                "role": role,
            }

            if owner_id not in manager_rows:
                manager_rows[owner_id] = {
                    **manager_options_map[owner_id],
                    "total": 0,
                    "completed": 0,
                    "paid_sum": 0,
                    "clients": set(),
                }

            manager_rows[owner_id]["total"] += 1
            manager_rows[owner_id]["clients"].add(row.get("client_key"))

            if row.get("status") == "COMPLETED":
                manager_rows[owner_id]["completed"] += 1

            if can_see_money and row.get("is_paid"):
                manager_rows[owner_id]["paid_sum"] += to_float(row.get("total_price"))

    managers = []

    if can_see_manager_reports:
        for manager in manager_rows.values():
            managers.append({
                "id": manager["id"],
                "name": manager["name"],
                "role": manager.get("role"),
                "total": manager["total"],
                "completed": manager["completed"],
                "paid_sum": manager["paid_sum"],
                "clients": len(manager["clients"]),
            })

        managers.sort(key=lambda item: (-to_float(item["paid_sum"]), -to_int(item["total"]), item["name"]))

    return {
        "summary": summary,
        "by_status": finalize_counter(by_status),
        "by_work_type": finalize_counter(by_work_type),
        "by_city": finalize_counter(by_city, 12),
        "top_clients": finalize_counter(by_client, 12),
        "technicians_completed": finalize_nested(by_technician_completed, 12),
        "technicians_all": finalize_nested(by_technician_all, 20),
        "timeline": sorted(timeline.values(), key=lambda row: row["key"]),
        "managers": managers,
        "client_options": sorted(client_options_map.values(), key=lambda row: row["label"]),
        "manager_options": sorted(manager_options_map.values(), key=lambda row: row["name"]),
        "requests": rows[:500],
    }


def empty_warehouse_bucket():
    return {
        "devices": 0,
        "consumables": 0,
        "total": 0,
    }


def add_to_warehouse_bucket(bucket: dict, is_serialized, quantity):
    qty = 1 if bool(is_serialized) else max(to_int(quantity), 0)
    kind = "devices" if bool(is_serialized) else "consumables"

    bucket[kind] += qty
    bucket["total"] += qty

    return qty, kind


def fetch_warehouse_items(cursor, city_id: int | None) -> list[dict]:
    conditions = ["wi.is_deleted = 0"]
    values = []

    if city_id:
        conditions.append("wi.city_id = %s")
        values.append(city_id)

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
            wi.status,
            wi.city_id,
            city.name AS city_name
        FROM warehouse_items wi
        LEFT JOIN cities city ON wi.city_id = city.id
        WHERE {" AND ".join(conditions)}
        ORDER BY city.name ASC, wi.category ASC, wi.name ASC, wi.id ASC
        """,
        tuple(values),
    )

    return cursor.fetchall()


def build_warehouse_stock(items: list[dict]) -> dict:
    totals = empty_warehouse_bucket()
    cities = {}

    for item in items:
        qty, kind = add_to_warehouse_bucket(totals, item.get("is_serialized"), item.get("quantity"))

        city_key = str(item.get("city_id") or "none")

        if city_key not in cities:
            cities[city_key] = {
                "key": city_key,
                "city_id": item.get("city_id"),
                "city_name": item.get("city_name") or "Город не указан",
                **empty_warehouse_bucket(),
                "categories_map": {},
            }

        city = cities[city_key]
        city[kind] += qty
        city["total"] += qty

        category = item.get("category") or "OTHER"

        if category not in city["categories_map"]:
            city["categories_map"][category] = {
                "category": category,
                "label": WAREHOUSE_CATEGORIES.get(category, category),
                "count": 0,
            }

        city["categories_map"][category]["count"] += qty

    city_rows = []

    for city in cities.values():
        city_rows.append({
            key: value
            for key, value in city.items()
            if key != "categories_map"
        } | {
            "categories": sorted(
                city["categories_map"].values(),
                key=lambda row: (-to_int(row.get("count")), row.get("label") or ""),
            )
        })

    city_rows.sort(key=lambda row: (-to_int(row.get("total")), row.get("city_name") or ""))

    return {
        "totals": totals,
        "cities": city_rows,
    }


def fetch_warehouse_movements(cursor, date_from: str | None, date_to: str | None, city_id: int | None) -> list[dict]:
    conditions = []
    values = []

    if date_from:
        conditions.append("wh.created_at >= %s")
        values.append(f"{date_from} 00:00:00")

    if date_to:
        conditions.append("wh.created_at <= %s")
        values.append(f"{date_to} 23:59:59")

    if city_id:
        conditions.append(
            """
            (
                wh.from_city_id = %s
                OR wh.to_city_id = %s
                OR (wh.from_city_id IS NULL AND wh.to_city_id IS NULL AND wi.city_id = %s)
            )
            """
        )
        values.extend([city_id, city_id, city_id])

    where_clause = " AND ".join(conditions) if conditions else "1 = 1"

    cursor.execute(
        f"""
        SELECT
            wh.id,
            wh.warehouse_item_id,
            wh.action,
            wh.from_city_id,
            from_city.name AS from_city_name,
            wh.to_city_id,
            to_city.name AS to_city_name,
            wh.request_id,
            wh.target_user_id,
            target_user.name AS target_user_name,
            wh.from_user_id,
            from_user.name AS from_user_name,
            wh.quantity,
            wh.created_at,

            wi.id AS item_id,
            wi.city_id AS item_city_id,
            item_city.name AS item_city_name,
            wi.name AS item_name,
            wi.category,
            wi.is_serialized,
            wi.identifier_type,
            wi.identifier_value,
            wi.serial_number
        FROM warehouse_item_movements wh
        LEFT JOIN warehouse_items wi ON wh.warehouse_item_id = wi.id
        LEFT JOIN cities from_city ON wh.from_city_id = from_city.id
        LEFT JOIN cities to_city ON wh.to_city_id = to_city.id
        LEFT JOIN cities item_city ON wi.city_id = item_city.id
        LEFT JOIN users target_user ON wh.target_user_id = target_user.id
        LEFT JOIN users from_user ON wh.from_user_id = from_user.id
        WHERE {where_clause}
        ORDER BY wh.created_at DESC, wh.id DESC
        """,
        tuple(values),
    )

    rows = cursor.fetchall()

    for row in rows:
        row["created_at"] = date_to_iso(row.get("created_at"))

    return rows


def movement_quantity(row: dict) -> int:
    if bool(row.get("is_serialized")):
        return 1

    return abs(to_int(row.get("quantity"))) or 1


def build_warehouse_movements_report(rows: list[dict]) -> dict:
    totals = {
        "in": empty_warehouse_bucket(),
        "out": empty_warehouse_bucket(),
        "transfer": empty_warehouse_bucket(),
        "internal": empty_warehouse_bucket(),
    }
    cities = {}
    routes = {}
    items = {}
    technicians = {}
    unknown_actions = set()

    def city_entry(city_id, city_name):
        key = str(city_id or "none")

        if key not in cities:
            cities[key] = {
                "key": key,
                "city_id": city_id,
                "city_name": city_name or "Город не указан",
                "in": empty_warehouse_bucket(),
                "out": empty_warehouse_bucket(),
                "internal": empty_warehouse_bucket(),
                "reasons": {},
            }

        return cities[key]

    def add_city(city_id, city_name, direction, reason, is_serialized, qty):
        city = city_entry(city_id, city_name)
        kind = "devices" if bool(is_serialized) else "consumables"

        city[direction][kind] += qty
        city[direction]["total"] += qty

        if reason not in city["reasons"]:
            city["reasons"][reason] = {
                "reason": reason,
                "label": WAREHOUSE_REASON_LABELS.get(reason, reason),
                **empty_warehouse_bucket(),
            }

        city["reasons"][reason][kind] += qty
        city["reasons"][reason]["total"] += qty

    for row in rows:
        action = row.get("action")

        if action in WAREHOUSE_IGNORED_ACTIONS or action in WAREHOUSE_DUPLICATE_ACTIONS:
            continue

        if action not in WAREHOUSE_ACTION_REASONS:
            unknown_actions.add(action)

        reason = WAREHOUSE_ACTION_REASONS.get(action, "OTHER")
        qty = movement_quantity(row)
        is_serialized = bool(row.get("is_serialized"))
        kind = "devices" if is_serialized else "consumables"

        source = row.get("from_city_id")
        source_name = row.get("from_city_name")
        target = row.get("to_city_id")
        target_name = row.get("to_city_name")

        if source is None and target is None:
            source = row.get("item_city_id")
            source_name = row.get("item_city_name")

        item_key = f"{row.get('item_name')}|{row.get('category')}|{is_serialized}"

        if item_key not in items:
            items[item_key] = {
                "key": item_key,
                "name": row.get("item_name") or "Без наименования",
                "category": row.get("category") or "OTHER",
                "label": row.get("item_name") or "Без наименования",
                "qty_in": 0,
                "qty_out": 0,
                "total": 0,
            }

        item = items[item_key]

        technician_name = None

        if action in WAREHOUSE_ISSUE_ACTIONS:
            technician_name = row.get("target_user_name")
        elif action in WAREHOUSE_RETURN_ACTIONS:
            technician_name = row.get("from_user_name")

        if technician_name:
            if technician_name not in technicians:
                technicians[technician_name] = {
                    "key": technician_name,
                    "name": technician_name,
                    "issued": empty_warehouse_bucket(),
                    "returned": empty_warehouse_bucket(),
                    "total": 0,
                }

            tech = technicians[technician_name]

            if action in WAREHOUSE_ISSUE_ACTIONS:
                tech["issued"][kind] += qty
                tech["issued"]["total"] += qty
            else:
                tech["returned"][kind] += qty
                tech["returned"]["total"] += qty

            tech["total"] = tech["issued"]["total"] + tech["returned"]["total"]

        if source is not None and target is not None and int(source) != int(target):
            add_city(source, source_name, "out", reason, is_serialized, qty)
            add_city(target, target_name, "in", reason, is_serialized, qty)

            totals["out"][kind] += qty
            totals["out"]["total"] += qty
            totals["in"][kind] += qty
            totals["in"]["total"] += qty
            totals["transfer"][kind] += qty
            totals["transfer"]["total"] += qty

            item["qty_in"] += qty
            item["qty_out"] += qty

            route_key = f"{source}-{target}"

            if route_key not in routes:
                routes[route_key] = {
                    "key": route_key,
                    "from_city_name": source_name or f"ID: {source}",
                    "to_city_name": target_name or f"ID: {target}",
                    **empty_warehouse_bucket(),
                }

            routes[route_key][kind] += qty
            routes[route_key]["total"] += qty

        elif source is not None and target is not None:
            add_city(source, source_name, "internal", reason, is_serialized, qty)
            totals["internal"][kind] += qty
            totals["internal"]["total"] += qty

        elif target is not None:
            add_city(target, target_name, "in", reason, is_serialized, qty)
            totals["in"][kind] += qty
            totals["in"]["total"] += qty
            item["qty_in"] += qty

        elif source is not None:
            add_city(source, source_name, "out", reason, is_serialized, qty)
            totals["out"][kind] += qty
            totals["out"]["total"] += qty
            item["qty_out"] += qty

        item["total"] = item["qty_in"] + item["qty_out"]

    city_rows = []

    for city in cities.values():
        city_rows.append({
            **{key: value for key, value in city.items() if key != "reasons"},
            "net": {
                "devices": city["in"]["devices"] - city["out"]["devices"],
                "consumables": city["in"]["consumables"] - city["out"]["consumables"],
                "total": city["in"]["total"] - city["out"]["total"],
            },
            "reasons": sorted(
                city["reasons"].values(),
                key=lambda row: (-to_int(row.get("total")), row.get("label") or ""),
            ),
        })

    city_rows.sort(key=lambda row: (-(row["in"]["total"] + row["out"]["total"]), row["city_name"]))

    return {
        "totals": totals,
        "cities": city_rows,
        "routes": sorted(routes.values(), key=lambda row: (-to_int(row.get("total")), row.get("from_city_name") or "")),
        "top_items": sorted([row for row in items.values() if row["total"] > 0], key=lambda row: -row["total"])[:12],
        "technicians": sorted(technicians.values(), key=lambda row: (-to_int(row.get("total")), row.get("name") or "")),
        "unknown_actions": sorted([action for action in unknown_actions if action]),
    }


@router.get("/access")
def get_reports_access(current_user: dict = Depends(get_current_user)):
    require_any_reports(current_user)

    return {
        "role": current_user.get("role"),
        "user_id": current_user.get("id"),
        "can_view_reports": can_view_request_reports(current_user) or can_view_warehouse_reports(current_user),
        "can_view_request_reports": can_view_request_reports(current_user),
        "can_view_all_request_reports": can_view_all_request_reports(current_user),
        "can_view_manager_reports": can_view_manager_reports(current_user),
        "can_view_warehouse_reports": can_view_warehouse_reports(current_user),
        "can_view_money": can_view_report_money(current_user),
    }


@router.get("/requests")
def get_request_reports(
    client_key: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    city: str | None = Query(default=None),
    work_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    manager_id: int | None = Query(default=None),
    personal_scope: str = Query(default="all_mine"),
    granularity: str = Query(default="day"),
    current_user: dict = Depends(get_current_user),
):
    require_request_reports(current_user)

    if personal_scope not in ["all_mine", "my_clients", "created_by_me"]:
        raise HTTPException(status_code=400, detail="Некорректный персональный срез")

    if granularity not in ["day", "week", "month"]:
        raise HTTPException(status_code=400, detail="Некорректная группировка периода")

    if manager_id and not can_view_manager_reports(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для выбора менеджера")

    can_see_money = can_view_report_money(current_user)
    can_see_manager_reports = can_view_manager_reports(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            all_rows = get_request_rows(cursor, current_user, can_see_money)

        filtered_rows = apply_request_filters(
            all_rows,
            client_key=client_key,
            date_from=date_from,
            date_to=date_to,
            city=city,
            work_type=work_type,
            status=status,
            manager_id=manager_id,
            personal_scope=personal_scope,
        )

        report = build_request_report(
            filtered_rows,
            all_rows,
            granularity=granularity,
            can_see_money=can_see_money,
            can_see_manager_reports=can_see_manager_reports,
        )

        return {
            "filters": {
                "client_key": client_key or "",
                "date_from": date_from or "",
                "date_to": date_to or "",
                "city": city or "",
                "work_type": work_type or "",
                "status": status or "",
                "manager_id": manager_id,
                "personal_scope": personal_scope,
                "granularity": granularity,
            },
            "access": {
                "can_view_money": can_see_money,
                "can_view_manager_reports": can_see_manager_reports,
            },
            **report,
        }

    finally:
        connection.close()


@router.get("/warehouse")
def get_warehouse_reports(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    city_id: int | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    require_warehouse_reports(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            # Городская роль не может переопределить город параметром запроса —
            # то же правило, что и на вкладке «Склад».
            if is_city_scoped_reports_user(current_user):
                scoped_city_id = resolve_reports_user_city_id(cursor, current_user)

                if scoped_city_id is None:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "В вашем профиле не указан город или он отсутствует "
                            "в справочнике. Обратитесь к администратору."
                        ),
                    )

                city_id = scoped_city_id

            items = fetch_warehouse_items(cursor, city_id)
            movements = fetch_warehouse_movements(cursor, date_from, date_to, city_id)

        return {
            "filters": {
                "date_from": date_from or "",
                "date_to": date_to or "",
                "city_id": city_id,
            },
            "stock": build_warehouse_stock(items),
            "movements": build_warehouse_movements_report(movements),
            "movements_count": len(movements),
        }

    finally:
        connection.close()
