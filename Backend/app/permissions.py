# Backend/app/permissions.py

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


def get_role(user: dict | None) -> str | None:
    if not user:
        return None

    return user.get("role")


def is_admin(user: dict) -> bool:
    return get_role(user) == ADMIN


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
    """
    Видят все заявки:
    - ADMIN
    - ROP
    - SENIOR_TECHNICIAN
    - WAREHOUSE_MANAGER
    """
    return get_role(user) in [ADMIN, ROP, SENIOR_TECHNICIAN, WAREHOUSE_MANAGER]


def can_create_request(user: dict) -> bool:
    """
    Создавать заявки могут:
    - ADMIN
    - ROP
    - MANAGER
    - TECH_SUPPORT
    """
    return get_role(user) in [ADMIN, ROP, MANAGER, TECH_SUPPORT]


def can_edit_all_requests(user: dict) -> bool:
    """
    Редактировать все заявки могут:
    - ADMIN
    - ROP
    """
    return get_role(user) in [ADMIN, ROP]


def can_edit_payment_info(user: dict) -> bool:
    """
    Редактировать информацию об оплате (total_price, price_lines, is_paid, paid_at) могут:
    - ADMIN
    - ROP
    - ACCOUNTANT
    """
    return get_role(user) in [ADMIN, ROP, ACCOUNTANT]


def can_change_request_status(user: dict) -> bool:
    """
    Менять статусы заявок могут:
    - ADMIN
    - ROP
    - SENIOR_TECHNICIAN
    """
    return get_role(user) in [ADMIN, ROP, SENIOR_TECHNICIAN]


def can_delete_any_request(user: dict) -> bool:
    """
    Удалять любую заявку могут:
    - ADMIN
    - ROP
    """
    return get_role(user) in [ADMIN, ROP]


def can_delete_own_request_with_time_limit(user: dict) -> bool:
    """
    Менеджер и техподдержка могут удалить свою заявку
    только в течение 2 минут после создания.
    """
    return get_role(user) in [MANAGER, TECH_SUPPORT]


def can_view_clients_tab(user: dict) -> bool:
    """
    Вкладка Клиенты запрещена обычному монтажнику.
    """
    return get_role(user) not in [TECHNICIAN]


def can_view_all_client_details(user: dict) -> bool:
    """
    Видят детали всех клиентов:
    - ADMIN
    - ROP
    - TECH_SUPPORT
    - ACCOUNTANT
    - WAREHOUSE_MANAGER пока оставляем как было, если он имел доступ
    """
    return get_role(user) in [
        ADMIN,
        ROP,
        TECH_SUPPORT,
        ACCOUNTANT,
        WAREHOUSE_MANAGER,
    ]


def can_edit_all_clients(user: dict) -> bool:
    """
    Редактировать всех клиентов могут:
    - ADMIN
    - ROP
    """
    return get_role(user) in [ADMIN, ROP]


def can_change_client_status(user: dict) -> bool:
    """
    Менять статус клиента могут:
    - ADMIN
    - ROP
    - ACCOUNTANT
    """
    return get_role(user) in [ADMIN, ROP, ACCOUNTANT]


def can_reassign_clients(user: dict) -> bool:
    """
    Переназначать ответственного менеджера могут:
    - ADMIN
    - ROP
    """
    return get_role(user) in [ADMIN, ROP]


def can_view_prices(user: dict) -> bool:
    """
    Видеть цены могут:
    - ADMIN
    - ROP
    - MANAGER
    - TECH_SUPPORT
    - ACCOUNTANT

    Монтажники цены не видят.
    """
    return get_role(user) in [
        ADMIN,
        ROP,
        MANAGER,
        TECH_SUPPORT,
        ACCOUNTANT,
    ]


def can_manage_base_prices(user: dict) -> bool:
    """
    Управлять базовыми ценами могут:
    - ADMIN
    - ROP
    """
    return get_role(user) in [ADMIN, ROP]


def can_manage_any_client_prices(user: dict) -> bool:
    """
    Управлять индивидуальными ценами любого клиента могут:
    - ADMIN
    - ROP
    """
    return get_role(user) in [ADMIN, ROP]


def can_manage_own_client_prices(user: dict) -> bool:
    """
    Менеджер может управлять индивидуальными ценами только своих клиентов.
    """
    return get_role(user) == MANAGER


def can_view_warehouse(user: dict) -> bool:
    """
    Склад не видит TECH_SUPPORT.
    Обычная текущая логика склада:
    ADMIN, WAREHOUSE_MANAGER, MANAGER, SENIOR_TECHNICIAN, TECHNICIAN.
    """
    return get_role(user) in [
        ADMIN,
        WAREHOUSE_MANAGER,
        MANAGER,
        SENIOR_TECHNICIAN,
        TECHNICIAN,
    ]


def can_manage_warehouse(user: dict) -> bool:
    return get_role(user) in [ADMIN, WAREHOUSE_MANAGER]


def can_view_price_fields(user: dict) -> bool:
    """
    Для скрытия total_price, price_lines, is_paid, paid_at.
    """
    return not is_any_technician(user)


def can_view_attachment(attachment: dict, current_user: dict) -> bool:
    """
    Файлы:
    - ADMIN / ROP / MANAGER / ACCOUNTANT / WAREHOUSE_MANAGER / TECH_SUPPORT видят все.
    - TECHNICIAN видит только свои.
    - SENIOR_TECHNICIAN видит файлы TECHNICIAN и SENIOR_TECHNICIAN.
      Для этого attachment должен содержать uploaded_by_role.
    """
    role = get_role(current_user)

    if role in [ADMIN, ROP, MANAGER, ACCOUNTANT, WAREHOUSE_MANAGER, TECH_SUPPORT]:
        return True

    if role == TECHNICIAN:
        return (
            attachment.get("uploaded_by") is not None
            and int(attachment["uploaded_by"]) == int(current_user["id"])
        )

    if role == SENIOR_TECHNICIAN:
        uploaded_by_role = attachment.get("uploaded_by_role")

        return uploaded_by_role in [TECHNICIAN, SENIOR_TECHNICIAN]

    return False


def can_delete_attachment(attachment: dict, current_user: dict, within_time_limit: bool) -> bool:
    """
    Удаление файлов:
    - ADMIN / ROP могут удалять все.
    - Остальные могут удалить только свой файл и только в течение 2 минут.
    """
    role = get_role(current_user)

    if role in [ADMIN, ROP]:
        return True

    is_owner = (
        attachment.get("uploaded_by") is not None
        and int(attachment["uploaded_by"]) == int(current_user["id"])
    )

    return is_owner and within_time_limit


def is_valid_client_status(status: str) -> bool:
    return status in CLIENT_STATUSES


def is_client_owned_by_user(client: dict, current_user: dict) -> bool:
    """
    Клиент считается своим для менеджера, если:
    - responsible_manager_id = current_user.id
    - или created_by = current_user.id
    """
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

    if role == MANAGER:
        return is_client_owned_by_user(client, current_user)

    return False


def can_edit_client(client: dict, current_user: dict) -> bool:
    role = get_role(current_user)

    if can_edit_all_clients(current_user):
        return True

    if role == MANAGER:
        return is_client_owned_by_user(client, current_user)

    return False


def can_create_request_for_client(client: dict, current_user: dict) -> bool:
    """
    Проверка клиента перед созданием заявки.
    BLOCKED запрещён всем.
    DEBTOR разрешён, но frontend покажет предупреждение.
    """
    if client.get("status") == "BLOCKED":
        return False

    role = get_role(current_user)

    if role in [ADMIN, ROP, TECH_SUPPORT]:
        return True

    if role == MANAGER:
        return is_client_owned_by_user(client, current_user)

    return False