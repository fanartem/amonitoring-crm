# Backend/app/permissions.py

import json

from fastapi import HTTPException

ADMIN = "ADMIN"
ROP = "ROP"
MANAGER = "MANAGER"
TECH_SUPPORT = "TECH_SUPPORT"
ACCOUNTANT = "ACCOUNTANT"
WAREHOUSE_MANAGER = "WAREHOUSE_MANAGER"
SENIOR_TECHNICIAN = "SENIOR_TECHNICIAN"
TECHNICIAN = "TECHNICIAN"


CLIENT_STATUSES = ["ACTIVE", "BLOCKED", "DEBTOR"]

USER_ROLES = [
    ADMIN,
    ROP,
    MANAGER,
    TECH_SUPPORT,
    ACCOUNTANT,
    WAREHOUSE_MANAGER,
    SENIOR_TECHNICIAN,
    TECHNICIAN,
]

# ============================================================================
# New access-control layer
# ----------------------------------------------------------------------------
# Важно:
# - старые role-based функции ниже пока оставляем для совместимости;
# - новые permissions постепенно подключаем в routers;
# - SUPER_ADMIN получает все active permissions;
# - бизнес-валидации всё равно должны оставаться в routers/services.
# ============================================================================

DATA_SCOPE_ALL = "ALL"
DATA_SCOPE_CITY = "CITY"
DATA_SCOPE_RESPONSIBLE_CLIENTS = "RESPONSIBLE_CLIENTS"
DATA_SCOPE_ASSIGNED = "ASSIGNED"
DATA_SCOPE_CITY_ASSIGNED = "CITY_ASSIGNED"
DATA_SCOPE_OWN = "OWN"
DATA_SCOPE_NONE = "NONE"

# Область клиентского портала: пользователь видит только своего клиента
# и его подклиентов. Добавлена миграцией 2026_09_03_client_portal_foundation.
#
# Важно: requests.py намеренно НЕ знает эту область — до этапа 6
# get_effective_request_data_scope вернёт для неё NONE, то есть
# портальный пользователь не увидит ни одной заявки.
DATA_SCOPE_CLIENT = "CLIENT"

USER_KIND_EMPLOYEE = "EMPLOYEE"
USER_KIND_CLIENT = "CLIENT"

CLIENT_PORTAL_ROLE = "CLIENT_PORTAL"

USER_PERMISSION_ALLOW = "ALLOW"
USER_PERMISSION_DENY = "DENY"

REQUEST_VIEW_PERMISSION_CODES = [
    "requests.view",
]

REQUEST_VIEW_ALL_PERMISSION_CODES = [
    "requests.view_all",
]

REQUEST_CREATE_PERMISSION_CODES = [
    "requests.create",
]

REQUEST_EDIT_ALL_PERMISSION_CODES = [
    "requests.edit_all",
]

REQUEST_PAYMENT_MANAGE_PERMISSION_CODES = [
    "requests.payment.manage",
]

REQUEST_STATUS_MANAGE_PERMISSION_CODES = [
    "requests.status.change",
    "requests.status.override",
]

REQUEST_DELETE_ANY_PERMISSION_CODES = [
    "requests.delete_any",
]

REQUEST_DELETE_OWN_PERMISSION_CODES = [
    "requests.delete_own_limited",
]

REQUEST_EXECUTORS_MANAGE_PERMISSION_CODES = [
    "requests.executors.manage",
]

CLIENTS_VIEW_PERMISSION_CODES = [
    "clients.view",
    "clients.view_all",
    "clients.view_own",
    "clients.manage",
]

CLIENTS_VIEW_ALL_PERMISSION_CODES = [
    "clients.view_all",
    "clients.manage",
]

CLIENTS_EDIT_ALL_PERMISSION_CODES = [
    "clients.edit_all",
    "clients.manage",
]

CLIENTS_EDIT_OWN_PERMISSION_CODES = [
    "clients.edit_own",
]

CLIENTS_STATUS_MANAGE_PERMISSION_CODES = [
    "clients.status.change",
    "clients.manage",
]

CLIENTS_REASSIGN_PERMISSION_CODES = [
    "clients.responsible.reassign",
    "clients.manage",
]

# Параметры установки по договору с клиентом.
# Право «изменять» тянет «видеть» зависимостью, но в список включаем оба —
# проверка не должна зависеть от того, раскрылись зависимости или нет.
CLIENT_INSTALLATION_SETTINGS_VIEW_PERMISSION_CODES = [
    "clients.installation_settings.view",
    "clients.installation_settings.manage_all",
    "clients.installation_settings.manage_own",
]

CLIENT_INSTALLATION_SETTINGS_MANAGE_ALL_PERMISSION_CODES = [
    "clients.installation_settings.manage_all",
]

CLIENT_INSTALLATION_SETTINGS_MANAGE_OWN_PERMISSION_CODES = [
    "clients.installation_settings.manage_own",
]

CLIENT_HISTORY_VIEW_PERMISSION_CODES = [
    "clients.history.view",
]

PRICES_VIEW_PERMISSION_CODES = [
    "prices.view",
    "base_prices.view",
    "client_prices.view",
    "requests.price.view",
    "requests.prices.view",
]

BASE_PRICES_MANAGE_PERMISSION_CODES = [
    "base_prices.manage",
    "prices.base.manage",
    "prices.manage",
]

# client_prices.manage — базовый код раздела, а не «все клиенты».
# Область задаётся явно: manage_all / manage_own.
CLIENT_PRICES_MANAGE_ANY_PERMISSION_CODES = [
    "client_prices.manage_all",
    "prices.client.manage_all",
    "prices.manage",
]

CLIENT_PRICES_MANAGE_OWN_PERMISSION_CODES = [
    "client_prices.manage_own",
    "prices.client.manage_own",
]

WAREHOUSE_VIEW_PERMISSION_CODES = [
    "warehouse.view",
    "warehouse.manage",
]

WAREHOUSE_MANAGE_PERMISSION_CODES = [
    "warehouse.manage",
]

EMPLOYEE_EQUIPMENT_MANAGE_PERMISSION_CODES = [
    "warehouse.employee_equipment.manage",
    "warehouse.inventory.manage_all",
    "warehouse.inventory.assign",
    "warehouse.inventory.transfer",
]

ATTACHMENT_VIEW_ALL_PERMISSION_CODES = [
    "attachments.view_all",
    "attachments.manage",
]

ATTACHMENT_VIEW_OWN_PERMISSION_CODES = [
    "attachments.view_own",
]

# attachments.delete_any и files.delete_any в таблице permissions
# отсутствуют — проверка по ним не срабатывала ни разу.
ATTACHMENT_DELETE_ANY_PERMISSION_CODES = [
    "attachments.delete",
    "attachments.manage",
]

SUPPORT_REQUEST_VIEW_PERMISSION_CODES = [
    "support_requests.view",
    "support_requests.manage",
]

SUPPORT_REQUEST_CREATE_PERMISSION_CODES = [
    "support_requests.create",
    "support_requests.manage",
]

SUPPORT_REQUEST_EDIT_PERMISSION_CODES = [
    "support_requests.edit",
    "support_requests.manage",
]

SUPPORT_REQUEST_ASSIGN_PERMISSION_CODES = [
    "support_requests.assign",
    "support_requests.manage",
]

SUPPORT_REQUEST_STATUS_PERMISSION_CODES = [
    "support_requests.status.change",
    "support_requests.status.manage",
    "support_requests.manage",
]

SUPPORT_REQUEST_DELETE_PERMISSION_CODES = [
    "support_requests.delete",
    "support_requests.manage",
]

SUPPORT_REQUEST_COMMENT_PERMISSION_CODES = [
    "support_requests.comment",
    "support_requests.manage",
]

# Права клиентского портала. Синонимов нет и не будет:
# коды заведены с нуля одной миграцией, дублировать нечего.
PORTAL_ACCESS_PERMISSION_CODES = [
    "portal.access",
]

PORTAL_REQUEST_VIEW_PERMISSION_CODES = [
    "portal.requests.view",
]

PORTAL_REQUEST_CREATE_PERMISSION_CODES = [
    "portal.requests.create",
]

PORTAL_REQUEST_CANCEL_PERMISSION_CODES = [
    "portal.requests.cancel_new",
]

PORTAL_VEHICLE_VIEW_PERMISSION_CODES = [
    "portal.vehicles.view",
]

PORTAL_SUBCLIENT_VIEW_PERMISSION_CODES = [
    "portal.subclients.view",
]

PORTAL_SUBCLIENT_CREATE_PERMISSION_CODES = [
    "portal.subclients.create",
]

PORTAL_PRICE_VIEW_PERMISSION_CODES = [
    "portal.prices.view",
]

PORTAL_INSTALLATION_SETTINGS_VIEW_PERMISSION_CODES = [
    "portal.installation_settings.view",
]

PORTAL_PASSWORD_CHANGE_PERMISSION_CODES = [
    "portal.password.change",
]

PORTAL_COMMENT_CREATE_PERMISSION_CODES = [
    "portal.comments.create",
]


def to_bool(value) -> bool:
    if isinstance(value, bool):
        return value

    if value is None:
        return False

    if isinstance(value, (int, float)):
        return value != 0

    normalized = str(value).strip().lower()

    return normalized in ["1", "true", "yes", "y", "да"]


def is_super_admin(user: dict | None) -> bool:
    if not user:
        return False

    return to_bool(user.get("is_super_admin"))


def is_owner(user: dict | None) -> bool:
    if not user:
        return False

    return to_bool(user.get("is_owner"))


def get_data_scope(user: dict | None) -> str:
    if not user:
        return DATA_SCOPE_NONE

    return (
        user.get("data_scope")
        or user.get("role_data_scope")
        or DATA_SCOPE_NONE
    )


def get_user_kind(user: dict | None) -> str:
    """
    Тип учётной записи. Отсутствие значения считаем сотрудником —
    так ведут себя все записи, созданные до появления портала.
    """
    if not user:
        return USER_KIND_EMPLOYEE

    kind = str(user.get("user_kind") or USER_KIND_EMPLOYEE).strip().upper()

    return kind if kind in [USER_KIND_EMPLOYEE, USER_KIND_CLIENT] else USER_KIND_EMPLOYEE


def is_client_user(user: dict | None) -> bool:
    """
    Учётная запись клиента. Проверяем и по типу, и по области данных:
    одного признака мало, если кто-то руками поменяет роль в Settings.
    """
    if not user:
        return False

    return (
        get_user_kind(user) == USER_KIND_CLIENT
        or get_data_scope(user) == DATA_SCOPE_CLIENT
    )


def is_employee_user(user: dict | None) -> bool:
    return not is_client_user(user)


def get_user_client_id(user: dict | None) -> int | None:
    """
    Клиент, к которому привязана учётная запись портала.
    У сотрудника всегда None — это гарантирует CHECK в базе.
    """
    if not is_client_user(user):
        return None

    client_id = user.get("client_id") if user else None

    return int(client_id) if client_id else None


def require_employee_user(
    user: dict | None,
    detail: str = "Раздел доступен только сотрудникам",
):
    """
    Заглушка для сотрудничьих разделов. Клиентская учётка не должна
    попадать в склад, отчёты, настройки и списки пользователей,
    даже если кто-то по ошибке выдаст ей лишнее право.
    """
    if is_client_user(user):
        raise HTTPException(status_code=403, detail=detail)

    return True


# Состояние клиента, к которому привязана учётная запись портала.
#
# Правила приняты на этапе 5:
#   клиент в корзине — вход запрещён: карточки фактически нет;
#   клиент BLOCKED   — вход разрешён, кабинет работает только на чтение;
#   клиент DEBTOR    — обычная работа, долг ограничивает не портал,
#                      а решения менеджера.
CLIENT_STATUS_BLOCKED = "BLOCKED"

# Совпадает с CLIENT_TREE_MAX_DEPTH в clients.py. Дублируется намеренно:
# clients.py импортирует permissions.py, обратный импорт дал бы кольцо.
CLIENT_PORTAL_TREE_MAX_DEPTH = 10


def get_client_account_status(user: dict | None) -> str:
    if not user:
        return ""

    return str(user.get("client_status") or "").strip().upper()


def client_account_is_deleted(user: dict | None) -> bool:
    return bool(user and to_bool(user.get("client_is_deleted")))


def client_account_is_blocked(user: dict | None) -> bool:
    """
    Только собственный статус клиента, без цепочки родителей.
    Дешёвая проверка по уже загруженной строке.
    """
    return get_client_account_status(user) == CLIENT_STATUS_BLOCKED


def ensure_client_account_can_login(user: dict | None):
    """
    Вызывается на каждый запрос клиентской учётки. Здесь только то,
    что видно в загруженной строке — без обхода дерева клиентов.
    """
    if not is_client_user(user):
        return True

    if not get_user_client_id(user):
        raise HTTPException(
            status_code=403,
            detail=(
                "Учётная запись не привязана к клиенту. "
                "Обратитесь к вашему менеджеру."
            ),
        )

    if client_account_is_deleted(user):
        raise HTTPException(
            status_code=403,
            detail="Доступ в личный кабинет закрыт. Обратитесь к вашему менеджеру.",
        )

    return True


def client_branch_is_blocked(cursor, client_id: int | None) -> dict:
    """
    Блокировка наследуется вниз: заблокирован любой родитель по цепочке —
    заблокирована вся ветка. Повторяет resolve_effective_client_block
    из clients.py, но без импорта оттуда — иначе получится кольцо.

    Берём самую близкую заблокированную строку: depth = 0 означает
    собственный статус клиента, depth > 0 — блокировку от родителя.
    """
    empty = {
        "is_blocked": False,
        "is_blocked_by_parent": False,
        "blocked_by_client_id": None,
    }

    if not client_id:
        return empty

    cursor.execute(
        """
        WITH RECURSIVE client_chain AS (
            SELECT
                c.id,
                c.parent_client_id,
                c.status,
                c.is_deleted,
                0 AS depth
            FROM clients c
            WHERE c.id = %s

            UNION ALL

            SELECT
                p.id,
                p.parent_client_id,
                p.status,
                p.is_deleted,
                chain.depth + 1
            FROM clients p
            INNER JOIN client_chain chain
                ON p.id = chain.parent_client_id
            WHERE p.is_deleted = 0
              AND chain.depth < %s
        )
        SELECT id, status, depth
        FROM client_chain
        WHERE status = %s
        ORDER BY depth ASC
        LIMIT 1
        """,
        (int(client_id), CLIENT_PORTAL_TREE_MAX_DEPTH, CLIENT_STATUS_BLOCKED),
    )

    row = cursor.fetchone()

    if not row:
        return empty

    return {
        "is_blocked": True,
        "is_blocked_by_parent": int(row["depth"]) > 0,
        "blocked_by_client_id": int(row["id"]),
    }


def get_client_branch_ids(cursor, client_id: int | None) -> set[int]:
    """
    Клиент и вся его ветка подклиентов, включая самого клиента.

    Направление вниз по дереву. Обратный обход (вверх, к родителям)
    делает client_branch_is_blocked.

    Живёт здесь, а не в роутере: ветку клиента считают и заявки,
    и машины, и кабинет. Три копии одного рекурсивного запроса
    разъедутся при первой же правке.
    """
    if not client_id:
        return set()

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
        SELECT DISTINCT id
        FROM client_tree
        """,
        (int(client_id), CLIENT_PORTAL_TREE_MAX_DEPTH),
    )

    return {int(row["id"]) for row in (cursor.fetchall() or [])}


def get_portal_access_state(cursor, user: dict | None) -> dict:
    """
    Состояние кабинета для фронта: можно ли что-то менять.
    Для сотрудника возвращает нейтральные значения — поле в ответе
    авторизации одно для всех, ветвиться на фронте не придётся.
    """
    if not is_client_user(user):
        return {
            "portal_read_only": False,
            "portal_blocked_by_parent": False,
        }

    branch = client_branch_is_blocked(cursor, get_user_client_id(user))

    return {
        "portal_read_only": branch["is_blocked"],
        "portal_blocked_by_parent": branch["is_blocked_by_parent"],
    }


def get_user_base_access(cursor, user_id: int) -> dict | None:
    """
    Возвращает актуального пользователя + данные роли + security flags.
    Это будет использоваться в get_current_user().

    Для учётной записи клиента дополнительно подтягивается его клиент:
    статус и признак корзины нужны при входе (этап 5), а client_id —
    основа области данных CLIENT.
    """
    cursor.execute(
        """
        SELECT
            u.id,
            u.email,
            u.name,
            u.role,
            u.city,
            u.user_kind,
            u.client_id,
            u.is_approved,
            u.is_active,
            u.deleted_at,

            r.id AS role_id,
            r.code AS role_code,
            r.name AS role_name,
            r.description AS role_description,
            r.badge_color AS role_badge_color,
            r.data_scope AS role_data_scope,
            r.is_system AS role_is_system,
            r.is_active AS role_is_active,
            r.can_be_request_executor,
            r.can_be_responsible_manager,

            COALESCE(usf.is_super_admin, 0) AS is_super_admin,
            COALESCE(usf.is_owner, 0) AS is_owner,

            c.name AS client_name,
            c.company_name AS client_company_name,
            c.status AS client_status,
            c.is_deleted AS client_is_deleted,
            c.parent_client_id AS client_parent_client_id,
            c.responsible_manager_id AS client_responsible_manager_id
        FROM users u
        LEFT JOIN roles r ON r.code = u.role
        LEFT JOIN user_security_flags usf ON usf.user_id = u.id
        LEFT JOIN clients c ON c.id = u.client_id
        WHERE u.id = %s
        LIMIT 1
        """,
        (user_id,),
    )

    user = cursor.fetchone()

    if not user:
        return None

    user["is_super_admin"] = to_bool(user.get("is_super_admin"))
    user["is_owner"] = to_bool(user.get("is_owner"))
    user["role_is_system"] = to_bool(user.get("role_is_system"))
    user["role_is_active"] = to_bool(user.get("role_is_active"))
    user["can_be_request_executor"] = to_bool(user.get("can_be_request_executor"))
    user["can_be_responsible_manager"] = to_bool(user.get("can_be_responsible_manager"))

    # Удобные поля для frontend / backend.
    user["role_name"] = user.get("role_name") or user.get("role")
    user["role_badge_color"] = user.get("role_badge_color") or "#64748B"
    user["data_scope"] = user.get("role_data_scope") or DATA_SCOPE_NONE

    # Тип учётной записи. Пустое значение трактуем как сотрудника:
    # так безопаснее, потому что права портала сотруднику никто не выдавал.
    user_kind = str(user.get("user_kind") or USER_KIND_EMPLOYEE).strip().upper()

    if user_kind not in [USER_KIND_EMPLOYEE, USER_KIND_CLIENT]:
        user_kind = USER_KIND_EMPLOYEE

    user["user_kind"] = user_kind

    client_id = user.get("client_id")
    user["client_id"] = int(client_id) if client_id else None

    user["client_is_deleted"] = to_bool(user.get("client_is_deleted"))
    user["client_display_name"] = (
        user.get("client_company_name") or user.get("client_name")
    )

    return user


def get_all_active_permission_codes(cursor) -> list[str]:
    cursor.execute(
        """
        SELECT code
        FROM permissions
        WHERE is_active = 1
        ORDER BY category ASC, sort_order ASC, code ASC
        """
    )

    return [row["code"] for row in cursor.fetchall()]


def get_role_permission_codes(cursor, role_code: str) -> set[str]:
    cursor.execute(
        """
        SELECT p.code
        FROM role_permissions rp
        INNER JOIN roles r ON r.id = rp.role_id
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE r.code = %s
          AND r.is_active = 1
          AND p.is_active = 1
        """,
        (role_code,),
    )

    return {row["code"] for row in cursor.fetchall()}


def get_locked_core_permission_codes(cursor, role_code: str) -> set[str]:
    cursor.execute(
        """
        SELECT p.code
        FROM role_permissions rp
        INNER JOIN roles r ON r.id = rp.role_id
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE r.code = %s
          AND r.is_active = 1
          AND p.is_active = 1
          AND rp.is_locked_core = 1
        """,
        (role_code,),
    )

    return {row["code"] for row in cursor.fetchall()}


def get_user_permission_overrides(cursor, user_id: int) -> list[dict]:
    cursor.execute(
        """
        SELECT
            p.code,
            upo.effect
        FROM user_permission_overrides upo
        INNER JOIN permissions p ON p.id = upo.permission_id
        WHERE upo.user_id = %s
          AND p.is_active = 1
        """,
        (user_id,),
    )

    return cursor.fetchall()


def expand_permissions_with_dependencies(cursor, permission_codes: set[str]) -> set[str]:
    """
    Если есть warehouse.manage, автоматически добавляем warehouse.view и т.д.
    """
    expanded = set(permission_codes)

    while True:
        if not expanded:
            return expanded

        placeholders = ", ".join(["%s"] * len(expanded))

        cursor.execute(
            f"""
            SELECT
                required.code AS required_code
            FROM permission_dependencies pd
            INNER JOIN permissions p ON p.id = pd.permission_id
            INNER JOIN permissions required ON required.id = pd.required_permission_id
            WHERE p.code IN ({placeholders})
              AND p.is_active = 1
              AND required.is_active = 1
            """,
            tuple(expanded),
        )

        required_codes = {row["required_code"] for row in cursor.fetchall()}
        before_count = len(expanded)

        expanded.update(required_codes)

        if len(expanded) == before_count:
            return expanded


def get_effective_permissions(cursor, user_id: int, user: dict | None = None) -> list[str]:
    """
    Итоговые permissions пользователя:
    - SUPER_ADMIN получает все active permissions;
    - иначе берём стандарт роли;
    - применяем ALLOW / DENY;
    - DENY не может отключить LOCKED_CORE;
    - добавляем dependencies.
    """
    if user is None:
        user = get_user_base_access(cursor, user_id)

    if not user:
        return []

    if is_super_admin(user):
        return get_all_active_permission_codes(cursor)

    role_code = user.get("role")

    if not role_code:
        return []

    permissions = get_role_permission_codes(cursor, role_code)
    locked_core_permissions = get_locked_core_permission_codes(cursor, role_code)

    allow_codes = set()
    deny_codes = set()

    for override in get_user_permission_overrides(cursor, user_id):
        code = override.get("code")
        effect = override.get("effect")

        if not code:
            continue

        if effect == USER_PERMISSION_ALLOW:
            allow_codes.add(code)

        elif effect == USER_PERMISSION_DENY:
            # Обязательные права роли нельзя отключить индивидуальным DENY.
            if code not in locked_core_permissions:
                deny_codes.add(code)

    permissions |= allow_codes
    permissions -= deny_codes

    permissions = expand_permissions_with_dependencies(cursor, permissions)

    # Раскрытие зависимостей может вернуть код, снятый индивидуальным
    # запретом: vehicles.view_own требует vehicles.view, и DENY на
    # vehicles.view отменялся сам собой. Явный запрет должен побеждать,
    # поэтому применяем его ещё раз после раскрытия.
    permissions -= deny_codes

    return sorted(permissions)


def attach_effective_permissions(cursor, user: dict) -> dict:
    """
    Добавляет в user:
    - permissions
    - locked_core_permissions
    """
    if not user:
        return user

    user_id = int(user["id"])
    role_code = user.get("role")

    user["permissions"] = get_effective_permissions(cursor, user_id, user)

    if role_code:
        user["locked_core_permissions"] = sorted(
            get_locked_core_permission_codes(cursor, role_code)
        )
    else:
        user["locked_core_permissions"] = []

    return user


def has_permission(user: dict | None, permission_code: str) -> bool:
    """
    Проверка одного permission.
    Если current_user ещё старого формата и permissions не загружены —
    вернёт False, а старые функции ниже используют fallback по role.
    """
    if not user:
        return False

    if is_super_admin(user):
        return True

    return permission_code in set(user.get("permissions") or [])


def has_any_permission(user: dict | None, permission_codes: list[str]) -> bool:
    return any(has_permission(user, code) for code in permission_codes)


def permissions_are_loaded(user: dict | None) -> bool:
    """
    True means the user object came from the new access layer and its
    effective permission list is authoritative, even when the list is empty.
    """
    return user is not None and isinstance(user.get("permissions"), list)


def should_use_legacy_role_fallback(user: dict | None) -> bool:
    """
    Role fallback is allowed only for legacy user dictionaries that do not
    contain the loaded permissions list. Once permissions are loaded, an empty
    list must mean no action access.
    """
    if not user:
        return False

    if is_super_admin(user):
        return False

    return not permissions_are_loaded(user)


def has_any_permission_or_legacy(
    user: dict | None,
    permission_codes: list[str],
    legacy_roles: list[str],
) -> bool:
    if has_any_permission(user, permission_codes):
        return True

    return has_legacy_role(user, legacy_roles)


def require_permission(
    user: dict | None,
    permission_code: str,
    detail: str = "Недостаточно прав",
):
    if not has_permission(user, permission_code):
        raise HTTPException(status_code=403, detail=detail)

    return True


def require_any_permission(
    user: dict | None,
    permission_codes: list[str],
    detail: str = "Недостаточно прав",
):
    if not has_any_permission(user, permission_codes):
        raise HTTPException(status_code=403, detail=detail)

    return True


def add_access_audit_log(
    cursor,
    *,
    actor_user_id: int | None,
    target_user_id: int | None = None,
    target_role_id: int | None = None,
    action: str,
    old_value=None,
    new_value=None,
    reason: str | None = None,
):
    """
    Единая запись истории изменения ролей/доступов.
    """
    cursor.execute(
        """
        INSERT INTO access_audit_log (
            actor_user_id,
            target_user_id,
            target_role_id,
            action,
            old_value,
            new_value,
            reason
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            actor_user_id,
            target_user_id,
            target_role_id,
            action,
            json.dumps(old_value, ensure_ascii=False, default=str) if old_value is not None else None,
            json.dumps(new_value, ensure_ascii=False, default=str) if new_value is not None else None,
            reason,
        ),
    )


def add_client_history(
    cursor,
    *,
    client_id: int,
    user_id: int | None,
    action: str,
    field_name: str | None = None,
    old_value=None,
    new_value=None,
    comment: str | None = None,
):
    """
    Журнал изменений по клиенту: данные карточки, статус, тип оплаты,
    ответственный менеджер, параметры установки, клиентские пользователи.

    Отдельно от access_audit_log: тот про роли и права сотрудников,
    здесь — про клиента.
    """
    cursor.execute(
        """
        INSERT INTO client_history (
            client_id,
            user_id,
            action,
            field_name,
            old_value,
            new_value,
            comment
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            client_id,
            user_id,
            action,
            field_name,
            None if old_value is None else str(old_value),
            None if new_value is None else str(new_value),
            comment,
        ),
    )


def get_role(user: dict | None) -> str | None:
    if not user:
        return None

    return user.get("role")


def has_legacy_role(user: dict | None, roles: list[str]) -> bool:
    if not should_use_legacy_role_fallback(user):
        return False

    role = get_role(user)
    return role in roles if role else False


def is_admin(user: dict) -> bool:
    return is_super_admin(user) or get_role(user) == ADMIN


def is_rop(user: dict) -> bool:
    return get_role(user) == ROP


def is_manager(user: dict) -> bool:
    return get_role(user) == MANAGER


def is_tech_support(user: dict) -> bool:
    return get_role(user) == TECH_SUPPORT


def is_accountant(user: dict) -> bool:
    return get_role(user) == ACCOUNTANT


def is_warehouse_manager(user: dict) -> bool:
    return get_role(user) == WAREHOUSE_MANAGER


def is_senior_technician(user: dict) -> bool:
    return get_role(user) == SENIOR_TECHNICIAN


def is_technician(user: dict) -> bool:
    return get_role(user) == TECHNICIAN


def is_any_technician(user: dict) -> bool:
    return get_role(user) in [TECHNICIAN, SENIOR_TECHNICIAN]


def can_view_all_requests(user: dict) -> bool:
    if has_any_permission(user, REQUEST_VIEW_ALL_PERMISSION_CODES):
        return True

    if (
        has_any_permission(user, REQUEST_VIEW_PERMISSION_CODES)
        and get_data_scope(user) == DATA_SCOPE_ALL
    ):
        return True

    return has_legacy_role(
        user,
        [ADMIN, ROP, SENIOR_TECHNICIAN, WAREHOUSE_MANAGER],
    )


def can_create_request(user: dict) -> bool:
    return has_any_permission(user, REQUEST_CREATE_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP, MANAGER, TECH_SUPPORT],
    )


def can_edit_all_requests(user: dict) -> bool:
    return has_any_permission(user, REQUEST_EDIT_ALL_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP],
    )


def can_edit_payment_info(user: dict) -> bool:
    return has_any_permission(user, REQUEST_PAYMENT_MANAGE_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP, ACCOUNTANT],
    )


def can_change_request_status(user: dict) -> bool:
    return has_any_permission(user, REQUEST_STATUS_MANAGE_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP, SENIOR_TECHNICIAN],
    )


def can_delete_any_request(user: dict) -> bool:
    return has_any_permission(user, REQUEST_DELETE_ANY_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP],
    )


def can_delete_own_request_with_time_limit(user: dict) -> bool:
    return has_any_permission(user, REQUEST_DELETE_OWN_PERMISSION_CODES) or has_legacy_role(
        user,
        [MANAGER, TECH_SUPPORT],
    )


def can_view_clients_tab(user: dict) -> bool:
    return has_any_permission(user, CLIENTS_VIEW_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP, MANAGER, TECH_SUPPORT, ACCOUNTANT, WAREHOUSE_MANAGER, SENIOR_TECHNICIAN],
    )


def can_view_all_client_details(user: dict) -> bool:
    return has_any_permission(user, CLIENTS_VIEW_ALL_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP, TECH_SUPPORT, ACCOUNTANT, WAREHOUSE_MANAGER],
    )


def can_edit_all_clients(user: dict) -> bool:
    return has_any_permission(user, CLIENTS_EDIT_ALL_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP],
    )


def can_change_client_status(user: dict) -> bool:
    return has_any_permission(user, CLIENTS_STATUS_MANAGE_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP, ACCOUNTANT],
    )


def can_reassign_clients(user: dict) -> bool:
    return has_any_permission(user, CLIENTS_REASSIGN_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP],
    )


def can_view_prices(user: dict) -> bool:
    return has_any_permission(user, PRICES_VIEW_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP, MANAGER, TECH_SUPPORT, ACCOUNTANT],
    )


def can_manage_base_prices(user: dict) -> bool:
    return has_any_permission(user, BASE_PRICES_MANAGE_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP],
    )


def can_manage_any_client_prices(user: dict) -> bool:
    return has_any_permission(user, CLIENT_PRICES_MANAGE_ANY_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP],
    )


def can_manage_own_client_prices(user: dict) -> bool:
    return has_any_permission(user, CLIENT_PRICES_MANAGE_OWN_PERMISSION_CODES) or has_legacy_role(
        user,
        [MANAGER],
    )


def can_view_warehouse(user: dict) -> bool:
    return has_any_permission(user, WAREHOUSE_VIEW_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, WAREHOUSE_MANAGER, MANAGER, SENIOR_TECHNICIAN, TECHNICIAN],
    )


def can_manage_warehouse(user: dict) -> bool:
    return has_any_permission(user, WAREHOUSE_MANAGE_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, WAREHOUSE_MANAGER],
    )


def can_manage_employee_equipment(user: dict) -> bool:
    return can_manage_warehouse(user) or has_any_permission(
        user,
        EMPLOYEE_EQUIPMENT_MANAGE_PERMISSION_CODES,
    )


def can_view_price_fields(user: dict) -> bool:
    return can_view_prices(user) or has_legacy_role(
        user,
        [ADMIN, ROP, MANAGER, TECH_SUPPORT, ACCOUNTANT, WAREHOUSE_MANAGER],
    )


def can_view_attachment(attachment: dict, current_user: dict) -> bool:
    if has_any_permission(current_user, ATTACHMENT_VIEW_ALL_PERMISSION_CODES):
        return True

    if has_any_permission(current_user, ATTACHMENT_VIEW_OWN_PERMISSION_CODES):
        return (
            attachment.get("uploaded_by") is not None
            and int(attachment["uploaded_by"]) == int(current_user["id"])
        )

    return False


def can_delete_attachment(attachment: dict, current_user: dict, within_time_limit: bool) -> bool:
    if has_any_permission(current_user, ATTACHMENT_DELETE_ANY_PERMISSION_CODES):
        return True

    role = get_role(current_user)

    if has_legacy_role(current_user, [ADMIN, ROP]):
        return True

    is_owner = (
        attachment.get("uploaded_by") is not None
        and int(attachment["uploaded_by"]) == int(current_user["id"])
    )

    return is_owner and within_time_limit


def is_valid_client_status(status: str) -> bool:
    return status in CLIENT_STATUSES


def is_client_owned_by_user(client: dict, current_user: dict) -> bool:
    user_id = int(current_user["id"])

    responsible_manager_id = client.get("responsible_manager_id")
    created_by = client.get("created_by")

    return (
        responsible_manager_id is not None
        and int(responsible_manager_id) == user_id
    ) or (
        created_by is not None
        and int(created_by) == user_id
    )


def can_open_client_details(client: dict, current_user: dict) -> bool:
    role = get_role(current_user)

    if can_view_all_client_details(current_user):
        return True

    if has_any_permission(current_user, ["clients.view_own"]) or has_legacy_role(current_user, [MANAGER]):
        return is_client_owned_by_user(client, current_user)

    return False


def can_edit_client(client: dict, current_user: dict) -> bool:
    role = get_role(current_user)

    if can_edit_all_clients(current_user):
        return True

    if has_any_permission(current_user, CLIENTS_EDIT_OWN_PERMISSION_CODES) or has_legacy_role(current_user, [MANAGER]):
        return is_client_owned_by_user(client, current_user)

    return False


def can_view_client_installation_settings(user: dict) -> bool:
    return has_any_permission(user, CLIENT_INSTALLATION_SETTINGS_VIEW_PERMISSION_CODES)


def can_manage_all_client_installation_settings(user: dict) -> bool:
    return has_any_permission(
        user,
        CLIENT_INSTALLATION_SETTINGS_MANAGE_ALL_PERMISSION_CODES,
    )


def can_manage_own_client_installation_settings(user: dict) -> bool:
    return has_any_permission(
        user,
        CLIENT_INSTALLATION_SETTINGS_MANAGE_OWN_PERMISSION_CODES,
    )


def can_manage_client_installation_settings(client: dict, current_user: dict) -> bool:
    """
    Право плюс доступ именно к этому клиенту. Флаг отдаётся в карточке,
    фронт правило не дублирует.
    """
    if can_manage_all_client_installation_settings(current_user):
        return True

    if can_manage_own_client_installation_settings(current_user):
        return is_client_owned_by_user(client, current_user)

    return False


def can_view_client_history(user: dict) -> bool:
    return has_any_permission(user, CLIENT_HISTORY_VIEW_PERMISSION_CODES)


def can_create_request_for_client(client: dict, current_user: dict) -> bool:
    if client.get("status") == "BLOCKED":
        return False

    if not can_create_request(current_user):
        return False

    data_scope = get_data_scope(current_user)

    if data_scope == DATA_SCOPE_ALL:
        return True

    if has_any_permission(current_user, ["requests.create_all", "requests.manage"]):
        return True

    if data_scope in [DATA_SCOPE_RESPONSIBLE_CLIENTS, DATA_SCOPE_OWN]:
        return is_client_owned_by_user(client, current_user)

    if has_legacy_role(current_user, [ADMIN, ROP, TECH_SUPPORT]):
        return True

    if has_legacy_role(current_user, [MANAGER]):
        return is_client_owned_by_user(client, current_user)

    return False


def can_manage_request_executors(user: dict) -> bool:
    return has_any_permission(user, REQUEST_EXECUTORS_MANAGE_PERMISSION_CODES) or has_legacy_role(
        user,
        [ADMIN, ROP, SENIOR_TECHNICIAN],
    )


SUPPORT_REQUEST_ASSIGNEE_ROLES = [
    ADMIN,
    ROP,
    MANAGER,
    TECH_SUPPORT,
    ACCOUNTANT,
    WAREHOUSE_MANAGER,
]


def can_view_support_requests(user: dict) -> bool:
    return has_any_permission(user, SUPPORT_REQUEST_VIEW_PERMISSION_CODES)


def can_create_support_request(user: dict) -> bool:
    return has_any_permission(user, SUPPORT_REQUEST_CREATE_PERMISSION_CODES)


def can_edit_support_request(user: dict) -> bool:
    return has_any_permission(user, SUPPORT_REQUEST_EDIT_PERMISSION_CODES)


def can_assign_support_request(user: dict) -> bool:
    return has_any_permission(user, SUPPORT_REQUEST_ASSIGN_PERMISSION_CODES)


def can_change_support_request_status(user: dict, support_request: dict | None = None) -> bool:
    if has_any_permission(user, SUPPORT_REQUEST_STATUS_PERMISSION_CODES):
        return True

    if not support_request:
        return False

    # Назначенный исполнитель ведёт свою заявку сам,
    # даже если общего права на смену статусов у него нет.
    assigned_to = support_request.get("assigned_to")

    return assigned_to is not None and int(assigned_to) == int(user["id"])


def can_delete_support_request(user: dict) -> bool:
    return has_any_permission(user, SUPPORT_REQUEST_DELETE_PERMISSION_CODES)


def can_comment_support_request(user: dict) -> bool:
    return has_any_permission(user, SUPPORT_REQUEST_COMMENT_PERMISSION_CODES)


def can_access_portal(user: dict | None) -> bool:
    """
    Вход в личный кабинет. Одного права мало: сотрудник с ошибочно
    выданным portal.access в портал попасть не должен.
    """
    if not is_client_user(user):
        return False

    if not get_user_client_id(user):
        return False

    return has_any_permission(user, PORTAL_ACCESS_PERMISSION_CODES)


def has_portal_permission(user: dict | None, permission_codes: list[str]) -> bool:
    return can_access_portal(user) and has_any_permission(user, permission_codes)


def can_view_portal_requests(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_REQUEST_VIEW_PERMISSION_CODES)


def can_create_portal_request(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_REQUEST_CREATE_PERMISSION_CODES)


def can_cancel_portal_request(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_REQUEST_CANCEL_PERMISSION_CODES)


def can_view_portal_vehicles(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_VEHICLE_VIEW_PERMISSION_CODES)


def can_view_portal_subclients(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_SUBCLIENT_VIEW_PERMISSION_CODES)


def can_create_portal_subclient(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_SUBCLIENT_CREATE_PERMISSION_CODES)


def can_view_portal_prices(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_PRICE_VIEW_PERMISSION_CODES)


def can_view_portal_installation_settings(user: dict | None) -> bool:
    return has_portal_permission(
        user,
        PORTAL_INSTALLATION_SETTINGS_VIEW_PERMISSION_CODES,
    )


def can_change_own_portal_password(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_PASSWORD_CHANGE_PERMISSION_CODES)


def can_create_portal_comment(user: dict | None) -> bool:
    return has_portal_permission(user, PORTAL_COMMENT_CREATE_PERMISSION_CODES)

# ============================================================================
# Обязательность VIN по клиенту.
#
# Смысл настройки: VIN не становится необязательным, он становится
# обязательным ПОЗЖЕ. Клиент вроде ФортеБанка на момент создания заявки
# VIN не знает — машину показывает поставщик уже монтажнику. Но завершить
# работы без VIN нельзя никому: проверка стоит в /requests/{id}/complete.
# ============================================================================

VEHICLE_VIN_FILL_PERMISSION_CODES = [
    "vehicles.vin.fill",
    "vehicles.manage",
]


def can_fill_vehicle_vin(user: dict | None) -> bool:
    """
    Право вписать недостающий VIN.

    Само право не разрешает менять уже указанный VIN и не открывает
    чужие заявки — это проверяет роутер. Здесь только «есть ли право
    вообще» и «это сотрудник».

    Клиентская учётка сюда не попадает никогда: VIN — это то, чего
    клиент как раз и не знает, а если бы знал, вписал бы при создании.
    """
    if not is_employee_user(user):
        return False

    return has_any_permission(user, VEHICLE_VIN_FILL_PERMISSION_CODES)


def client_vin_is_required(cursor, client_id: int | None) -> bool:
    """
    Обязателен ли VIN при создании заявки для этого клиента.

    Правило наследования и поведение при отсутствии параметров —
    в client_installation_flag_is_enabled: оно общее для всех настроек
    «что клиент обязан указать», и второй его копии быть не должно.
    """
    return client_installation_flag_is_enabled(cursor, client_id, "vin_required")


def vehicle_vin_is_empty(vehicle: dict | None) -> bool:
    """
    Пустой VIN — это NULL или строка из пробелов.

    Одна функция на все проверки: в vehicles.vin ровно эти два варианта
    и означают «ещё не знаем». Подставных значений там нет и быть
    не должно — уникальный индекс на active_vin их не переживёт.
    """
    if not vehicle:
        return True

    return not str(vehicle.get("vin") or "").strip()


def find_request_vehicles_without_vin(cursor, request_id: int) -> list[dict]:
    """
    Машины заявки, у которых VIN не указан.

    Нужна и при завершении работ, и при привязке оборудования, поэтому
    лежит рядом с правилом, а не в одном из роутеров.
    """
    cursor.execute(
        """
        SELECT
            rv.id AS request_vehicle_id,
            v.id AS vehicle_id,
            v.brand,
            v.model,
            v.plate_number,
            v.vin
        FROM request_vehicles rv
        INNER JOIN vehicles v ON v.id = rv.vehicle_id
        WHERE rv.request_id = %s
          AND (v.vin IS NULL OR TRIM(v.vin) = '')
        ORDER BY rv.id ASC
        """,
        (int(request_id),),
    )

    return cursor.fetchall() or []


def describe_vehicle_without_vin(vehicle: dict, index: int | None = None) -> str:
    """
    Как назвать машину без VIN в сообщении об ошибке.

    Госномера у такой машины обычно тоже нет — остаются марка, модель
    и порядковый номер в заявке. Этого достаточно, чтобы монтажник понял,
    о какой из трёх одинаковых Camry идёт речь.
    """
    title = f"{vehicle.get('brand') or ''} {vehicle.get('model') or ''}".strip()
    plate = str(vehicle.get("plate_number") or "").strip()

    parts = []

    if index is not None:
        parts.append(f"авто {index}")

    if title:
        parts.append(title)

    if plate:
        parts.append(plate)

    return " · ".join(parts) or "автомобиль"

# ============================================================================
# Настройки договора, которые решают, что клиент ОБЯЗАН указать при создании
# заявки.
#
# Таких настроек уже две — vin_required и schedule_time_required, — и правило
# наследования у них одно: берём параметры ближайшего по цепочке клиента,
# У КОТОРОГО ОНИ ЗАДАНЫ, и читаем нужную колонку. Не «ближайшего, где галочка
# снята»: иначе настройка деда перебивала бы настройку отца.
#
# Отсутствие параметров где-либо по цепочке означает «требуется». Молчание —
# это «как у всех», а не разрешение пропустить поле.
# ============================================================================

# Белый список: имя колонки подставляется в SQL, и приходить снаружи оно
# не должно никогда.
CLIENT_INSTALLATION_FLAG_COLUMNS = {
    "vin_required",
    "schedule_time_required",
}


def client_installation_flag_is_enabled(cursor, client_id: int | None, column: str) -> bool:
    """
    Значение флага параметров установки с учётом наследования по дереву.

    Возвращает True, если параметров нет нигде по цепочке.
    """
    if column not in CLIENT_INSTALLATION_FLAG_COLUMNS:
        raise ValueError(f"Неизвестная настройка параметров установки: {column}")

    if not client_id:
        return True

    cursor.execute(
        f"""
        WITH RECURSIVE client_chain AS (
            SELECT
                c.id,
                c.parent_client_id,
                0 AS depth
            FROM clients c
            WHERE c.id = %s

            UNION ALL

            SELECT
                p.id,
                p.parent_client_id,
                chain.depth + 1
            FROM clients p
            INNER JOIN client_chain chain
                ON p.id = chain.parent_client_id
            WHERE p.is_deleted = 0
              AND chain.depth < %s
        )
        SELECT cis.{column} AS flag_value
        FROM client_chain
        INNER JOIN client_installation_settings cis
            ON cis.client_id = client_chain.id
        ORDER BY client_chain.depth ASC
        LIMIT 1
        """,
        (int(client_id), CLIENT_PORTAL_TREE_MAX_DEPTH),
    )

    row = cursor.fetchone()

    if not row:
        return True

    return to_bool(row.get("flag_value"))


def client_schedule_time_is_required(cursor, client_id: int | None) -> bool:
    """
    Выбирает ли клиент время работ сам.

    False означает не «время не нужно», а «время не спрашиваем у клиента»:
    оно подставляется ближайшим рабочим слотом при создании заявки.
    Календарь и сортировка продолжают работать на этом времени.
    """
    return client_installation_flag_is_enabled(
        cursor,
        client_id,
        "schedule_time_required",
    )