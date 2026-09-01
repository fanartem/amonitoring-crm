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


def get_user_base_access(cursor, user_id: int) -> dict | None:
    """
    Возвращает актуального пользователя + данные роли + security flags.
    Это будет использоваться в get_current_user().
    """
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
            COALESCE(usf.is_owner, 0) AS is_owner
        FROM users u
        LEFT JOIN roles r ON r.code = u.role
        LEFT JOIN user_security_flags usf ON usf.user_id = u.id
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
