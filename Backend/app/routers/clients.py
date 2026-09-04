from fastapi import APIRouter, HTTPException, Depends, Query
from app.database import get_connection
from app.schemas import (
    ClientCreate,
    ClientUpdate,
    ClientStatusUpdate,
    ClientResponsibleUpdate,
    ClientPaymentTypeUpdate,
    ClientInstallationSettingsUpdate,
)
from app.security import get_current_user
from app.routers.vehicles import can_edit_vehicle_for_client
from app.permissions import (
    has_any_permission,
    get_data_scope,
    can_view_price_fields,
    can_edit_client,
    can_change_client_status,
    can_reassign_clients,
    can_create_request_for_client,
    can_view_client_installation_settings,
    can_manage_client_installation_settings,
    can_view_client_history,
    add_client_history,
    is_client_owned_by_user,
    is_valid_client_status,
    require_employee_user,
)


def ensure_employee_access(current_user: dict = Depends(get_current_user)):
    """
    Раздел «Клиенты» — внутренний: здесь вся клиентская база компании,
    пароли платформы мониторинга, статусы платёжной дисциплины и корзина.

    Клиентская учётная запись сюда не попадает ни при каких правах.
    Свои данные кабинет получает отдельными портальными эндпоинтами.
    """
    require_employee_user(
        current_user,
        detail="Раздел клиентов доступен только сотрудникам",
    )

    return current_user


router = APIRouter(
    prefix="/clients",
    tags=["Clients"],
    dependencies=[Depends(ensure_employee_access)],
)

def normalize_text(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())

CRM_GROUP_NAME = "Обычные клиенты CRM"

TECHNICAL_ROOT_PARENT_NAMES = {
    'тоо "автопарк-слежение"',
    'тоо «автопарк-слежение»',
    'автопарк-слежение',
    'автопарк слежение',
}

CLIENT_DATA_SCOPE_RESPONSIBLE_CLIENTS = "RESPONSIBLE_CLIENTS"
CLIENT_DATA_SCOPE_OWN = "OWN"

CLIENT_VIEW_PERMISSION_CODES = [
    "clients.view",
    "clients.view_all",
    "clients.view_own",
    "clients.manage",
]

CLIENT_VIEW_ALL_PERMISSION_CODES = [
    "clients.view_all",
    "clients.manage",
]

CLIENT_VIEW_OWN_PERMISSION_CODES = [
    "clients.view_own",
]

CLIENT_CREATE_PERMISSION_CODES = [
    "clients.create",
    "clients.manage",
]

CLIENT_DELETE_PERMISSION_CODES = [
    "clients.delete",
    "clients.manage",
]

CLIENT_RESTORE_PERMISSION_CODES = [
    "clients.restore",
    "clients.manage",
]

CLIENT_TRASH_VIEW_PERMISSION_CODES = [
    "clients.trash.view",
    "clients.manage",
]

CLIENT_PAYMENT_TYPE_MANAGE_PERMISSION_CODES = [
    "clients.payment_type.manage",
    "clients.payment.manage",
    "clients.manage",
]

CLIENT_MONITORING_PASSWORD_VIEW_PERMISSION_CODES = [
    "clients.monitoring_password.view",
    "clients.manage",
]

CLIENT_MONITORING_PASSWORD_MANAGE_PERMISSION_CODES = [
    "clients.monitoring_credentials.manage",
    "clients.manage",
]

CLIENT_PAYMENT_PREPAYMENT = "PREPAYMENT"
CLIENT_PAYMENT_POSTPAYMENT = "POSTPAYMENT"

ALLOWED_CLIENT_PAYMENT_TYPES = [
    CLIENT_PAYMENT_PREPAYMENT,
    CLIENT_PAYMENT_POSTPAYMENT,
]

ALLOWED_INSTALLATION_VISIT_TYPES = ["IN_OFFICE", "ON_SITE"]

# Командировка по километражу зависит от адреса, а не от договора,
# поэтому в параметрах клиента её выбрать нельзя — только при создании заявки.
ALLOWED_INSTALLATION_VISIT_PRICE_CODES = [
    "ON_SITE_CITY",
    "ON_SITE_OUTSIDE_CITY",
]

# Ограничение глубины иерархии клиентов.
# Реальная база после миграции 2026_09_02_client_parent_id имеет глубину 2,
# запас нужен только как страховка от кольца.
CLIENT_TREE_MAX_DEPTH = 10

# Старое имя оставлено, чтобы не ломать возможные внешние импорты.
CLIENT_PARENT_LOOKUP_MAX_DEPTH = CLIENT_TREE_MAX_DEPTH

def can_view_clients(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_VIEW_PERMISSION_CODES)

def can_view_all_clients(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_VIEW_ALL_PERMISSION_CODES)

def can_create_client(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_CREATE_PERMISSION_CODES)

def can_delete_client(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_DELETE_PERMISSION_CODES)

def can_restore_client(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_RESTORE_PERMISSION_CODES)

def can_view_deleted_clients(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_TRASH_VIEW_PERMISSION_CODES)

def can_manage_client_payment_type(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_PAYMENT_TYPE_MANAGE_PERMISSION_CODES)

def is_responsible_only_client_scope(current_user: dict) -> bool:
    return get_data_scope(current_user) in [
        CLIENT_DATA_SCOPE_RESPONSIBLE_CLIENTS,
        CLIENT_DATA_SCOPE_OWN,
    ]

def can_view_client_monitoring_password(current_user: dict) -> bool:
    return has_any_permission(
        current_user,
        CLIENT_MONITORING_PASSWORD_VIEW_PERMISSION_CODES,
    )


def can_manage_client_monitoring_password(current_user: dict) -> bool:
    return has_any_permission(
        current_user,
        CLIENT_MONITORING_PASSWORD_MANAGE_PERMISSION_CODES,
    )

def can_open_client_details_for_router(client: dict, current_user: dict) -> bool:
    if can_view_all_clients(current_user):
        return True

    if has_any_permission(current_user, CLIENT_VIEW_OWN_PERMISSION_CODES):
        return is_client_owned_by_user(client, current_user)

    return False

def ensure_can_view_clients(current_user: dict):
    if not can_view_clients(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра клиентов",
        )

def apply_client_access_scope_condition(
    conditions: list[str],
    values: list,
    current_user: dict,
    table_alias: str = "c",
):
    """
    Ограничение видимости клиентов для областей
    RESPONSIBLE_CLIENTS и OWN.

    Условие должно совпадать с is_client_owned_by_user():
    свой клиент — тот, где пользователь ответственный или создатель.
    """
    if not is_responsible_only_client_scope(current_user):
        return

    conditions.append(
        f"({table_alias}.responsible_manager_id = %s OR {table_alias}.created_by = %s)"
    )
    values.append(current_user["id"])
    values.append(current_user["id"])

def ensure_client_visible_by_scope(client: dict, current_user: dict):
    """
    Защита прямого доступа по ID.
    Нужна, чтобы пользователь не мог открыть клиента напрямую,
    если его нет в списке.
    """
    if not is_responsible_only_client_scope(current_user):
        return

    if not is_client_owned_by_user(client, current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра этого клиента"
        )

def normalize_optional_str(value):
    if value is None:
        return None

    value = str(value).strip()
    return value or None

def normalize_client_bin_iin(value: str | None) -> str | None:
    if value is None:
        return None

    value = str(value).strip()
    return value or None


def is_individual_client_type(client_type: str | None) -> bool:
    return str(client_type or "").strip().upper() == "INDIVIDUAL"


def validate_client_bin_iin(client_type: str | None, bin_iin: str | None):
    """
    Для ТОО/ИП БИН обязателен.
    Для физлиц ИИН необязателен.
    """
    normalized_bin_iin = normalize_client_bin_iin(bin_iin)

    if not is_individual_client_type(client_type) and not normalized_bin_iin:
        raise HTTPException(
            status_code=400,
            detail="Для ТОО и ИП поле БИН обязательно"
        )

    return normalized_bin_iin

def get_client_status(value: str | None) -> str:
    status = str(value or "ACTIVE").strip().upper()

    if not is_valid_client_status(status):
        raise HTTPException(status_code=400, detail="Некорректный статус клиента")

    return status

def get_client_payment_type(value: str | None) -> str:
    payment_type = str(value or CLIENT_PAYMENT_PREPAYMENT).strip().upper()

    if payment_type not in ALLOWED_CLIENT_PAYMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Некорректный тип оплаты клиента"
        )

    return payment_type

def get_default_responsible_manager_id(data: ClientCreate, current_user: dict):
    """
    При создании клиента:
    - пользователь с правом переназначения может указать responsible_manager_id;
    - MANAGER или любая роль с can_be_responsible_manager становится ответственной автоматически;
    - остальные роли клиента создать могут, но ответственным автоматически не становятся.
    """
    requested_responsible_id = getattr(data, "responsible_manager_id", None)

    if requested_responsible_id is not None:
        if not can_reassign_clients(current_user):
            raise HTTPException(
                status_code=403,
                detail="Недостаточно прав для назначения ответственного за клиента",
            )

        return requested_responsible_id

    if current_user.get("can_be_responsible_manager"):
        return current_user["id"]

    return None

def ensure_responsible_user_allowed(cursor, responsible_manager_id: int | None):
    if responsible_manager_id is None:
        return

    cursor.execute(
        """
        SELECT
            u.id,
            u.role,
            u.is_approved,
            COALESCE(r.can_be_responsible_manager, 0) AS can_be_responsible_manager
        FROM users u
        LEFT JOIN roles r ON r.code = u.role
        WHERE u.id = %s
        """,
        (responsible_manager_id,)
    )
    user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="Ответственный пользователь не найден")

    if not bool(user.get("can_be_responsible_manager")):
        raise HTTPException(
            status_code=400,
            detail="Ответственным за клиента можно назначить только пользователя с правом быть ответственным менеджером"
        )

    if not user["is_approved"]:
        raise HTTPException(
            status_code=400,
            detail="Нельзя назначить неутверждённого пользователя ответственным"
        )

def attach_client_permissions(client: dict, current_user: dict) -> dict:
    can_open_details = can_open_client_details_for_router(client, current_user)

    client["can_open_details"] = can_open_details
    client["can_edit"] = can_edit_client(client, current_user)

    # Действия над конкретным клиентом: право плюс доступ именно к нему.
    # Фронт после шага 188 опирается только на эти флаги, поэтому они
    # должны отвечать «можно с этим клиентом», а не «право есть вообще».
    client["can_change_status"] = (
        can_change_client_status(current_user) and can_open_details
    )
    client["can_reassign"] = (
        can_reassign_clients(current_user) and can_open_details
    )
    client["can_change_payment_type"] = (
        can_manage_client_payment_type(current_user) and can_open_details
    )
    client["can_view_monitoring_password"] = (
        can_view_client_monitoring_password(current_user) and can_open_details
    )

    client["can_view_installation_settings"] = (
        can_view_client_installation_settings(current_user) and can_open_details
    )
    client["can_manage_installation_settings"] = (
        can_manage_client_installation_settings(client, current_user) and can_open_details
    )
    client["can_view_history"] = can_view_client_history(current_user) and can_open_details

    client["can_create_request"] = can_create_request_for_client(client, current_user)
    client["can_edit_vehicles"] = can_edit_vehicle_for_client(client, current_user)

    # Заблокированный родитель блокирует всю ветку: создавать заявки
    # и добавлять машины подклиенту нельзя, пока родитель заблокирован.
    if client.get("is_blocked_by_parent"):
        client["can_create_request"] = False
        client["can_edit_vehicles"] = False

    return client

def attach_clients_permissions(clients: list[dict], current_user: dict) -> list[dict]:
    for client in clients:
        attach_client_permissions(client, current_user)

        for child in client.get("children") or []:
            attach_client_tree_permissions(child, current_user)

    return clients

def attach_client_tree_permissions(client: dict, current_user: dict):
    attach_client_permissions(client, current_user)

    for child in client.get("children") or []:
        attach_client_tree_permissions(child, current_user)

    return client

def is_technical_root_parent(value: str | None) -> bool:
    normalized = normalize_text(value)
    return normalized in TECHNICAL_ROOT_PARENT_NAMES

def get_source_name(client: dict) -> str:
    return (
        client.get("source_client_name")
        or client.get("company_name")
        or client.get("name")
        or f"ID {client.get('id')}"
    )

def get_parent_source_name(client: dict) -> str | None:
    """
    Имя родителя из выгрузки ГЛОНАСС Софт.

    После этапа 2 используется только там, где настоящей ссылки
    parent_client_id ещё нет: имя группы для «осиротевших» клиентов
    и восстановление связи из корзины.
    """
    parent = client.get("source_parent_client_name")
    if not parent:
        return None

    if is_technical_root_parent(parent):
        return None

    source_name = get_source_name(client)

    if normalize_text(parent) == normalize_text(source_name):
        return None

    return parent

def get_parent_client_id(client: dict) -> int | None:
    parent_client_id = client.get("parent_client_id")

    if parent_client_id in (None, "", 0):
        return None

    return int(parent_client_id)

def resolve_parent_client_id_by_name(cursor, client: dict) -> int | None:
    """
    Разовый поиск родителя по строковому имени из выгрузки.

    Используется только при восстановлении клиента из корзины,
    когда ссылка parent_client_id пустая.
    """
    parent_name = get_parent_source_name(client)

    if not parent_name:
        return None

    cursor.execute(
        """
        SELECT id
        FROM clients
        WHERE is_deleted = 0
          AND LOWER(TRIM(COALESCE(
                NULLIF(source_client_name, ''),
                NULLIF(company_name, ''),
                NULLIF(name, '')
              ))) = %s
        ORDER BY id ASC
        LIMIT 1
        """,
        (normalize_text(parent_name),),
    )

    row = cursor.fetchone()

    if not row:
        return None

    if int(row["id"]) == int(client["id"]):
        return None

    return int(row["id"])

def find_parent_client_id(cursor, client: dict) -> int | None:
    """
    Настоящая ссылка на родителя. Если её нет — разовый поиск по имени.
    """
    parent_client_id = get_parent_client_id(client)

    if parent_client_id:
        return parent_client_id

    return resolve_parent_client_id_by_name(cursor, client)

def get_client_ancestors(
    cursor,
    client_id: int,
    include_deleted: bool = False,
) -> list[dict]:
    """
    Цепочка родителей снизу вверх: ближайший родитель первым.

    По умолчанию удалённые клиенты в цепочку не попадают: ветка на них
    обрывается. include_deleted=True нужен только для проверки колец,
    когда сам клиент лежит в корзине.
    """
    deleted_condition = "" if include_deleted else "p.is_deleted = 0 AND"

    cursor.execute(
        f"""
        WITH RECURSIVE client_chain AS (
            SELECT
                c.id,
                c.parent_client_id,
                c.name,
                c.company_name,
                c.source_client_name,
                c.status,
                c.is_deleted,
                0 AS depth
            FROM clients c
            WHERE c.id = %s

            UNION ALL

            SELECT
                p.id,
                p.parent_client_id,
                p.name,
                p.company_name,
                p.source_client_name,
                p.status,
                p.is_deleted,
                chain.depth + 1
            FROM clients p
            INNER JOIN client_chain chain
                ON p.id = chain.parent_client_id
            WHERE {deleted_condition} chain.depth < %s
        )
        SELECT
            id,
            parent_client_id,
            name,
            company_name,
            source_client_name,
            status,
            depth
        FROM client_chain
        WHERE depth > 0
        ORDER BY depth ASC
        """,
        (client_id, CLIENT_TREE_MAX_DEPTH),
    )

    return cursor.fetchall() or []

def get_client_descendant_ids(cursor, client_id: int) -> list[int]:
    """
    ID всех подклиентов ветки, без самого клиента.
    """
    cursor.execute(
        """
        WITH RECURSIVE client_tree AS (
            SELECT
                c.id,
                0 AS depth
            FROM clients c
            WHERE c.id = %s
              AND c.is_deleted = 0

            UNION ALL

            SELECT
                child.id,
                tree.depth + 1
            FROM clients child
            INNER JOIN client_tree tree
                ON child.parent_client_id = tree.id
            WHERE child.is_deleted = 0
              AND tree.depth < %s
        )
        SELECT id
        FROM client_tree
        WHERE depth > 0
        ORDER BY id ASC
        """,
        (client_id, CLIENT_TREE_MAX_DEPTH),
    )

    rows = cursor.fetchall() or []

    result = []

    for row in rows:
        descendant_id = int(row["id"])

        if descendant_id == int(client_id):
            continue

        if descendant_id not in result:
            result.append(descendant_id)

    return result

def get_subclient_ids_recursive(cursor, root_client_id: int) -> list[int]:
    """
    Совместимость со старым названием: раньше подклиенты искались
    по строковому имени, теперь по parent_client_id.
    """
    return get_client_descendant_ids(cursor, root_client_id)

def resolve_effective_client_block(cursor, client: dict) -> dict:
    """
    Блокировка наследуется вниз. Если заблокирован любой родитель
    по цепочке, вся ветка считается заблокированной.
    """
    own_status = str(client.get("status") or "ACTIVE").strip().upper()

    if own_status == "BLOCKED":
        return {
            "effective_status": "BLOCKED",
            "is_blocked_by_parent": False,
            "blocked_by_client_id": None,
            "blocked_by_client_name": None,
        }

    for ancestor in get_client_ancestors(cursor, int(client["id"])):
        if str(ancestor.get("status") or "").strip().upper() == "BLOCKED":
            return {
                "effective_status": "BLOCKED",
                "is_blocked_by_parent": True,
                "blocked_by_client_id": int(ancestor["id"]),
                "blocked_by_client_name": get_client_display_name(ancestor),
            }

    return {
        "effective_status": own_status,
        "is_blocked_by_parent": False,
        "blocked_by_client_id": None,
        "blocked_by_client_name": None,
    }

def validate_parent_client(
    cursor,
    parent_client_id: int | None,
    client_id: int | None = None,
):
    """
    Проверка родителя перед сохранением: существует, не в корзине,
    не сам клиент и не его потомок.
    """
    if parent_client_id is None:
        return None

    parent_client_id = int(parent_client_id)

    if client_id is not None and parent_client_id == int(client_id):
        raise HTTPException(
            status_code=400,
            detail="Клиент не может быть родителем самому себе",
        )

    cursor.execute(
        """
        SELECT id, name, company_name, is_deleted
        FROM clients
        WHERE id = %s
        LIMIT 1
        """,
        (parent_client_id,),
    )

    parent = cursor.fetchone()

    if not parent:
        raise HTTPException(status_code=404, detail="Родительский клиент не найден")

    if parent["is_deleted"]:
        raise HTTPException(
            status_code=400,
            detail="Нельзя выбрать родителем клиента из корзины",
        )

    if client_id is not None:
        descendant_ids = get_client_descendant_ids(cursor, int(client_id))

        if parent_client_id in descendant_ids:
            raise HTTPException(
                status_code=400,
                detail="Нельзя выбрать родителем собственного подклиента",
            )

    return parent_client_id

def empty_group(group_name: str, is_import_group: bool = True) -> dict:
    return {
        "group_name": group_name,
        "parent_client": None,
        "clients_count": 0,
        "subclients_count": 0,
        "request_count": 0,
        "vehicle_count": 0,
        "is_import_group": is_import_group,
        "clients": [],
    }

def build_client_node(client: dict) -> dict:
    client["children"] = []
    client["children_count"] = 0
    client["own_vehicle_count"] = int(client.get("vehicle_count") or 0)
    client["own_request_count"] = int(client.get("request_count") or 0)
    client["total_vehicle_count"] = int(client.get("vehicle_count") or 0)
    client["total_request_count"] = int(client.get("request_count") or 0)
    return client

def build_client_groups(rows: list[dict]) -> list[dict]:
    """
    Дерево клиентов по настоящей ссылке clients.parent_client_id.

    Группы остаются теми же, что и раньше:
    - клиент верхнего уровня иерархии — отдельная группа со своим деревом;
    - клиент, чей родитель не виден текущему пользователю, попадает
      в группу с именем родителя;
    - клиенты, созданные в CRM без иерархии — общая группа.
    """
    nodes = {}

    for row in rows:
        nodes[int(row["id"])] = build_client_node(row)

    def has_valid_parent_path(start_client_id: int) -> bool:
        """
        Страховка от кольца в данных: если по ссылкам parent_client_id
        путь вверх не заканчивается, ветку не строим, иначе дерево
        станет бесконечным.
        """
        seen = set()
        current_id = int(start_client_id)

        for _ in range(CLIENT_TREE_MAX_DEPTH + 1):
            node = nodes.get(current_id)

            if node is None:
                return True

            parent_id = get_parent_client_id(node)

            if not parent_id or parent_id == current_id:
                return True

            if parent_id in seen:
                return False

            seen.add(current_id)
            current_id = parent_id

        return False

    linked_ids = set()

    for client_id, client in nodes.items():
        parent_client_id = get_parent_client_id(client)

        if not parent_client_id or parent_client_id == client_id:
            continue

        parent_node = nodes.get(parent_client_id)

        if parent_node and has_valid_parent_path(client_id):
            parent_node["children"].append(client)
            linked_ids.add(client_id)

    root_clients = []
    external_groups = {}
    regular_clients = []

    for client_id, client in nodes.items():
        if client_id in linked_ids:
            continue

        parent_client_id = get_parent_client_id(client)

        # Родитель есть, но он не виден текущему пользователю
        # или лежит в корзине — показываем группой по имени родителя.
        if parent_client_id and parent_client_id not in nodes:
            group_name = (
                normalize_optional_str(client.get("source_parent_client_name"))
                or f"Клиент #{parent_client_id}"
            )

            if group_name not in external_groups:
                external_groups[group_name] = empty_group(
                    group_name=group_name,
                    is_import_group=True,
                )

            external_groups[group_name]["clients"].append(client)
            continue

        # Ссылки нет, но в выгрузке указан родитель, которого не нашли
        # при миграции. Ведём себя как раньше: отдельная группа по имени.
        legacy_parent_name = None

        if not parent_client_id:
            legacy_parent_name = get_parent_source_name(client)

        if legacy_parent_name:
            if legacy_parent_name not in external_groups:
                external_groups[legacy_parent_name] = empty_group(
                    group_name=legacy_parent_name,
                    is_import_group=True,
                )

            external_groups[legacy_parent_name]["clients"].append(client)
            continue

        is_hierarchy_client = bool(
            client.get("children")
            or client.get("source_client_name")
            or client.get("source_parent_client_name")
        )

        if is_hierarchy_client:
            root_clients.append(client)
        else:
            regular_clients.append(client)

    groups = []

    # Root-клиенты иерархии как отдельные верхнеуровневые группы
    for client in root_clients:
        group = empty_group(
            group_name=get_source_name(client),
            is_import_group=client.get("source_system") == "GLONASS_SOFT",
        )

        group["parent_client"] = client
        group["clients"] = client.get("children") or []

        groups.append(group)

    # Группы, где родитель известен только по имени
    for group in external_groups.values():
        groups.append(group)

    # Обычные CRM-клиенты отдельной группой
    if regular_clients:
        regular_group = empty_group(
            group_name=CRM_GROUP_NAME,
            is_import_group=False,
        )

        regular_group["clients"] = regular_clients
        groups.append(regular_group)

    groups.sort(
        key=lambda group: (
            group["group_name"] == CRM_GROUP_NAME,
            group["group_name"].lower(),
        )
    )

    return groups

def recalc_client_totals(
    client: dict,
    visited: set[int] | None = None
) -> tuple[int, int, int]:
    if visited is None:
        visited = set()

    client_id = int(client.get("id") or 0)

    if client_id in visited:
        return 0, 0, 0

    visited.add(client_id)

    children = client.get("children") or []

    children_count = len(children)
    total_vehicle_count = int(client.get("vehicle_count") or 0)
    total_request_count = int(client.get("request_count") or 0)

    for child in children:
        child_children_count, child_vehicle_count, child_request_count = recalc_client_totals(
            child,
            visited,
        )
        children_count += child_children_count
        total_vehicle_count += child_vehicle_count
        total_request_count += child_request_count

    client["children_count"] = children_count
    client["own_vehicle_count"] = int(client.get("vehicle_count") or 0)
    client["own_request_count"] = int(client.get("request_count") or 0)
    client["total_vehicle_count"] = total_vehicle_count
    client["total_request_count"] = total_request_count

    return children_count, total_vehicle_count, total_request_count

def apply_effective_client_status(
    client: dict,
    blocked_by_client_id: int | None = None,
    blocked_by_client_name: str | None = None,
    visited: set[int] | None = None,
):
    """
    Блокировка родителя распространяется на всё дерево вниз.
    Собственный статус клиента при этом не меняется.
    """
    if visited is None:
        visited = set()

    client_id = int(client.get("id") or 0)

    if client_id in visited:
        return

    visited.add(client_id)

    own_status = str(client.get("status") or "ACTIVE").strip().upper()

    if blocked_by_client_name:
        client["effective_status"] = "BLOCKED"
        client["is_blocked_by_parent"] = True
        client["blocked_by_client_id"] = blocked_by_client_id
        client["blocked_by_client_name"] = blocked_by_client_name
    else:
        client["effective_status"] = own_status
        client["is_blocked_by_parent"] = False
        client["blocked_by_client_id"] = None
        client["blocked_by_client_name"] = None

    next_blocked_by_client_id = blocked_by_client_id
    next_blocked_by_client_name = blocked_by_client_name

    if not next_blocked_by_client_name and own_status == "BLOCKED":
        next_blocked_by_client_id = client_id
        next_blocked_by_client_name = get_client_display_name(client)

    for child in client.get("children") or []:
        apply_effective_client_status(
            child,
            next_blocked_by_client_id,
            next_blocked_by_client_name,
            visited,
        )

def normalize_phone(value: str | None) -> str:
    """
    Только цифры.
    Например: +7 777 123 45 67 -> 77771234567
    """
    return "".join(ch for ch in str(value or "") if ch.isdigit())

def get_client_display_name(client: dict) -> str:
    return client.get("company_name") or client.get("name") or f"ID {client.get('id')}"

def find_duplicate_client(
    cursor,
    client_type: str,
    name: str | None,
    company_name: str | None,
    phone: str | None,
    exclude_client_id: int | None = None,
):
    normalized_phone = normalize_phone(phone)

    if not normalized_phone:
        return None

    if client_type == "INDIVIDUAL":
        normalized_name = normalize_text(name)

        if not normalized_name:
            return None

        sql = """
            SELECT id, type, name, company_name, phone, is_deleted,
                   created_by, responsible_manager_id
            FROM clients
            WHERE type = 'INDIVIDUAL'
              AND is_deleted = 0
              AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = %s
              AND LOWER(TRIM(name)) = %s
        """

        params = [normalized_phone, normalized_name]

    else:
        normalized_company_name = normalize_text(company_name)

        if not normalized_company_name:
            return None

        sql = """
            SELECT id, type, name, company_name, phone, is_deleted,
                   created_by, responsible_manager_id
            FROM clients
            WHERE type = %s
              AND is_deleted = 0
              AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = %s
              AND LOWER(TRIM(company_name)) = %s
        """

        params = [client_type, normalized_phone, normalized_company_name]

    if exclude_client_id:
        sql += " AND id != %s"
        params.append(exclude_client_id)

    sql += " LIMIT 1"

    cursor.execute(sql, tuple(params))
    return cursor.fetchone()

def raise_duplicate_client_error(duplicate: dict, current_user: dict | None = None):
    """
    Если дубль — чужой клиент, названия и телефона в ответе быть не должно:
    перебором номеров иначе выясняется, кто у нас обслуживается.
    """
    if current_user is not None and not can_open_client_details_for_router(
        duplicate, current_user
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Клиент с такими данными уже существует в системе. "
                "Обратитесь к вашему менеджеру."
            ),
        )

    client_name = get_client_display_name(duplicate)

    raise HTTPException(
        status_code=409,
        detail=(
            f"Клиент уже существует: {client_name}, телефон: {duplicate.get('phone')}. "
            "Выберите существующего клиента из списка, а не создавайте нового."
        )
    )

def attach_vehicles_to_requests(cursor, requests: list[dict]) -> list[dict]:
    """
    Добавляет к каждой заявке массив vehicles[] из request_vehicles.
    """
    if not requests:
        return requests

    request_ids = [r["id"] for r in requests]
    placeholders = ", ".join(["%s"] * len(request_ids))

    cursor.execute(
        f"""
        SELECT
            rv.id AS request_vehicle_id,
            rv.request_id,
            rv.vehicle_id,
            rv.has_beacon,
            rv.has_blocking,

            v.brand,
            v.model,
            v.plate_number,
            v.vin,
            v.year,
            v.type AS vehicle_type
        FROM request_vehicles rv
        LEFT JOIN vehicles v ON rv.vehicle_id = v.id
        WHERE rv.request_id IN ({placeholders})
        ORDER BY rv.id ASC
        """,
        tuple(request_ids)
    )

    rows = cursor.fetchall()

    grouped = {}

    for row in rows:
        row["has_beacon"] = bool(row["has_beacon"])
        row["has_blocking"] = bool(row["has_blocking"])

        grouped.setdefault(row["request_id"], []).append(row)

    for req in requests:
        vehicles = grouped.get(req["id"], [])

        req["vehicles"] = vehicles
        req["vehicles_count"] = len(vehicles)

        if vehicles:
            req["vehicles_summary"] = ", ".join(
                f"{v.get('brand') or ''} {v.get('model') or ''}".strip()
                for v in vehicles
            )
        else:
            req["vehicles_summary"] = ""

    return requests

def attach_executors_to_client_requests(cursor, requests: list[dict]) -> list[dict]:
    if not requests:
        return requests

    request_ids = [r["id"] for r in requests]
    placeholders = ", ".join(["%s"] * len(request_ids))

    cursor.execute(
        f"""
        SELECT
            re.id,
            re.request_id,
            re.user_id,
            re.assigned_by,
            re.assigned_at,

            u.name AS user_name,
            u.email AS user_email,
            u.role AS user_role,
            u.city AS user_city,

            assigned_by_user.name AS assigned_by_name
        FROM request_executors re
        LEFT JOIN users u ON re.user_id = u.id
        LEFT JOIN users assigned_by_user ON re.assigned_by = assigned_by_user.id
        WHERE re.request_id IN ({placeholders})
        ORDER BY re.id ASC
        """,
        tuple(request_ids)
    )

    rows = cursor.fetchall()
    grouped = {}

    for row in rows:
        grouped.setdefault(row["request_id"], []).append(row)

    for request in requests:
        executors = grouped.get(request["id"], [])
        request["executors"] = executors
        request["executors_count"] = len(executors)
        request["executors_summary"] = ", ".join(
            executor.get("user_name") or f"ID {executor.get('user_id')}"
            for executor in executors
        )

    return requests

def load_client_for_settings(
    cursor,
    client_id: int,
    allow_deleted: bool = False,
) -> dict:
    cursor.execute(
        """
        SELECT
            id,
            name,
            company_name,
            status,
            parent_client_id,
            source_client_name,
            source_parent_client_name,
            created_by,
            responsible_manager_id,
            is_deleted
        FROM clients
        WHERE id = %s
        LIMIT 1
        """,
        (client_id,),
    )

    client = cursor.fetchone()

    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    if client["is_deleted"] and not allow_deleted:
        raise HTTPException(status_code=400, detail="Клиент находится в корзине")

    return client


def load_client_installation_settings_row(cursor, client_id: int) -> dict | None:
    cursor.execute(
        """
        SELECT
            id,
            client_id,
            visit_type,
            visit_price_code,
            platform,
            gps_price_code,
            tracker_subscription_months,
            has_blocking,
            has_beacon,
            beacon_subscription_months,
            vin_required,
            schedule_time_required,
            created_at,
            updated_at
        FROM client_installation_settings
        WHERE client_id = %s
        LIMIT 1
        """,
        (client_id,),
    )

    return cursor.fetchone()


def load_client_installation_sensors(cursor, settings_id: int) -> list[dict]:
    cursor.execute(
        """
        SELECT id, name, price, sort_order
        FROM client_installation_sensors
        WHERE settings_id = %s
        ORDER BY sort_order ASC, id ASC
        """,
        (settings_id,),
    )

    rows = cursor.fetchall()

    for row in rows:
        row["price"] = float(row["price"] or 0)

    return rows


def build_installation_settings_payload(
    cursor,
    row: dict,
    source: str,
    owner_client: dict | None,
) -> dict:
    is_inherited = source == "INHERITED"

    return {
        "source": source,
        "is_configured": True,
        "settings": {
            "visit_type": row.get("visit_type"),
            "visit_price_code": row.get("visit_price_code"),
            "platform": row.get("platform"),
            "gps_price_code": row.get("gps_price_code"),
            "tracker_subscription_months": int(row.get("tracker_subscription_months") or 0),
            "has_blocking": bool(row.get("has_blocking")),
            "has_beacon": bool(row.get("has_beacon")),
            "beacon_subscription_months": int(row.get("beacon_subscription_months") or 0),

            # Отсутствие значения читаем как «обязателен»: настройка
            # может только ослабить требование, и только осознанно.
            "vin_required": bool(row.get("vin_required", 1)),

            # Снятая галочка не отменяет время, а перестаёт спрашивать его
            # у клиента: при создании заявки подставится ближайший рабочий
            # слот. Календарь и сортировка продолжают работать.
            "schedule_time_required": bool(row.get("schedule_time_required", 1)),

            "updated_at": row.get("updated_at") or row.get("created_at"),
        },
        "sensors": load_client_installation_sensors(cursor, int(row["id"])),
        "inherited_from_client_id": (
            int(owner_client["id"]) if is_inherited and owner_client else None
        ),
        "inherited_from_client_name": (
            get_client_display_name(owner_client) if is_inherited and owner_client else None
        ),
    }


def resolve_client_installation_settings(cursor, client: dict) -> dict:
    """
    Свои параметры клиента, а если их нет — родительские.

    source: OWN — заданы у этого клиента, INHERITED — взяты у родителя,
    NONE — не настроены нигде по цепочке.

    Цепочка родителей строится по clients.parent_client_id.
    """
    own_row = load_client_installation_settings_row(cursor, int(client["id"]))

    if own_row:
        return build_installation_settings_payload(cursor, own_row, "OWN", client)

    for parent_client in get_client_ancestors(cursor, int(client["id"])):
        parent_row = load_client_installation_settings_row(
            cursor, int(parent_client["id"])
        )

        if parent_row:
            return build_installation_settings_payload(
                cursor, parent_row, "INHERITED", parent_client
            )

    return {
        "source": "NONE",
        "is_configured": False,
        "settings": None,
        "sensors": [],
        "inherited_from_client_id": None,
        "inherited_from_client_name": None,
    }


def describe_installation_settings(payload: dict) -> str:
    """Одна строка для журнала изменений — читаемая человеком."""
    if not payload or not payload.get("is_configured"):
        return "не настроены"

    settings = payload.get("settings") or {}
    parts = []

    if settings.get("visit_type"):
        parts.append(
            "в офисе" if settings["visit_type"] == "IN_OFFICE" else "выезд к клиенту"
        )

    if settings.get("visit_price_code"):
        parts.append(f"тип выезда {settings['visit_price_code']}")

    if settings.get("platform"):
        parts.append(f"платформа {settings['platform']}")

    if settings.get("gps_price_code"):
        parts.append(f"трекер {settings['gps_price_code']}")
        parts.append(
            f"подписка трекера {settings.get('tracker_subscription_months') or 0} мес."
        )
        parts.append("с блокировкой" if settings.get("has_blocking") else "без блокировки")
    else:
        parts.append("без трекера")

    if settings.get("has_beacon"):
        parts.append(f"маяк, подписка {settings.get('beacon_subscription_months') or 0} мес.")
    else:
        parts.append("без маяка")

    sensors = payload.get("sensors") or []

    if sensors:
        parts.append(
            "датчики: "
            + ", ".join(f"{s['name']} — {s['price']:.0f} тг" for s in sensors)
        )
    else:
        parts.append("без датчиков")

    parts.append(
        "VIN обязателен"
        if settings.get("vin_required", True)
        else "VIN необязателен при создании заявки"
    )

    parts.append(
        "клиент выбирает время работ"
        if settings.get("schedule_time_required", True)
        else "время работ подставляется автоматически"
    )

    if payload.get("source") == "INHERITED":
        parts.append(f"унаследовано от «{payload.get('inherited_from_client_name')}»")

    return "; ".join(parts)


def ensure_price_code_active(cursor, code: str | None, field_label: str) -> str | None:
    if not code:
        return None

    normalized = str(code).strip().upper()

    if not normalized:
        return None

    cursor.execute(
        "SELECT code FROM price_items WHERE code = %s AND is_active = 1 LIMIT 1",
        (normalized,),
    )

    if not cursor.fetchone():
        raise HTTPException(
            status_code=400,
            detail=f"{field_label}: позиция прайса «{normalized}» не найдена или отключена",
        )

    return normalized


@router.get("")
def get_clients(current_user: dict = Depends(get_current_user)):
    ensure_can_view_clients(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            conditions = ["c.is_deleted = 0"]
            values = []

            apply_client_access_scope_condition(
                conditions=conditions,
                values=values,
                current_user=current_user,
                table_alias="c",
            )

            where_clause = " AND ".join(conditions)
            sql = f"""
            SELECT
                c.id,
                c.type,
                c.bin_iin,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.monitoring_login,
                c.status,
                c.payment_type,
                c.source_system,
                c.source_client_name,
                c.source_parent_client_name,
                c.source_inn,
                c.created_at,
                c.created_by,
                c.responsible_manager_id,
                c.parent_client_id,
                c.status_changed_at,
                c.status_changed_by,
                c.responsible_changed_at,
                c.responsible_changed_by,
                c.is_deleted,
                c.deleted_at,
                c.deleted_by,

                creator.name AS created_by_name,
                responsible.name AS responsible_manager_name,
                status_user.name AS status_changed_by_name,
                responsible_user.name AS responsible_changed_by_name,

                parent_client.name AS parent_client_name,
                parent_client.company_name AS parent_client_company_name,

                COUNT(r.id) AS request_count
            FROM clients c
            LEFT JOIN users creator ON c.created_by = creator.id
            LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
            LEFT JOIN users status_user ON c.status_changed_by = status_user.id
            LEFT JOIN users responsible_user ON c.responsible_changed_by = responsible_user.id
            LEFT JOIN clients parent_client ON parent_client.id = c.parent_client_id
            LEFT JOIN requests r
                ON c.id = r.client_id
                AND r.is_deleted = 0
            WHERE {where_clause}
            GROUP BY
                c.id,
                c.type,
                c.bin_iin,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.monitoring_login,
                c.status,
                c.payment_type,
                c.source_system,
                c.source_client_name,
                c.source_parent_client_name,
                c.source_inn,
                c.created_at,
                c.created_by,
                c.responsible_manager_id,
                c.parent_client_id,
                c.status_changed_at,
                c.status_changed_by,
                c.responsible_changed_at,
                c.responsible_changed_by,
                c.is_deleted,
                c.deleted_at,
                c.deleted_by,
                creator.name,
                responsible.name,
                status_user.name,
                responsible_user.name,
                parent_client.name,
                parent_client.company_name
            ORDER BY c.created_at DESC
            """
            cursor.execute(sql, tuple(values))
            clients = cursor.fetchall()

            for client in clients:
                attach_client_permissions(client, current_user)

            return clients
    finally:
        connection.close()

@router.post("")
def create_client(data: ClientCreate, current_user: dict = Depends(get_current_user)):
    if not can_create_client(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания клиента"
        )

    if (
        normalize_optional_str(getattr(data, "monitoring_password", None))
        and not can_manage_client_monitoring_password(current_user)
    ):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для указания пароля платформы мониторинга"
        )

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            duplicate = find_duplicate_client(
                cursor=cursor,
                client_type=data.type,
                name=data.name,
                company_name=data.company_name,
                phone=data.phone,
            )

            if duplicate:
                raise_duplicate_client_error(duplicate, current_user)

            client_status = get_client_status(getattr(data, "status", None))

            client_payment_type = CLIENT_PAYMENT_PREPAYMENT

            if can_manage_client_payment_type(current_user):
                client_payment_type = get_client_payment_type(
                    getattr(data, "payment_type", None)
                )

            # Обычные роли при создании не должны создавать сразу BLOCKED/DEBTOR.
            # Статус меняется отдельным endpoint'ом бухгалтером/РОП/админом.
            if client_status != "ACTIVE" and not can_change_client_status(current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для создания клиента с этим статусом"
                )

            responsible_manager_id = get_default_responsible_manager_id(data, current_user)
            ensure_responsible_user_allowed(cursor, responsible_manager_id)

            client_bin_iin = validate_client_bin_iin(data.type, getattr(data, "bin_iin", None))

            # Настоящая ссылка на родителя. Строковое имя из выгрузки
            # остаётся только как справочное поле.
            parent_client_id = validate_parent_client(
                cursor,
                getattr(data, "parent_client_id", None),
            )

            parent_client = None

            if parent_client_id:
                parent_client = load_client_for_settings(cursor, parent_client_id)

                ensure_client_visible_by_scope(parent_client, current_user)

                if not can_open_client_details_for_router(parent_client, current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для создания подклиента этому клиенту",
                    )

            source_parent_client_name = getattr(data, "source_parent_client_name", None)

            if parent_client and not normalize_optional_str(source_parent_client_name):
                source_parent_client_name = get_source_name(parent_client)

            sql = """
                INSERT INTO clients (
                    type,
                    bin_iin,
                    name,
                    company_name,
                    phone,
                    email,
                    monitoring_login,
                    monitoring_password,
                    status,
                    payment_type,
                    source_system,
                    source_client_name,
                    source_parent_client_name,
                    source_inn,
                    created_by,
                    responsible_manager_id,
                    parent_client_id,
                    responsible_changed_at,
                    responsible_changed_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
            """

            cursor.execute(
                sql,
                (
                    (
                        data.type,
                        client_bin_iin,
                        data.name,
                        data.company_name,
                        data.phone,
                        data.email,
                        normalize_optional_str(getattr(data, "monitoring_login", None)),
                        normalize_optional_str(getattr(data, "monitoring_password", None)),
                        client_status,
                        client_payment_type,
                        getattr(data, "source_system", None),
                        getattr(data, "source_client_name", None),
                        source_parent_client_name,
                        getattr(data, "source_inn", None),
                        current_user["id"],
                        responsible_manager_id,
                        parent_client_id,
                        current_user["id"] if responsible_manager_id else None,
                    )
                )
            )

            new_id = cursor.lastrowid

            add_client_history(
                cursor,
                client_id=new_id,
                user_id=current_user["id"],
                action="CLIENT_CREATED",
                new_value=data.company_name or data.name,
            )

            if parent_client_id:
                add_client_history(
                    cursor,
                    client_id=new_id,
                    user_id=current_user["id"],
                    action="PARENT_CHANGED",
                    field_name="parent_client_id",
                    old_value=None,
                    new_value=parent_client_id,
                    comment=(
                        f"Родитель: {get_client_display_name(parent_client)}"
                        if parent_client
                        else None
                    ),
                )

            connection.commit()

            return {
                "id": new_id,
                "message": "client created",
                "parent_client_id": parent_client_id,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_clients(current_user: dict = Depends(get_current_user)):
    """Список удалённых клиентов."""
    if not can_view_deleted_clients(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для просмотра корзины клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            conditions = ["c.is_deleted = 1"]
            values = []

            apply_client_access_scope_condition(
                conditions=conditions,
                values=values,
                current_user=current_user,
                table_alias="c",
            )

            where_clause = " AND ".join(conditions)
            sql = f"""
            SELECT
                c.id,
                c.type,
                c.bin_iin,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.monitoring_login,
                c.status,
                c.payment_type,
                c.source_system,
                c.source_client_name,
                c.source_parent_client_name,
                c.source_inn,
                c.created_at,
                c.created_by,
                c.responsible_manager_id,
                c.parent_client_id,
                c.deleted_at,
                c.deleted_by,

                u.name AS deleted_by_name,
                creator.name AS created_by_name,
                responsible.name AS responsible_manager_name,

                COUNT(r.id) AS request_count
            FROM clients c
            LEFT JOIN users u ON c.deleted_by = u.id
            LEFT JOIN users creator ON c.created_by = creator.id
            LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
            LEFT JOIN requests r ON c.id = r.client_id
            WHERE {where_clause}
            GROUP BY
                c.id,
                c.type,
                c.bin_iin,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.monitoring_login,
                c.status,
                c.payment_type,
                c.source_system,
                c.source_client_name,
                c.source_parent_client_name,
                c.source_inn,
                c.created_at,
                c.created_by,
                c.responsible_manager_id,
                c.parent_client_id,
                c.deleted_at,
                c.deleted_by,
                u.name,
                creator.name,
                responsible.name
            ORDER BY c.deleted_at DESC
            """
            cursor.execute(sql, tuple(values))
            return cursor.fetchall()
    finally:
        connection.close()

def collect_client_ids_from_group(group: dict) -> list[int]:
    ids = []

    def walk(client: dict | None):
        if not client:
            return

        client_id = client.get("id")
        if client_id:
            ids.append(int(client_id))

        for child in client.get("children") or []:
            walk(child)

    walk(group.get("parent_client"))

    for client in group.get("clients") or []:
        walk(client)

    return ids

def apply_counts_to_group(group: dict, request_counts: dict[int, int], vehicle_counts: dict[int, int]):
    def walk(client: dict | None):
        if not client:
            return

        client_id = int(client.get("id") or 0)

        client["request_count"] = int(request_counts.get(client_id, 0))
        client["vehicle_count"] = int(vehicle_counts.get(client_id, 0))
        client["own_request_count"] = int(client["request_count"])
        client["own_vehicle_count"] = int(client["vehicle_count"])
        client["total_request_count"] = int(client["request_count"])
        client["total_vehicle_count"] = int(client["vehicle_count"])

        for child in client.get("children") or []:
            walk(child)

    walk(group.get("parent_client"))

    for client in group.get("clients") or []:
        walk(client)

def build_clients_grouped_rows(cursor, current_user: dict) -> list[dict]:
    conditions = ["c.is_deleted = 0"]
    values = []

    apply_client_access_scope_condition(
        conditions=conditions,
        values=values,
        current_user=current_user,
        table_alias="c",
    )

    where_clause = " AND ".join(conditions)

    # Важно: здесь НЕ джойним requests/vehicles.
    # Иначе снова будет тяжёлая загрузка всей базы.
    cursor.execute(
        f"""
        SELECT
            c.id,
            c.type,
            c.bin_iin,
            c.name,
            c.company_name,
            c.phone,
            c.email,
            c.monitoring_login,
            c.status,
            c.payment_type,
            c.source_system,
            c.source_client_name,
            c.source_parent_client_name,
            c.source_inn,
            c.created_at,
            c.created_by,
            c.responsible_manager_id,
            c.parent_client_id,
            c.status_changed_at,
            c.status_changed_by,
            c.responsible_changed_at,
            c.responsible_changed_by,
            c.is_deleted,
            c.deleted_at,
            c.deleted_by,

            creator.name AS created_by_name,
            responsible.name AS responsible_manager_name,
            status_user.name AS status_changed_by_name,
            responsible_user.name AS responsible_changed_by_name,

            0 AS request_count,
            0 AS vehicle_count

        FROM clients c

        LEFT JOIN users creator ON c.created_by = creator.id
        LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
        LEFT JOIN users status_user ON c.status_changed_by = status_user.id
        LEFT JOIN users responsible_user ON c.responsible_changed_by = responsible_user.id

        WHERE {where_clause}

        ORDER BY
            c.company_name ASC,
            c.name ASC,
            c.id ASC
        """,
        tuple(values),
    )

    return cursor.fetchall()

@router.get("/grouped")
def get_clients_grouped(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    ensure_can_view_clients(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            rows = build_clients_grouped_rows(cursor, current_user)
            groups = build_client_groups(rows)

            total_groups = len(groups)
            offset = (page - 1) * page_size
            paged_groups = groups[offset:offset + page_size]

            # Собираем ID клиентов только из текущей страницы групп
            paged_client_ids = []

            for group in paged_groups:
                paged_client_ids.extend(collect_client_ids_from_group(group))

            paged_client_ids = sorted(set(paged_client_ids))

            request_counts = {}
            vehicle_counts = {}

            if paged_client_ids:
                placeholders = ", ".join(["%s"] * len(paged_client_ids))

                cursor.execute(
                    f"""
                    SELECT client_id, COUNT(*) AS count
                    FROM requests
                    WHERE is_deleted = 0
                      AND client_id IN ({placeholders})
                    GROUP BY client_id
                    """,
                    tuple(paged_client_ids),
                )

                for row in cursor.fetchall():
                    request_counts[int(row["client_id"])] = int(row["count"] or 0)

                cursor.execute(
                    f"""
                    SELECT client_id, COUNT(*) AS count
                    FROM vehicles
                    WHERE is_deleted = 0
                      AND client_id IN ({placeholders})
                    GROUP BY client_id
                    """,
                    tuple(paged_client_ids),
                )

                for row in cursor.fetchall():
                    vehicle_counts[int(row["client_id"])] = int(row["count"] or 0)

            # Проставляем counts, пересчитываем totals и права только для текущей страницы
            for group in paged_groups:
                apply_counts_to_group(group, request_counts, vehicle_counts)

                if group.get("parent_client"):
                    parent_client = group["parent_client"]

                    recalc_client_totals(parent_client)
                    apply_effective_client_status(parent_client)

                    group["clients"] = parent_client.get("children") or []
                    group["clients_count"] = 1 + int(parent_client.get("children_count") or 0)
                    group["subclients_count"] = int(parent_client.get("children_count") or 0)
                    group["request_count"] = int(parent_client.get("total_request_count") or 0)
                    group["vehicle_count"] = int(parent_client.get("total_vehicle_count") or 0)

                    attach_client_tree_permissions(parent_client, current_user)

                    for client in group.get("clients") or []:
                        attach_client_tree_permissions(client, current_user)

                    continue

                total_clients = 0
                total_requests = 0
                total_vehicles = 0

                for client in group.get("clients") or []:
                    recalc_client_totals(client)
                    apply_effective_client_status(client)

                    total_clients += 1 + int(client.get("children_count") or 0)
                    total_requests += int(client.get("total_request_count") or 0)
                    total_vehicles += int(client.get("total_vehicle_count") or 0)

                    attach_client_tree_permissions(client, current_user)

                group["clients_count"] = total_clients
                group["subclients_count"] = total_clients
                group["request_count"] = total_requests
                group["vehicle_count"] = total_vehicles

            return {
                "items": paged_groups,
                "total": total_groups,
                "page": page,
                "page_size": page_size,
            }

    finally:
        connection.close()

@router.get("/{client_id}/grouped-position")
def get_client_grouped_position(
    client_id: int,
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    ensure_can_view_clients(current_user)

    """
    Возвращает, на какой странице /clients/grouped находится клиент,
    в какой группе он лежит и каких родителей нужно раскрыть.
    """
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            rows = build_clients_grouped_rows(cursor, current_user)
            groups = build_client_groups(rows)

            def find_in_tree(clients_list, target_id, ancestors=None):
                if ancestors is None:
                    ancestors = []

                for client in clients_list or []:
                    current_id = int(client.get("id") or 0)

                    if current_id == int(target_id):
                        return {
                            "client": client,
                            "ancestor_ids": ancestors,
                        }

                    result = find_in_tree(
                        client.get("children") or [],
                        target_id,
                        ancestors + [current_id],
                    )

                    if result:
                        return result

                return None

            for group_index, group in enumerate(groups):
                parent_client = group.get("parent_client")

                if parent_client and int(parent_client.get("id") or 0) == int(client_id):
                    return {
                        "client_id": client_id,
                        "page": (group_index // page_size) + 1,
                        "page_size": page_size,
                        "group_index": group_index,
                        "group_name": group["group_name"],
                        "is_parent_client": True,
                        "ancestor_ids": [],
                    }

                if parent_client:
                    result = find_in_tree(
                        parent_client.get("children") or [],
                        client_id,
                    )
                else:
                    result = find_in_tree(group.get("clients") or [], client_id)

                if result:
                    return {
                        "client_id": client_id,
                        "page": (group_index // page_size) + 1,
                        "page_size": page_size,
                        "group_index": group_index,
                        "group_name": group["group_name"],
                        "is_parent_client": False,
                        "ancestor_ids": result["ancestor_ids"],
                    }

            raise HTTPException(status_code=404, detail="Клиент не найден в списке")

    finally:
        connection.close()

@router.get("/{client_id}")
def get_client_by_id(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    ensure_can_view_clients(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            conditions = [
                "c.id = %s",
                "c.is_deleted = 0",
            ]
            values = [client_id]

            apply_client_access_scope_condition(
                conditions=conditions,
                values=values,
                current_user=current_user,
                table_alias="c",
            )

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.type,
                    c.bin_iin,
                    c.name,
                    c.company_name,
                    c.phone,
                    c.email,
                    c.monitoring_login,
                    c.monitoring_password,
                    c.status,
                    c.payment_type,
                    c.source_system,
                    c.source_client_name,
                    c.source_parent_client_name,
                    c.source_inn,
                    c.created_at,
                    c.created_by,
                    c.responsible_manager_id,
                    c.parent_client_id,
                    c.status_changed_at,
                    c.status_changed_by,
                    c.responsible_changed_at,
                    c.responsible_changed_by,
                    c.is_deleted,
                    c.deleted_at,
                    c.deleted_by,

                    creator.name AS created_by_name,
                    responsible.name AS responsible_manager_name,
                    status_user.name AS status_changed_by_name,
                    responsible_user.name AS responsible_changed_by_name,

                    parent_client.name AS parent_client_name,
                    parent_client.company_name AS parent_client_company_name,
                    parent_client.status AS parent_client_status,

                    (
                        SELECT COUNT(*)
                        FROM requests r
                        WHERE r.client_id = c.id
                          AND r.is_deleted = 0
                    ) AS request_count,

                    (
                        SELECT COUNT(*)
                        FROM vehicles v
                        WHERE v.client_id = c.id
                          AND v.is_deleted = 0
                    ) AS vehicle_count

                FROM clients c

                LEFT JOIN users creator ON c.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                LEFT JOIN users status_user ON c.status_changed_by = status_user.id
                LEFT JOIN users responsible_user ON c.responsible_changed_by = responsible_user.id
                LEFT JOIN clients parent_client ON parent_client.id = c.parent_client_id

                WHERE {where_clause}

                LIMIT 1
                """,
                tuple(values),
            )

            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            block_state = resolve_effective_client_block(cursor, client)
            client.update(block_state)

            attach_client_permissions(client, current_user)

            if not can_open_client_details_for_router(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра этого клиента"
                )

            if not can_view_client_monitoring_password(current_user):
                client["monitoring_password"] = None

            own_request_count = int(client.get("request_count") or 0)
            own_vehicle_count = int(client.get("vehicle_count") or 0)

            descendant_ids = get_client_descendant_ids(cursor, client_id)

            total_request_count = own_request_count
            total_vehicle_count = own_vehicle_count

            if descendant_ids:
                placeholders = ", ".join(["%s"] * len(descendant_ids))

                cursor.execute(
                    f"""
                    SELECT COUNT(*) AS count
                    FROM requests
                    WHERE is_deleted = 0
                      AND client_id IN ({placeholders})
                    """,
                    tuple(descendant_ids),
                )

                row = cursor.fetchone()
                total_request_count += int((row or {}).get("count") or 0)

                cursor.execute(
                    f"""
                    SELECT COUNT(*) AS count
                    FROM vehicles
                    WHERE is_deleted = 0
                      AND client_id IN ({placeholders})
                    """,
                    tuple(descendant_ids),
                )

                row = cursor.fetchone()
                total_vehicle_count += int((row or {}).get("count") or 0)

            client["children"] = []
            client["children_count"] = len(descendant_ids)
            client["subclients_count"] = len(descendant_ids)
            client["subclient_ids"] = descendant_ids

            client["own_request_count"] = own_request_count
            client["own_vehicle_count"] = own_vehicle_count
            client["total_request_count"] = total_request_count
            client["total_vehicle_count"] = total_vehicle_count

            client["parent_client_display_name"] = (
                client.get("parent_client_company_name")
                or client.get("parent_client_name")
            )

            return client

    finally:
        connection.close()

@router.patch("/{client_id}")
def update_client(
    client_id: int,
    data: ClientUpdate,
    current_user: dict = Depends(get_current_user)
):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    created_by,
                    responsible_manager_id,
                    parent_client_id,
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
                raise HTTPException(status_code=400, detail="Нельзя редактировать клиента из корзины")

            ensure_client_visible_by_scope(client, current_user)

            if not can_edit_client(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для редактирования этого клиента"
                )

            update_data = data.dict(exclude_unset=True)

            # Проверять значение нельзя: пустая строка нормализуется в None,
            # и поле молча стиралось у любого, кто может редактировать клиента.
            # Без права поле просто не участвует в обновлении.
            if not can_manage_client_monitoring_password(current_user):
                update_data.pop("monitoring_password", None)

            for forbidden_field in ["status", "responsible_manager_id"]:
                if forbidden_field in update_data:
                    update_data.pop(forbidden_field, None)

            # Родитель меняется отдельно: нужны проверки на кольцо,
            # корзину и доступ к самому родителю.
            parent_change = None

            if "parent_client_id" in update_data:
                new_parent_client_id = update_data.pop("parent_client_id")
                old_parent_client_id = get_parent_client_id(client)

                if new_parent_client_id in (None, "", 0):
                    new_parent_client_id = None
                else:
                    new_parent_client_id = validate_parent_client(
                        cursor,
                        new_parent_client_id,
                        client_id,
                    )

                    new_parent = load_client_for_settings(cursor, new_parent_client_id)

                    ensure_client_visible_by_scope(new_parent, current_user)

                    if not can_open_client_details_for_router(new_parent, current_user):
                        raise HTTPException(
                            status_code=403,
                            detail="Недостаточно прав для привязки к этому родительскому клиенту",
                        )

                if new_parent_client_id != old_parent_client_id:
                    parent_change = (old_parent_client_id, new_parent_client_id)

            if not update_data and parent_change is None:
                return {"message": "Нет данных для обновления"}

            cursor.execute(
                """
                SELECT
                    type,
                    name,
                    company_name,
                    phone,
                    email,
                    bin_iin,
                    monitoring_login,
                    monitoring_password,
                    source_system,
                    source_client_name,
                    source_parent_client_name,
                    source_inn
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            current_client_data = cursor.fetchone()

            next_type = update_data.get("type", current_client_data["type"])
            next_name = update_data.get("name", current_client_data["name"])
            next_company_name = update_data.get(
                "company_name",
                current_client_data["company_name"]
            )
            next_phone = update_data.get("phone", current_client_data["phone"])
            next_bin_iin = update_data.get("bin_iin", current_client_data.get("bin_iin"))
            next_bin_iin = validate_client_bin_iin(next_type, next_bin_iin)

            if "bin_iin" in update_data:
                update_data["bin_iin"] = next_bin_iin

            duplicate = find_duplicate_client(
                cursor=cursor,
                client_type=next_type,
                name=next_name,
                company_name=next_company_name,
                phone=next_phone,
                exclude_client_id=client_id,
            )

            if duplicate:
                raise_duplicate_client_error(duplicate, current_user)

            allowed_fields = [
                "type",
                "name",
                "company_name",
                "phone",
                "email",
                "bin_iin",
                "monitoring_login",
                "monitoring_password",
                "source_system",
                "source_client_name",
                "source_parent_client_name",
                "source_inn",
            ]

            updates = []
            values = []

            for optional_field in ["monitoring_login", "monitoring_password"]:
                if optional_field in update_data:
                    update_data[optional_field] = normalize_optional_str(update_data.get(optional_field))

            changed_fields = []

            for field in allowed_fields:
                if field not in update_data:
                    continue

                old_field_value = current_client_data.get(field)
                new_field_value = update_data[field]

                # Поле прислали, но значение то же — не пишем ни в UPDATE,
                # ни в журнал, иначе история забьётся пустыми записями.
                if str(old_field_value or "") == str(new_field_value or ""):
                    continue

                updates.append(f"{field} = %s")
                values.append(new_field_value)

                if field == "monitoring_password":
                    # Пароль мониторинга в журнал не пишем, только факт замены.
                    changed_fields.append((field, "•••", "•••"))
                else:
                    changed_fields.append((field, old_field_value, new_field_value))

            if parent_change is not None:
                updates.append("parent_client_id = %s")
                values.append(parent_change[1])

            if not updates:
                return {"message": "Нет допустимых полей для обновления"}

            values.append(client_id)

            sql = f"""
            UPDATE clients
            SET {', '.join(updates)}
            WHERE id = %s
            """

            cursor.execute(sql, tuple(values))

            for field, old_field_value, new_field_value in changed_fields:
                add_client_history(
                    cursor,
                    client_id=client_id,
                    user_id=current_user["id"],
                    action="CLIENT_UPDATED",
                    field_name=field,
                    old_value=old_field_value,
                    new_value=new_field_value,
                )

            if parent_change is not None:
                add_client_history(
                    cursor,
                    client_id=client_id,
                    user_id=current_user["id"],
                    action="PARENT_CHANGED",
                    field_name="parent_client_id",
                    old_value=parent_change[0],
                    new_value=parent_change[1],
                )

            connection.commit()

            return {
                "message": "Клиент обновлён",
                "client_id": client_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{client_id}/status")
def update_client_status(
    client_id: int,
    data: ClientStatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    if not can_change_client_status(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для изменения статуса клиента"
        )

    new_status = get_client_status(data.status)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, company_name, status, created_by,
                       responsible_manager_id, parent_client_id, is_deleted
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
                    detail="Нельзя менять статус клиента из корзины"
                )

            ensure_client_visible_by_scope(client, current_user)

            if client["status"] == new_status:
                return {
                    "message": "Статус клиента не изменился",
                    "client_id": client_id,
                    "status": new_status,
                }

            # Разблокировать подклиента, пока заблокирован его родитель,
            # бессмысленно: блокировка наследуется сверху.
            if new_status != "BLOCKED":
                block_state = resolve_effective_client_block(cursor, client)

                if block_state["is_blocked_by_parent"]:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Клиент заблокирован через родителя "
                            f"«{block_state['blocked_by_client_name']}». "
                            "Сначала разблокируйте родительского клиента."
                        ),
                    )

            cursor.execute(
                """
                UPDATE clients
                SET status = %s,
                    status_changed_at = NOW(),
                    status_changed_by = %s
                WHERE id = %s
                """,
                (
                    new_status,
                    current_user["id"],
                    client_id,
                )
            )

            descendant_ids = get_client_descendant_ids(cursor, client_id)

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="STATUS_CHANGED",
                field_name="status",
                old_value=client["status"],
                new_value=new_status,
                comment=(
                    f"Статус наследуется подклиентами: {len(descendant_ids)}"
                    if descendant_ids and new_status == "BLOCKED"
                    else None
                ),
            )

            connection.commit()

            return {
                "message": "Статус клиента обновлён",
                "client_id": client_id,
                "old_status": client["status"],
                "new_status": new_status,
                "affected_subclients_count": (
                    len(descendant_ids) if new_status == "BLOCKED" else 0
                ),
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{client_id}/payment-type")
def update_client_payment_type(
    client_id: int,
    data: ClientPaymentTypeUpdate,
    current_user: dict = Depends(get_current_user)
):
    if not can_manage_client_payment_type(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для изменения типа оплаты клиента"
        )

    payment_type = get_client_payment_type(data.payment_type)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    payment_type,
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
                    detail="Нельзя менять тип оплаты у клиента из корзины"
                )

            ensure_client_visible_by_scope(client, current_user)

            old_payment_type = client.get("payment_type") or CLIENT_PAYMENT_PREPAYMENT

            if old_payment_type == payment_type:
                return {
                    "message": "Тип оплаты клиента не изменился",
                    "client_id": client_id,
                    "payment_type": payment_type,
                }

            cursor.execute(
                """
                UPDATE clients
                SET payment_type = %s
                WHERE id = %s
                """,
                (
                    payment_type,
                    client_id,
                )
            )

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="PAYMENT_TYPE_CHANGED",
                field_name="payment_type",
                old_value=old_payment_type,
                new_value=payment_type,
            )

            connection.commit()

            return {
                "message": "Тип оплаты клиента обновлён",
                "client_id": client_id,
                "old_payment_type": old_payment_type,
                "payment_type": payment_type,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{client_id}/responsible")
def update_client_responsible(
    client_id: int,
    data: ClientResponsibleUpdate,
    current_user: dict = Depends(get_current_user),
):
    if not can_reassign_clients(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для переназначения клиента"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, created_by, responsible_manager_id, is_deleted
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
                    detail="Нельзя менять ответственного у клиента из корзины"
                )

            ensure_client_visible_by_scope(client, current_user)

            ensure_responsible_user_allowed(cursor, data.responsible_manager_id)

            target_ids = [client_id]

            if data.apply_to_subclients:
                target_ids.extend(get_client_descendant_ids(cursor, client_id))

            placeholders = ", ".join(["%s"] * len(target_ids))

            cursor.execute(
                f"""
                UPDATE clients
                SET responsible_manager_id = %s,
                    responsible_changed_at = NOW(),
                    responsible_changed_by = %s
                WHERE id IN ({placeholders})
                """,
                tuple([data.responsible_manager_id, current_user["id"]] + target_ids)
            )

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="RESPONSIBLE_CHANGED",
                field_name="responsible_manager_id",
                old_value=client.get("responsible_manager_id"),
                new_value=data.responsible_manager_id,
                comment=(
                    f"Вместе с подклиентами: {len(target_ids) - 1}"
                    if len(target_ids) > 1
                    else None
                ),
            )

            connection.commit()

            return {
                "message": "Ответственный менеджер обновлён",
                "client_id": client_id,
                "responsible_manager_id": data.responsible_manager_id,
                "updated_clients_count": len(target_ids),
                "updated_client_ids": target_ids,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/{client_id}")
def delete_client(client_id: int, current_user: dict = Depends(get_current_user)):
    """Soft delete клиента."""
    if not can_delete_client(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для удаления клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем, существует ли клиент
            cursor.execute(
                """
                SELECT id, name, created_by, responsible_manager_id, is_deleted
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            if client["is_deleted"]:
                raise HTTPException(status_code=400, detail="Клиент уже удалён")

            ensure_client_visible_by_scope(client, current_user)

            # Клиент с подклиентами не удаляется молча: иначе вся ветка
            # повиснет и уедет в группу «по имени родителя».
            descendant_ids = get_client_descendant_ids(cursor, client_id)

            if descendant_ids:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Нельзя удалить клиента: у него есть подклиенты ({len(descendant_ids)}). "
                        "Сначала перенесите или удалите подклиентов."
                    )
                )

            # Проверяем активные заявки клиента
            cursor.execute(
                """
                SELECT COUNT(*) AS active_count
                FROM requests
                WHERE client_id = %s
                AND is_deleted = 0
                AND status IN ('NEW', 'IN_PROGRESS')
                """,
                (client_id,)
            )
            result = cursor.fetchone()

            if result["active_count"] > 0:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя удалить клиента: у него есть активные заявки"
                )

            # Soft delete
            cursor.execute(
                """
                UPDATE clients
                SET is_deleted = 1,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], client_id)
            )

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="CLIENT_DELETED",
                old_value=client.get("name"),
            )

            connection.commit()

            return {
                "message": "Клиент перемещён в корзину",
                "client_id": client_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{client_id}/restore")
def restore_client(client_id: int, current_user: dict = Depends(get_current_user)):
    """Восстановление клиента из корзины."""
    if not can_restore_client(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для восстановления клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    name,
                    company_name,
                    source_client_name,
                    source_parent_client_name,
                    parent_client_id,
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

            if not client["is_deleted"]:
                raise HTTPException(status_code=400, detail="Клиент не находится в корзине")

            ensure_client_visible_by_scope(client, current_user)

            # Пока клиент лежал в корзине, родителя могли удалить,
            # а связь могла быть потеряна при импорте. Восстанавливаем ссылку.
            old_parent_client_id = get_parent_client_id(client)
            restored_parent_client_id = old_parent_client_id

            if restored_parent_client_id:
                cursor.execute(
                    "SELECT id, is_deleted FROM clients WHERE id = %s LIMIT 1",
                    (restored_parent_client_id,),
                )

                parent_row = cursor.fetchone()

                if not parent_row or parent_row["is_deleted"]:
                    restored_parent_client_id = None

            if not restored_parent_client_id:
                restored_parent_client_id = resolve_parent_client_id_by_name(
                    cursor, client
                )

                if restored_parent_client_id:
                    # Защита от кольца: клиент из корзины не должен оказаться
                    # выше собственного будущего родителя. Цепочку смотрим
                    # вместе с удалёнными, иначе кольцо через корзину не видно.
                    ancestor_ids = {
                        int(row["id"])
                        for row in get_client_ancestors(
                            cursor,
                            restored_parent_client_id,
                            include_deleted=True,
                        )
                    }

                    if int(client_id) in ancestor_ids:
                        restored_parent_client_id = None

            cursor.execute(
                """
                UPDATE clients
                SET is_deleted = 0,
                    deleted_at = NULL,
                    deleted_by = NULL,
                    parent_client_id = %s
                WHERE id = %s
                """,
                (restored_parent_client_id, client_id)
            )

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="CLIENT_RESTORED",
                new_value=client.get("name"),
            )

            if restored_parent_client_id != old_parent_client_id:
                add_client_history(
                    cursor,
                    client_id=client_id,
                    user_id=current_user["id"],
                    action="PARENT_CHANGED",
                    field_name="parent_client_id",
                    old_value=old_parent_client_id,
                    new_value=restored_parent_client_id,
                    comment="Связь пересчитана при восстановлении из корзины",
                )

            connection.commit()

            return {
                "message": "Клиент восстановлен",
                "client_id": client_id,
                "parent_client_id": restored_parent_client_id,
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/{client_id}/requests")
def get_client_requests(
    client_id: int,
    include_subclients: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
):
    """
    Заявки клиента.

    include_subclients=true добавляет заявки всей ветки подклиентов.
    Такие заявки помечены is_subclient_request=1: их видно из карточки
    родителя, но редактируются они по обычным правилам заявок.
    """
    ensure_can_view_clients(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем, что клиент существует и не удалён
            cursor.execute(
                """
                SELECT
                    id,
                    created_by,
                    responsible_manager_id,
                    is_deleted
                FROM clients
                WHERE id = %s
                AND is_deleted = 0
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            ensure_client_visible_by_scope(client, current_user)

            if not can_open_client_details_for_router(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра заявок этого клиента"
                )

            client_ids = [int(client_id)]
            subclient_ids = []

            if include_subclients:
                subclient_ids = get_client_descendant_ids(cursor, client_id)
                client_ids.extend(subclient_ids)

            placeholders = ", ".join(["%s"] * len(client_ids))

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

                    client.payment_type AS client_payment_type,
                    client.name AS client_name,
                    client.company_name AS client_company_name,
                    client.parent_client_id AS client_parent_client_id,

                    creator.name AS created_by_name,
                    creator.role AS created_by_role
                FROM requests r
                LEFT JOIN clients client ON r.client_id = client.id
                LEFT JOIN users creator ON r.created_by = creator.id
                WHERE r.client_id IN ({placeholders})
                    AND r.is_deleted = 0
                ORDER BY r.created_at DESC
                """,
                tuple(client_ids)
            )

            requests = cursor.fetchall()

            subclient_ids_set = set(subclient_ids)

            for request in requests:
                request_client_id = int(request.get("client_id") or 0)

                request["is_subclient_request"] = request_client_id in subclient_ids_set
                request["client_display_name"] = (
                    request.get("client_company_name")
                    or request.get("client_name")
                    or f"ID {request_client_id}"
                )

            requests = attach_vehicles_to_requests(cursor, requests)
            requests = attach_executors_to_client_requests(cursor, requests)

            # Тот же принцип, что в requests.py: цену прячет сервер, а не фронт.
            if not can_view_price_fields(current_user):
                for request in requests:
                    request["total_price"] = None

            return requests

    finally:
        connection.close()

@router.get("/{client_id}/subclients")
def get_client_subclients(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Плоский список подклиентов ветки со счётчиками.
    Нужен карточке клиента и, позже, порталу.
    """
    ensure_can_view_clients(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = load_client_for_settings(cursor, client_id)

            ensure_client_visible_by_scope(client, current_user)

            if not can_open_client_details_for_router(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра этого клиента",
                )

            descendant_ids = get_client_descendant_ids(cursor, client_id)

            if not descendant_ids:
                return []

            placeholders = ", ".join(["%s"] * len(descendant_ids))

            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.type,
                    c.name,
                    c.company_name,
                    c.phone,
                    c.status,
                    c.payment_type,
                    c.parent_client_id,
                    c.responsible_manager_id,
                    c.created_by,

                    responsible.name AS responsible_manager_name,

                    (
                        SELECT COUNT(*)
                        FROM requests r
                        WHERE r.client_id = c.id
                          AND r.is_deleted = 0
                    ) AS request_count,

                    (
                        SELECT COUNT(*)
                        FROM vehicles v
                        WHERE v.client_id = c.id
                          AND v.is_deleted = 0
                    ) AS vehicle_count

                FROM clients c
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                WHERE c.id IN ({placeholders})
                  AND c.is_deleted = 0
                ORDER BY c.company_name ASC, c.name ASC, c.id ASC
                """,
                tuple(descendant_ids),
            )

            subclients = cursor.fetchall()

            parent_block_state = resolve_effective_client_block(cursor, client)

            for subclient in subclients:
                if parent_block_state["effective_status"] == "BLOCKED":
                    subclient["effective_status"] = "BLOCKED"
                    subclient["is_blocked_by_parent"] = True
                    subclient["blocked_by_client_id"] = (
                        parent_block_state["blocked_by_client_id"]
                        or int(client["id"])
                    )
                    subclient["blocked_by_client_name"] = (
                        parent_block_state["blocked_by_client_name"]
                        or get_client_display_name(client)
                    )
                else:
                    subclient.update(resolve_effective_client_block(cursor, subclient))

                attach_client_permissions(subclient, current_user)

            return subclients

    finally:
        connection.close()

@router.get("/{client_id}/installation-settings")
def get_client_installation_settings(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Параметры установки клиента. Если своих нет — отдаются родительские
    с пометкой source = INHERITED.
    """
    ensure_can_view_clients(current_user)

    if not can_view_client_installation_settings(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра параметров установки",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = load_client_for_settings(cursor, client_id)

            ensure_client_visible_by_scope(client, current_user)

            if not can_open_client_details_for_router(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра этого клиента",
                )

            payload = resolve_client_installation_settings(cursor, client)

            payload["client_id"] = client_id
            payload["can_manage"] = can_manage_client_installation_settings(
                client, current_user
            )

            return payload

    finally:
        connection.close()


@router.put("/{client_id}/installation-settings")
def update_client_installation_settings(
    client_id: int,
    data: ClientInstallationSettingsUpdate,
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = load_client_for_settings(cursor, client_id)

            ensure_client_visible_by_scope(client, current_user)

            if not can_manage_client_installation_settings(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для изменения параметров установки этого клиента",
                )

            visit_type = str(data.visit_type or "").strip().upper() or None

            if visit_type and visit_type not in ALLOWED_INSTALLATION_VISIT_TYPES:
                raise HTTPException(status_code=400, detail="Некорректный формат работ")

            visit_price_code = str(data.visit_price_code or "").strip().upper() or None

            if visit_type == "IN_OFFICE":
                visit_price_code = None

            if (
                visit_price_code
                and visit_price_code not in ALLOWED_INSTALLATION_VISIT_PRICE_CODES
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "В параметрах клиента можно выбрать только выезд в черте города "
                        "или за пределы города. Командировка зависит от адреса и "
                        "указывается при создании заявки."
                    ),
                )

            visit_price_code = ensure_price_code_active(
                cursor, visit_price_code, "Тип выезда"
            )
            gps_price_code = ensure_price_code_active(
                cursor, data.gps_price_code, "Трекер"
            )

            platform = normalize_optional_str(data.platform)

            tracker_months = int(data.tracker_subscription_months or 0)
            beacon_months = int(data.beacon_subscription_months or 0)

            if tracker_months < 0 or beacon_months < 0:
                raise HTTPException(
                    status_code=400,
                    detail="Количество месяцев подписки не может быть отрицательным",
                )

            has_beacon = bool(data.has_beacon)

            # Снятая галочка означает «VIN можно не указывать при создании
            # заявки», а не «VIN не нужен». Завершить работы без него всё
            # равно не получится — проверка стоит в /requests/{id}/complete.
            vin_required = bool(data.vin_required)

            # Снятая галочка убирает поле времени из кабинета клиента.
            # Само время никуда не девается — оно подставляется ближайшим
            # рабочим слотом в момент создания заявки.
            schedule_time_required = bool(data.schedule_time_required)

            # Блокировка и подписка трекера существуют только вместе с трекером.
            has_blocking = bool(data.has_blocking) if gps_price_code else False

            if not gps_price_code:
                tracker_months = 0

            if not has_beacon:
                beacon_months = 0

            sensors = []

            for index, sensor in enumerate(data.sensors or []):
                sensor_name = str(sensor.name or "").strip()

                if not sensor_name:
                    continue

                sensor_price = float(sensor.price or 0)

                if sensor_price < 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Цена датчика не может быть отрицательной",
                    )

                sensors.append(
                    {
                        "name": sensor_name,
                        "price": sensor_price,
                        "sort_order": index,
                    }
                )

            old_payload = resolve_client_installation_settings(cursor, client)

            cursor.execute(
                """
                INSERT INTO client_installation_settings (
                    client_id,
                    visit_type,
                    visit_price_code,
                    platform,
                    gps_price_code,
                    tracker_subscription_months,
                    has_blocking,
                    has_beacon,
                    beacon_subscription_months,
                    vin_required,
                    schedule_time_required,
                    created_by,
                    updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    visit_type = VALUES(visit_type),
                    visit_price_code = VALUES(visit_price_code),
                    platform = VALUES(platform),
                    gps_price_code = VALUES(gps_price_code),
                    tracker_subscription_months = VALUES(tracker_subscription_months),
                    has_blocking = VALUES(has_blocking),
                    has_beacon = VALUES(has_beacon),
                    beacon_subscription_months = VALUES(beacon_subscription_months),
                    vin_required = VALUES(vin_required),
                    schedule_time_required = VALUES(schedule_time_required),
                    updated_by = VALUES(updated_by)
                """,
                (
                    client_id,
                    visit_type,
                    visit_price_code,
                    platform,
                    gps_price_code,
                    tracker_months,
                    1 if has_blocking else 0,
                    1 if has_beacon else 0,
                    beacon_months,
                    1 if vin_required else 0,
                    1 if schedule_time_required else 0,
                    current_user["id"],
                    current_user["id"],
                ),
            )

            settings_row = load_client_installation_settings_row(cursor, client_id)
            settings_id = int(settings_row["id"])

            cursor.execute(
                "DELETE FROM client_installation_sensors WHERE settings_id = %s",
                (settings_id,),
            )

            for sensor in sensors:
                cursor.execute(
                    """
                    INSERT INTO client_installation_sensors (
                        settings_id,
                        name,
                        price,
                        sort_order
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        settings_id,
                        sensor["name"],
                        sensor["price"],
                        sensor["sort_order"],
                    ),
                )

            new_payload = resolve_client_installation_settings(cursor, client)

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="INSTALLATION_SETTINGS_UPDATED",
                old_value=describe_installation_settings(old_payload),
                new_value=describe_installation_settings(new_payload),
            )

            connection.commit()

            new_payload["client_id"] = client_id
            new_payload["can_manage"] = True

            return new_payload

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/{client_id}/installation-settings")
def reset_client_installation_settings(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Сброс собственных параметров клиента. После этого он снова берёт
    родительские, а если родителя нет — считается ненастроенным.
    """
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = load_client_for_settings(cursor, client_id)

            ensure_client_visible_by_scope(client, current_user)

            if not can_manage_client_installation_settings(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для изменения параметров установки этого клиента",
                )

            own_row = load_client_installation_settings_row(cursor, client_id)

            if not own_row:
                raise HTTPException(
                    status_code=400,
                    detail="У этого клиента нет собственных параметров установки",
                )

            old_payload = resolve_client_installation_settings(cursor, client)

            cursor.execute(
                "DELETE FROM client_installation_settings WHERE client_id = %s",
                (client_id,),
            )

            new_payload = resolve_client_installation_settings(cursor, client)

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="INSTALLATION_SETTINGS_RESET",
                old_value=describe_installation_settings(old_payload),
                new_value=describe_installation_settings(new_payload),
            )

            connection.commit()

            new_payload["client_id"] = client_id
            new_payload["can_manage"] = True

            return new_payload

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.get("/{client_id}/history")
def get_client_history(
    client_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    ensure_can_view_clients(current_user)

    if not can_view_client_history(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра истории клиента",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = load_client_for_settings(cursor, client_id, allow_deleted=True)

            ensure_client_visible_by_scope(client, current_user)

            if not can_open_client_details_for_router(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра этого клиента",
                )

            cursor.execute(
                """
                SELECT
                    h.id,
                    h.action,
                    h.field_name,
                    h.old_value,
                    h.new_value,
                    h.comment,
                    h.created_at,
                    u.name AS user_name
                FROM client_history h
                LEFT JOIN users u ON u.id = h.user_id
                WHERE h.client_id = %s
                ORDER BY h.created_at DESC, h.id DESC
                LIMIT %s
                """,
                (client_id, limit),
            )

            return cursor.fetchall()

    finally:
        connection.close()