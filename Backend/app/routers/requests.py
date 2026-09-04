import re

from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_connection
from app.schemas import (
    RequestCreate,
    RequestUpdate,
    AssignRequest,
    RequestExecutorsAssign,
    CommentCreate,
    RequestScheduleApproval,
)
from app.security import get_current_user

from app.routers.prices import resolve_request_price_lines
from app.permissions import (
    DATA_SCOPE_ALL,
    DATA_SCOPE_CITY,
    DATA_SCOPE_RESPONSIBLE_CLIENTS,
    DATA_SCOPE_ASSIGNED,
    DATA_SCOPE_CITY_ASSIGNED,
    DATA_SCOPE_OWN,
    DATA_SCOPE_NONE,
    DATA_SCOPE_CLIENT,
    get_data_scope,
    has_any_permission,
    is_super_admin,
    can_view_all_requests,
    can_create_request,
    can_edit_all_requests,
    can_edit_payment_info,
    can_change_request_status,
    can_manage_request_executors,
    can_delete_any_request,
    can_delete_own_request_with_time_limit,
    can_view_price_fields,
    can_create_request_for_client,
    is_client_owned_by_user,
    is_client_user,
    get_user_client_id,
    can_view_portal_requests,
    can_view_portal_prices,
    can_cancel_portal_request,
    can_create_portal_comment,
    can_view_portal_subclients,
    get_client_branch_ids,

    # Настраиваемая обязательность VIN. Правило и помощники живут
    # в permissions.py: тот же вопрос задают portal_requests.py,
    # vehicles.py и warehouse.py, ответ у всех обязан быть один.
    can_fill_vehicle_vin,
    client_vin_is_required,
    describe_vehicle_without_vin,
    find_request_vehicles_without_vin,

    # Настраиваемая видимость выбора времени. Правило наследования там же,
    # где и у VIN: один вопрос — один ответ на всю систему.
    client_schedule_time_is_required,
)

# Правило «кто может править машины этого клиента» живёт в vehicles.py
# вместе с самими эндпоинтами машин. Импорт односторонний: vehicles.py
# роутеры не импортирует, кольца не будет.
from app.routers.vehicles import can_edit_vehicle_for_client

from datetime import datetime, time, timezone, timedelta
from app.notification_service import (
    notify_new_request,
    notify_request_status_changed,
    notify_request_assigned,
    notify_request_self_accepted,
    notify_request_payment_changed,
    notify_request_executors_assigned,
    notify_request_time_conflict,

    # Уведомления кабинета. Отдельные функции, а не флаг в существующих:
    # у клиента другие получатели, другие тексты и другой набор событий.
    notify_portal_request_created,
    notify_portal_request_status_changed,
    notify_portal_request_updated,
    notify_portal_request_executors,
    notify_portal_request_schedule_approval,
    notify_portal_request_comment,
    notify_portal_request_cancelled,
)

router = APIRouter(prefix="/requests", tags=["Requests"])

REQUEST_DELETE_TIME_LIMIT_SECONDS = 120

WORK_DAY_START = time(10, 0)
WORK_DAY_END = time(17, 30)

SCHEDULE_TIME_START = time(8, 0)
SCHEDULE_TIME_END = time(20, 0)

SCHEDULE_APPROVAL_NOT_REQUIRED = "NOT_REQUIRED"
SCHEDULE_APPROVAL_PENDING = "PENDING"
SCHEDULE_APPROVAL_APPROVED = "APPROVED"
SCHEDULE_APPROVAL_REJECTED = "REJECTED"

CLIENT_PAYMENT_PREPAYMENT = "PREPAYMENT"
CLIENT_PAYMENT_POSTPAYMENT = "POSTPAYMENT"

# Та же глубина, что и в clients.py. Реальная иерархия после миграции
# 2026_09_02_client_parent_id имеет глубину 2, запас — страховка от кольца.
CLIENT_TREE_MAX_DEPTH = 10

ALMATY_TZ = timezone(timedelta(hours=5))

VISIT_PRICE_CODE_CITY = "ON_SITE_CITY"
VISIT_PRICE_CODE_OUTSIDE_CITY = "ON_SITE_OUTSIDE_CITY"
VISIT_PRICE_CODE_BUSINESS_TRIP = "BUSINESS_TRIP_KM"

ALLOWED_VISIT_PRICE_CODES = {
    VISIT_PRICE_CODE_CITY,
    VISIT_PRICE_CODE_OUTSIDE_CITY,
    VISIT_PRICE_CODE_BUSINESS_TRIP,
}

VISIT_MINIMUM_LEAD_MINUTES = {
    VISIT_PRICE_CODE_CITY: 25,
    VISIT_PRICE_CODE_OUTSIDE_CITY: 120,
    VISIT_PRICE_CODE_BUSINESS_TRIP: 300,
}

# requests.manage и requests.edit_responsible в таблице permissions
# отсутствуют — проверки с ними не срабатывали ни разу.
# Оставшиеся синонимы в каталоге есть и работают; они уйдут вместе
# с чисткой дублей в базе.

REQUEST_VIEW_ALL_PERMISSION_CODES = [
    "requests.view_all",
]

REQUEST_VIEW_PERMISSION_CODES = [
    "requests.view",
]

REQUEST_EDIT_OWN_PERMISSION_CODES = [
    "requests.edit_own",
]

REQUEST_SCHEDULE_BYPASS_PERMISSION_CODES = [
    "requests.schedule.bypass",
    "requests.schedule.bypass_limits",
]

REQUEST_SCHEDULE_APPROVAL_DECIDE_PERMISSION_CODES = [
    "requests.schedule_approval.decide",
    "requests.schedule.approve",
]

REQUEST_STATUS_OVERRIDE_PERMISSION_CODES = [
    "requests.status.override",
    "requests.status.override_transitions",
]

REQUEST_RESTORE_PERMISSION_CODES = [
    "requests.restore",
]

REQUEST_TRASH_VIEW_PERMISSION_CODES = [
    "requests.deleted.view",
]

REQUEST_COMPLETE_ANY_PERMISSION_CODES = [
    "requests.complete_any",
]

REQUEST_COMPLETE_ASSIGNED_PERMISSION_CODES = [
    "requests.complete_own",
]

REQUEST_COMMENT_PERMISSION_CODES = [
    "requests.comments.create",
    "requests.comments.manage",
]

CALENDAR_VIEW_PERMISSION_CODES = [
    "calendar.view",
    "requests.calendar.view",
]

CALENDAR_VIEW_ALL_PERMISSION_CODES = [
    "calendar.view_all",
    "requests.calendar.view_all",
]


def to_bool(value) -> bool:
    if isinstance(value, bool):
        return value

    if value is None:
        return False

    if isinstance(value, (int, float)):
        return value != 0

    return str(value).strip().lower() in ["1", "true", "yes", "y", "да"]


def user_has_any_permission(current_user: dict | None, permission_codes: list[str]) -> bool:
    return is_super_admin(current_user) or has_any_permission(current_user, permission_codes)


def user_can_bypass_schedule_rules(current_user: dict) -> bool:
    return user_has_any_permission(current_user, REQUEST_SCHEDULE_BYPASS_PERMISSION_CODES)


def user_can_decide_schedule_approval(current_user: dict) -> bool:
    return user_has_any_permission(current_user, REQUEST_SCHEDULE_APPROVAL_DECIDE_PERMISSION_CODES)


def user_can_override_request_status_transitions(current_user: dict) -> bool:
    return user_has_any_permission(current_user, REQUEST_STATUS_OVERRIDE_PERMISSION_CODES)


def user_can_view_deleted_requests(current_user: dict) -> bool:
    # Корзина — внутренний инструмент: там лежат заявки всех клиентов
    # и причины удаления. Клиенту она закрыта независимо от прав.
    if is_client_user(current_user):
        return False

    return user_has_any_permission(current_user, REQUEST_TRASH_VIEW_PERMISSION_CODES)


def user_can_restore_deleted_requests(current_user: dict) -> bool:
    return user_has_any_permission(current_user, REQUEST_RESTORE_PERMISSION_CODES)


def user_can_view_all_request_rows(current_user: dict) -> bool:
    return (
        can_view_all_requests(current_user)
        or user_has_any_permission(current_user, REQUEST_VIEW_ALL_PERMISSION_CODES)
    )


def get_effective_request_data_scope(current_user: dict) -> str:
    """
    Возвращает область строк заявок для пользователя.

    Базовое право requests.view открывает модуль, а data_scope роли определяет,
    какие именно заявки доступны. requests.view_all остаётся явным обходом
    ограничения области данных.
    """
    # Клиентская учётка разбирается ПЕРВОЙ, до всех прав сотрудников.
    # Порядок тот же, что в users.py и в access.js: сначала тип учётки,
    # потом права. Иначе случайно выданное requests.view_all открыло бы
    # клиенту все заявки CRM.
    if is_client_user(current_user):
        if not get_user_client_id(current_user):
            return DATA_SCOPE_NONE

        if not can_view_portal_requests(current_user):
            return DATA_SCOPE_NONE

        return DATA_SCOPE_CLIENT

    if user_can_view_all_request_rows(current_user):
        return DATA_SCOPE_ALL

    if user_has_any_permission(current_user, REQUEST_VIEW_PERMISSION_CODES):
        scope = str(get_data_scope(current_user) or DATA_SCOPE_NONE).upper()

        if scope in {
            DATA_SCOPE_ALL,
            DATA_SCOPE_CITY,
            DATA_SCOPE_RESPONSIBLE_CLIENTS,
            DATA_SCOPE_ASSIGNED,
            DATA_SCOPE_CITY_ASSIGNED,
            DATA_SCOPE_OWN,
            DATA_SCOPE_NONE,
        }:
            return scope

    return DATA_SCOPE_NONE


def get_responsible_client_scope_ids(cursor, user_id: int) -> tuple[set[int], set[int]]:
    """
    Клиенты области RESPONSIBLE_CLIENTS.

    Возвращает две группы:
    - свои клиенты: пользователь ответственный или создатель;
    - вся ветка: свои клиенты плюс их подклиенты по parent_client_id.

    Ветка нужна для варианта Б: кто ведёт родителя, видит заявки
    подклиентов. Редактирование при этом остаётся у тех, кто относится
    к заявке напрямую.
    """
    cursor.execute(
        """
        SELECT id
        FROM clients
        WHERE is_deleted = 0
          AND (responsible_manager_id = %s OR created_by = %s)
        """,
        (user_id, user_id),
    )

    direct_client_ids = {int(row["id"]) for row in (cursor.fetchall() or [])}

    if not direct_client_ids:
        return set(), set()

    cursor.execute(
        """
        WITH RECURSIVE own_clients AS (
            SELECT
                c.id,
                0 AS depth
            FROM clients c
            WHERE c.is_deleted = 0
              AND (c.responsible_manager_id = %s OR c.created_by = %s)

            UNION ALL

            SELECT
                child.id,
                own.depth + 1
            FROM clients child
            INNER JOIN own_clients own
                ON child.parent_client_id = own.id
            WHERE child.is_deleted = 0
              AND own.depth < %s
        )
        SELECT DISTINCT id
        FROM own_clients
        """,
        (user_id, user_id, CLIENT_TREE_MAX_DEPTH),
    )

    branch_client_ids = {int(row["id"]) for row in (cursor.fetchall() or [])}
    branch_client_ids |= direct_client_ids

    return direct_client_ids, branch_client_ids


def get_client_portal_scope_ids(cursor, client_id: int | None) -> set[int]:
    """
    Клиент кабинета и вся его ветка подклиентов.

    Направление обратное get_responsible_client_scope_ids: там мы шли
    от пользователя к его клиентам, здесь — от клиента вниз по дереву.
    Клиенты в корзине в ветку не попадают: их карточек фактически нет.

    Глубина ограничена CLIENT_TREE_MAX_DEPTH — та же страховка от кольца
    в данных, что и в остальных обходах дерева.
    """
    return get_client_branch_ids(cursor, client_id)


def get_client_portal_user_ids(cursor, client_id: int | None) -> set[int]:
    """
    Учётные записи кабинета этого клиента.

    Нужны, чтобы отличить заявку, заведённую из кабинета, от заявки,
    которую оформил наш менеджер. Первую клиент может отменить сам,
    вторую — только через менеджера.

    Удалённые учётки тоже считаем своими: заявка, созданная уволившимся
    сотрудником клиента, всё равно заведена этим клиентом.
    """
    if not client_id:
        return set()

    cursor.execute(
        """
        SELECT id
        FROM users
        WHERE user_kind = 'CLIENT'
          AND client_id = %s
        """,
        (int(client_id),),
    )

    return {int(row["id"]) for row in (cursor.fetchall() or [])}


def build_request_access_context(cursor, current_user: dict) -> dict:
    """
    Всё, что нужно знать про доступ пользователя к заявкам, одним объектом.

    Считается один раз на запрос, чтобы не дёргать город и дерево клиентов
    в цикле по заявкам.
    """
    scope = get_effective_request_data_scope(current_user)

    context = {
        "scope": scope,
        "user_city": None,
        "direct_client_ids": set(),
        "branch_client_ids": set(),
        "portal_user_ids": set(),
    }

    if scope in [DATA_SCOPE_CITY, DATA_SCOPE_ASSIGNED, DATA_SCOPE_CITY_ASSIGNED]:
        context["user_city"] = get_current_user_city(cursor, current_user)

    elif scope == DATA_SCOPE_RESPONSIBLE_CLIENTS:
        direct_client_ids, branch_client_ids = get_responsible_client_scope_ids(
            cursor,
            int(current_user["id"]),
        )

        context["direct_client_ids"] = direct_client_ids
        context["branch_client_ids"] = branch_client_ids

    elif scope == DATA_SCOPE_CLIENT:
        client_id = get_user_client_id(current_user)

        # direct — заявки своего клиента, branch — плюс его подклиенты.
        # Разделение нужно там же, где и у сотрудников: смотреть можно
        # всю ветку, действовать — только по своему клиенту.
        context["direct_client_ids"] = {int(client_id)} if client_id else set()

        # Решение Р22(Б): без права «Портал: просмотр подклиентов»
        # кабинет ограничен своей организацией. Вторая и последняя точка,
        # где это решается — первая в portal.py.
        if client_id and can_view_portal_subclients(current_user):
            context["branch_client_ids"] = get_client_portal_scope_ids(
                cursor,
                client_id,
            )
        else:
            context["branch_client_ids"] = set(context["direct_client_ids"])

        context["portal_user_ids"] = get_client_portal_user_ids(cursor, client_id)

    return context


def find_blocking_client(cursor, client_id: int) -> dict | None:
    """
    Ближайший заблокированный клиент в цепочке «сам клиент → родители».

    Блокировка наследуется вниз: заблокированный родитель закрывает
    создание заявок всей ветке.
    """
    cursor.execute(
        """
        WITH RECURSIVE client_chain AS (
            SELECT
                c.id,
                c.parent_client_id,
                c.name,
                c.company_name,
                c.status,
                0 AS depth
            FROM clients c
            WHERE c.id = %s

            UNION ALL

            SELECT
                p.id,
                p.parent_client_id,
                p.name,
                p.company_name,
                p.status,
                chain.depth + 1
            FROM clients p
            INNER JOIN client_chain chain
                ON p.id = chain.parent_client_id
            WHERE p.is_deleted = 0
              AND chain.depth < %s
        )
        SELECT id, name, company_name, status, depth
        FROM client_chain
        WHERE status = 'BLOCKED'
        ORDER BY depth ASC
        LIMIT 1
        """,
        (client_id, CLIENT_TREE_MAX_DEPTH),
    )

    return cursor.fetchone()


def ensure_client_branch_not_blocked(cursor, client_id: int):
    blocking_client = find_blocking_client(cursor, client_id)

    if not blocking_client:
        return

    if int(blocking_client["depth"]) == 0:
        raise HTTPException(
            status_code=403,
            detail="Нельзя создать заявку для заблокированного клиента",
        )

    blocking_client_name = (
        blocking_client.get("company_name")
        or blocking_client.get("name")
        or f"ID {blocking_client.get('id')}"
    )

    raise HTTPException(
        status_code=403,
        detail=(
            "Нельзя создать заявку: заблокирован родительский клиент "
            f"«{blocking_client_name}»"
        ),
    )


def user_can_edit_own_or_responsible_request(current_user: dict, request: dict) -> bool:
    if not user_has_any_permission(current_user, REQUEST_EDIT_OWN_PERMISSION_CODES):
        return False

    return is_client_owned_by_user(
        {
            "created_by": request.get("created_by"),
            "responsible_manager_id": request.get("responsible_manager_id"),
        },
        current_user,
    )


def user_can_self_accept_requests(current_user: dict) -> bool:
    if not to_bool(current_user.get("can_be_request_executor")):
        return False

    scope = get_effective_request_data_scope(current_user)

    return scope in [DATA_SCOPE_ALL, DATA_SCOPE_CITY_ASSIGNED]


def user_can_complete_any_request(current_user: dict) -> bool:
    return user_has_any_permission(current_user, REQUEST_COMPLETE_ANY_PERMISSION_CODES)


def user_can_complete_assigned_request(current_user: dict) -> bool:
    return user_has_any_permission(current_user, REQUEST_COMPLETE_ASSIGNED_PERMISSION_CODES)


def user_can_comment_requests(current_user: dict) -> bool:
    # У клиента своё право: комментарии — общая лента, но открывать её
    # на запись должно отдельное портальное право, а не requests.comments.*,
    # которое даёт доступ к комментариям вообще всех заявок.
    if is_client_user(current_user):
        return can_create_portal_comment(current_user)

    return user_has_any_permission(current_user, REQUEST_COMMENT_PERMISSION_CODES)


def user_can_view_calendar(current_user: dict) -> bool:
    # Календарь показывает загрузку монтажников по всем клиентам —
    # это внутреннее расписание компании.
    if is_client_user(current_user):
        return False

    return user_has_any_permission(current_user, CALENDAR_VIEW_PERMISSION_CODES)


def user_can_view_all_calendar(current_user: dict) -> bool:
    return user_has_any_permission(current_user, CALENDAR_VIEW_ALL_PERMISSION_CODES)


def user_is_limited_executor(current_user: dict) -> bool:
    return get_effective_request_data_scope(current_user) in [
        DATA_SCOPE_ASSIGNED,
        DATA_SCOPE_CITY_ASSIGNED,
    ]


def almaty_now():
    return datetime.now(ALMATY_TZ).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Помощники для уведомлений кабинета.
#
# Тексты клиенту собираются здесь, а не в notification_service: только
# роутер знает, какое поле заявки клиенту показывают, а какое нет.
# Сервис принимает готовые строки и ничего не достаёт из БД сам —
# иначе однажды в колокольчик уедет то, что скрыто в карточке.
# ---------------------------------------------------------------------------

PORTAL_VISIT_TYPE_LABELS = {
    "IN_OFFICE": "в офисе",
    "ON_SITE": "выезд к клиенту",
}

PORTAL_VISIT_PRICE_LABELS = {
    VISIT_PRICE_CODE_CITY: "по городу",
    VISIT_PRICE_CODE_OUTSIDE_CITY: "за городом",
    VISIT_PRICE_CODE_BUSINESS_TRIP: "командировка",
}


def get_portal_client_name(cursor, client_id) -> str | None:
    """
    Название организации для подписи в уведомлении.

    Нужно получателям из головной организации: у них в колокольчике
    заявки нескольких подклиентов, и без названия непонятно, чья это.
    """
    if not client_id:
        return None

    cursor.execute(
        """
        SELECT name, company_name
        FROM clients
        WHERE id = %s
        LIMIT 1
        """,
        (int(client_id),),
    )

    row = cursor.fetchone()

    if not row:
        return None

    return row.get("company_name") or row.get("name")


def format_portal_value(value) -> str:
    if value is None:
        return "не указано"

    if isinstance(value, datetime):
        return value.strftime("%d.%m.%Y %H:%M")

    text = str(value).strip()

    return text or "не указано"


def get_request_delete_seconds_left(request: dict) -> int:
    """
    Сколько секунд ещё можно удалить свою заявку.

    Источник правды для фронта: раньше окно было продублировано
    константой в NewRequestNotice.jsx и могло разойтись с сервером.
    """
    created_at = request.get("created_at")

    if not created_at:
        return 0

    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at)
        except ValueError:
            return 0

    created_at = created_at.replace(tzinfo=None)
    elapsed_seconds = (almaty_now() - created_at).total_seconds()

    return max(0, int(REQUEST_DELETE_TIME_LIMIT_SECONDS - elapsed_seconds))

def resolve_request_contact(
    contact_name: str | None,
    contact_phone: str | None,
    client: dict | None,
) -> tuple[str | None, str | None]:
    """
    Контактное лицо заявки: кого встречает монтажник.

    Отдельная пара полей у заявки, а не ссылка на карточку клиента.
    В карточке клиента обычно сидит бухгалтер или директор, а на объекте
    монтажника встречает водитель или завгар — и у каждой заявки он свой.

    Пусто пришло — подставляем контакт клиента. Обязательность живёт
    в интерфейсе, где её можно объяснить человеку; сервер отвечает лишь
    за то, чтобы поле не осталось пустым. Значение сохраняется как СНИМОК:
    сменится телефон в карточке клиента — в старых заявках останется тот,
    по которому реально договаривались.
    """
    name = str(contact_name or "").strip()
    phone = str(contact_phone or "").strip()

    if not name:
        name = str((client or {}).get("name") or "").strip()

    if not phone:
        phone = str((client or {}).get("phone") or "").strip()

    return name or None, phone or None


def normalize_scheduled_at(value: datetime | None):
    if value is None:
        return None

    return value.replace(tzinfo=None)


def normalize_visit_price_code(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = str(value).strip().upper()
    return normalized or None


def get_visit_price_codes_from_price_input(price) -> set[str]:
    if not price or not price.lines:
        return set()

    return {
        normalized
        for line in price.lines
        if (normalized := normalize_visit_price_code(line.code))
        in ALLOWED_VISIT_PRICE_CODES
    }


def resolve_visit_price_code(
    visit_type: str,
    requested_code: str | None,
    price=None,
) -> str | None:
    price_codes = get_visit_price_codes_from_price_input(price)

    if len(price_codes) > 1:
        raise HTTPException(
            status_code=400,
            detail="В расчёте указано несколько разных типов выезда",
        )

    if visit_type == "IN_OFFICE":
        if price_codes:
            raise HTTPException(
                status_code=400,
                detail="Для работы в офисе нельзя указывать транспортные расходы",
            )
        return None

    normalized_code = normalize_visit_price_code(requested_code)

    if normalized_code is not None:
        if normalized_code not in ALLOWED_VISIT_PRICE_CODES:
            raise HTTPException(status_code=400, detail="Некорректный тип выезда")

        if price_codes and normalized_code not in price_codes:
            raise HTTPException(
                status_code=400,
                detail="Тип выезда не совпадает с транспортной строкой расчёта",
            )

        return normalized_code

    # Совместимость со старым frontend: до появления отдельного поля тип
    # выезда сохранялся только в строках калькулятора.
    if price_codes:
        return next(iter(price_codes))

    # Старый калькулятор использовал городской выезд по умолчанию.
    return VISIT_PRICE_CODE_CITY


def ceil_to_half_hour(value: datetime) -> datetime:
    value = value.replace(second=0, microsecond=0)

    if value.minute == 0 or value.minute == 30:
        return value

    minutes_to_add = 30 - (value.minute % 30)
    return value + timedelta(minutes=minutes_to_add)


def get_next_available_schedule_slot(value: datetime) -> datetime:
    slot = ceil_to_half_hour(value)
    slot_time = slot.time()

    if slot_time < SCHEDULE_TIME_START:
        return slot.replace(
            hour=SCHEDULE_TIME_START.hour,
            minute=SCHEDULE_TIME_START.minute,
            second=0,
            microsecond=0,
        )

    if slot_time > SCHEDULE_TIME_END:
        next_day = slot + timedelta(days=1)
        return next_day.replace(
            hour=SCHEDULE_TIME_START.hour,
            minute=SCHEDULE_TIME_START.minute,
            second=0,
            microsecond=0,
        )

    return slot


def validate_request_schedule(
    *,
    scheduled_at: datetime,
    visit_type: str,
    visit_price_code: str | None,
    current_user: dict,
):
    if scheduled_at.minute not in (0, 30) or scheduled_at.second != 0 or scheduled_at.microsecond != 0:
        raise HTTPException(
            status_code=400,
            detail="Время можно выбирать только с минутами 00 или 30",
        )

    scheduled_time = scheduled_at.time()

    if scheduled_time < SCHEDULE_TIME_START or scheduled_time > SCHEDULE_TIME_END:
        raise HTTPException(
            status_code=400,
            detail="Время начала работ должно быть в диапазоне с 08:00 до 20:00",
        )

    if visit_type not in ["IN_OFFICE", "ON_SITE"]:
        raise HTTPException(status_code=400, detail="Некорректный формат работ")

    normalized_code = resolve_visit_price_code(visit_type, visit_price_code)

    # Пользователь с правом обхода может назначать заявки в прошлом
    # и обходить минимальный запас. Получасовой шаг и диапазон
    # 08:00–20:00 обязательны для всех.
    if user_can_bypass_schedule_rules(current_user):
        return

    now = almaty_now().replace(second=0, microsecond=0)
    minimum_scheduled_at = now

    if visit_type == "ON_SITE":
        minimum_scheduled_at = now + timedelta(
            minutes=VISIT_MINIMUM_LEAD_MINUTES[normalized_code]
        )

    if scheduled_at < minimum_scheduled_at:
        earliest_slot = get_next_available_schedule_slot(minimum_scheduled_at)

        if visit_type == "IN_OFFICE":
            detail = (
                "Нельзя назначить заявку на прошедшие дату и время. "
                f"Ближайшее доступное время: {earliest_slot.strftime('%d.%m.%Y %H:%M')}"
            )
        else:
            lead_minutes = VISIT_MINIMUM_LEAD_MINUTES[normalized_code]
            if lead_minutes == 25:
                lead_text = "25 минут"
            elif lead_minutes == 120:
                lead_text = "2 часа"
            else:
                lead_text = "5 часов"

            detail = (
                f"Для выбранного типа выезда требуется запас не менее {lead_text}. "
                f"Ближайшее доступное время: {earliest_slot.strftime('%d.%m.%Y %H:%M')}"
            )

        raise HTTPException(status_code=400, detail=detail)


def parse_calendar_date(value: str, field_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Некорректная дата {field_name}. Используйте формат YYYY-MM-DD"
        )

    return parsed.replace(tzinfo=None)


def is_working_schedule_time(value: datetime) -> bool:
    """
    Рабочее время: понедельник-пятница, 10:00–17:30 включительно.
    weekday(): 0 = Monday, 6 = Sunday
    """
    if value.weekday() >= 5:
        return False

    request_time = value.time()

    return WORK_DAY_START <= request_time <= WORK_DAY_END


# Сколько дней вперёд ищем рабочий слот. Четырнадцати хватает
# на любые новогодние выходные; больше — признак ошибки в данных,
# и уезжать в бесконечный цикл из-за неё нельзя.
AUTO_SCHEDULE_MAX_SEARCH_DAYS = 14


def get_next_working_slot(value: datetime) -> datetime:
    """
    Ближайший слот внутри рабочего окна: пн-пт, 10:00-17:30, шаг 30 минут.

    Отличается от get_next_available_schedule_slot тем, к какому окну
    округляет. Та работает по SCHEDULE_TIME_START/END (08:00-20:00) —
    это границы, в которых человеку РАЗРЕШЕНО выбрать время. Здесь
    время выбирает система, и она обязана попасть в рабочее окно:
    иначе build_schedule_approval_data потребует причину согласования,
    а спросить её не у кого — клиент этого поля вообще не видел.
    """
    slot = ceil_to_half_hour(value)

    for _ in range(AUTO_SCHEDULE_MAX_SEARCH_DAYS + 1):
        # Выходной — сразу на утро следующего дня.
        if slot.weekday() >= 5:
            slot = (slot + timedelta(days=1)).replace(
                hour=WORK_DAY_START.hour,
                minute=WORK_DAY_START.minute,
                second=0,
                microsecond=0,
            )
            continue

        slot_time = slot.time()

        # Слишком рано — подтягиваем к началу этого же рабочего дня.
        if slot_time < WORK_DAY_START:
            slot = slot.replace(
                hour=WORK_DAY_START.hour,
                minute=WORK_DAY_START.minute,
                second=0,
                microsecond=0,
            )
            continue

        # Рабочий день кончился — на утро следующего.
        if slot_time > WORK_DAY_END:
            slot = (slot + timedelta(days=1)).replace(
                hour=WORK_DAY_START.hour,
                minute=WORK_DAY_START.minute,
                second=0,
                microsecond=0,
            )
            continue

        return slot

    # Досюда доходим только при испорченных константах рабочего дня.
    return slot


def resolve_auto_scheduled_at(
    visit_type: str,
    visit_price_code: str | None,
) -> datetime:
    """
    Время работ для клиента, который его не выбирает.

    Считается ровно по тому же правилу, которое видит менеджер в CRM:
    «сейчас плюс запас на дорогу», округлённое вверх до получаса. Запас
    берётся из VISIT_MINIMUM_LEAD_MINUTES — 25 минут по городу, 2 часа
    за городом, 5 часов на командировку. В офис ехать не нужно, там
    запас нулевой.

    Дальше результат подтягивается в рабочее окно. Примеры:
      создано в 11:00 по городу  -> сегодня 11:30
      создано в 17:00 по городу  -> сегодня 17:30 (край дня включительно)
      создано в 17:20 по городу  -> завтра 10:00
      создано в пятницу в 18:00  -> понедельник 10:00
    """
    now = almaty_now().replace(second=0, microsecond=0)

    lead_minutes = 0

    if visit_type == "ON_SITE":
        normalized_code = (
            normalize_visit_price_code(visit_price_code) or VISIT_PRICE_CODE_CITY
        )

        lead_minutes = VISIT_MINIMUM_LEAD_MINUTES.get(
            normalized_code,
            VISIT_MINIMUM_LEAD_MINUTES[VISIT_PRICE_CODE_CITY],
        )

    return get_next_working_slot(now + timedelta(minutes=lead_minutes))


def build_schedule_approval_data(
    scheduled_at: datetime,
    current_user: dict,
    reason: str | None = None,
):
    if is_working_schedule_time(scheduled_at):
        return {
            "status": SCHEDULE_APPROVAL_NOT_REQUIRED,
            "reason": None,
            "requested_by": None,
            "requested_at": None,
            "decided_by": None,
            "decided_at": None,
            "comment": None,
        }

    # Пользователь с правом согласования может сразу создавать/изменять на нерабочее время
    if user_can_decide_schedule_approval(current_user):
        return {
            "status": SCHEDULE_APPROVAL_APPROVED,
            "reason": reason,
            "requested_by": current_user["id"],
            "requested_at": almaty_now(),
            "decided_by": current_user["id"],
            "decided_at": almaty_now(),
            "comment": "Нерабочее время указано администратором",
        }

    if not reason or not reason.strip():
        raise HTTPException(
            status_code=400,
            detail="Для выбора нерабочего времени укажите причину для согласования"
        )

    return {
        "status": SCHEDULE_APPROVAL_PENDING,
        "reason": reason.strip(),
        "requested_by": current_user["id"],
        "requested_at": almaty_now(),
        "decided_by": None,
        "decided_at": None,
        "comment": None,
    }

def get_current_user_city(cursor, current_user: dict):
    """
    Берём city из current_user, если он уже есть.
    Если нет — достаём из БД.
    """
    if current_user.get("city"):
        return current_user["city"]

    cursor.execute(
        """
        SELECT city
        FROM users
        WHERE id = %s
        """,
        (current_user["id"],)
    )
    user = cursor.fetchone()

    if not user:
        return None

    return user.get("city")


def normalize_city(city):
    if city is None:
        return None
    return str(city).strip().lower()

def request_is_visible_to_technician_by_payment(request: dict) -> bool:
    return (
        bool(request.get("is_paid"))
        or request.get("client_payment_type") == CLIENT_PAYMENT_POSTPAYMENT
    )

def user_can_view_request_prices(current_user: dict) -> bool:
    """
    Кому видны цены заявки.

    У сотрудника — обычные права раздела. У клиента — отдельное право
    кабинета portal.prices.view: клиент не должен зависеть от кодов
    prices.*, которые ему никто не выдаёт и выдавать не собирается.
    """
    if is_client_user(current_user):
        return can_view_portal_prices(current_user)

    return can_view_price_fields(current_user)


def hide_request_prices(requests: list[dict]) -> list[dict]:
    for req in requests:
        req["total_price"] = None

        if "price_lines" in req:
            req["price_lines"] = []

    return requests


# Поля строки заявки, которые клиенту не отдаются.
#
# Область данных решает, КАКИЕ заявки видно. Этот список решает, ЧТО
# видно внутри строки — а это разные вопросы, и второй легко забыть.
#
# schedule_approval_* — внутренняя кухня согласования нерабочего времени:
#   там наш менеджер пишет причину для администрации, а не для клиента.
#   Сам статус согласования оставляем: «время согласовывается» клиенту
#   полезно знать.
# client_status      — наша оценка платёжной дисциплины (DEBTOR/BLOCKED).
#   В интерфейсе кабинета мы её намеренно не показываем, в JSON тоже
#   не должно быть.
# created_by / *_role / responsible_manager_id — внутренние идентификаторы
#   и коды ролей. Имя создателя оставляем: клиенту полезно видеть,
#   кто оформил заявку.
CLIENT_HIDDEN_REQUEST_FIELDS = (
    "schedule_approval_reason",
    "schedule_approval_comment",
    "schedule_approval_requested_by",
    "schedule_approval_requested_at",
    "schedule_approval_decided_by",
    "schedule_approval_decided_at",
    "client_status",
    "created_by",
    "created_by_role",
    "responsible_manager_id",
    "client_created_by",
    "current_user_is_executor",
)


def sanitize_executors_for_client(executors) -> list[dict]:
    """
    Клиенту от исполнителя нужно имя (решение Р7). Почта, роль, город
    и кто кого назначил — внутренний справочник компании.
    """
    if not isinstance(executors, list):
        return []

    return [
        {
            "user_id": executor.get("user_id"),
            "user_name": executor.get("user_name"),
        }
        for executor in executors
    ]


def sanitize_request_for_client(request: dict, current_user: dict) -> dict:
    """
    Вызывать ПОСЛЕ attach_request_permissions: флаг can_cancel считается
    по created_by, а мы это поле убираем.
    """
    if not is_client_user(current_user):
        return request

    for field in CLIENT_HIDDEN_REQUEST_FIELDS:
        request.pop(field, None)

    if "executors" in request:
        request["executors"] = sanitize_executors_for_client(
            request.get("executors")
        )

    return request


def sanitize_requests_for_client(
    requests: list[dict],
    current_user: dict,
) -> list[dict]:
    if not is_client_user(current_user):
        return requests

    for request in requests:
        sanitize_request_for_client(request, current_user)

    return requests


# Белый список действий истории, которые видит клиент в портале.
# Всё, чего здесь нет, скрыто — включая внутреннюю тарификацию,
# причины согласования нерабочего времени и движение оборудования
# на складе. Список закрытый намеренно: новое действие появляется
# скрытым, а не открытым по недосмотру.
CLIENT_VISIBLE_HISTORY_ACTIONS = {
    "CREATED",
    "STATUS_CHANGED",
    "SCHEDULED_AT_CHANGED",
    "ADDRESS_CHANGED",
    "CITY_CHANGED",
    "CONTACT_NAME_CHANGED",
    "CONTACT_PHONE_CHANGED",
    "PLATFORM_CHANGED",
    "VISIT_TYPE_CHANGED",
    "ASSIGNED",
    "UNASSIGNED",
    "SELF_ACCEPTED",
    "EXECUTORS_ASSIGNED",
    "PAYMENT_UPDATED",
}

# В этих записях в old_value/new_value лежат ID пользователей.
# Клиенту вместо "assigned_to=7" показываем имя исполнителя.
CLIENT_HISTORY_EXECUTOR_ACTIONS = {
    "ASSIGNED",
    "UNASSIGNED",
    "SELF_ACCEPTED",
    "EXECUTORS_ASSIGNED",
}

ASSIGNED_TO_HISTORY_PATTERN = re.compile(r"assigned_to=(\d+)")
EXECUTORS_HISTORY_PATTERN = re.compile(r"executors=\[([0-9,\s]*)\]")


def extract_history_user_ids(value) -> list[int]:
    if not value:
        return []

    text = str(value)
    user_ids = []

    for match in ASSIGNED_TO_HISTORY_PATTERN.finditer(text):
        user_ids.append(int(match.group(1)))

    for match in EXECUTORS_HISTORY_PATTERN.finditer(text):
        for part in match.group(1).split(","):
            part = part.strip()

            if part.isdigit():
                user_ids.append(int(part))

    return user_ids


def build_client_executor_history_value(value, names_by_id: dict) -> str | None:
    """
    Из "assigned_to=7, executors=[7, 8], status=IN_PROGRESS"
    получаем "Иван Иванов, Пётр Петров".

    Технические поля вроде status клиенту не нужны: смену статуса он
    и так видит отдельной записью STATUS_CHANGED.
    """
    if value is None:
        return None

    text = str(value)

    names = [
        names_by_id.get(user_id) or f"Исполнитель #{user_id}"
        for user_id in extract_history_user_ids(text)
    ]

    if names:
        # dict.fromkeys убирает повторы, сохраняя порядок:
        # assigned_to и executors часто содержат одного и того же человека.
        return ", ".join(dict.fromkeys(names))

    if "assigned_to=NULL" in text or "executors=[]" in text:
        return "не назначен"

    return None


def filter_request_history_for_client(
    cursor,
    history: list[dict] | None,
    current_user: dict,
) -> list[dict]:
    """
    История заявки для клиентской учётной записи.

    Сотрудникам отдаём как есть — это их рабочий журнал.
    """
    if not is_client_user(current_user):
        return history or []

    visible_rows = [
        row
        for row in (history or [])
        if str(row.get("action") or "") in CLIENT_VISIBLE_HISTORY_ACTIONS
    ]

    if not visible_rows:
        return []

    user_ids = set()

    for row in visible_rows:
        if str(row.get("action") or "") in CLIENT_HISTORY_EXECUTOR_ACTIONS:
            user_ids.update(extract_history_user_ids(row.get("old_value")))
            user_ids.update(extract_history_user_ids(row.get("new_value")))

    names_by_id = {}

    if user_ids:
        sorted_user_ids = sorted(user_ids)
        placeholders = ", ".join(["%s"] * len(sorted_user_ids))

        cursor.execute(
            f"""
            SELECT id, name
            FROM users
            WHERE id IN ({placeholders})
            """,
            tuple(sorted_user_ids),
        )

        names_by_id = {
            int(row["id"]): row.get("name")
            for row in (cursor.fetchall() or [])
        }

    result = []

    for row in visible_rows:
        action = str(row.get("action") or "")
        item = dict(row)

        if action in CLIENT_HISTORY_EXECUTOR_ACTIONS:
            item["old_value"] = build_client_executor_history_value(
                row.get("old_value"), names_by_id
            )
            item["new_value"] = build_client_executor_history_value(
                row.get("new_value"), names_by_id
            )

        elif action == "CREATED":
            # В базе лежит служебный английский текст вида
            # "Request created with 2 vehicle(s)" — клиенту он ни к чему.
            item["old_value"] = None
            item["new_value"] = "Заявка создана"

        result.append(item)

    return result


def request_is_directly_owned(request: dict, current_user: dict) -> bool:
    """
    Заявка «своя» напрямую: пользователь её создал или ведёт клиента.
    """
    user_id = int(current_user["id"])

    created_by = request.get("created_by")
    responsible_manager_id = request.get("responsible_manager_id")

    if created_by is not None and int(created_by) == user_id:
        return True

    if responsible_manager_id is not None and int(responsible_manager_id) == user_id:
        return True

    return False


def request_is_inherited_from_subclient(
    request: dict,
    current_user: dict,
    access_context: dict | None = None,
) -> bool:
    """
    Заявка видна только потому, что её клиент — подклиент в ветке
    пользователя. Такие заявки открываются на чтение, но не редактируются.
    """
    if not access_context:
        return False

    if access_context.get("scope") != DATA_SCOPE_RESPONSIBLE_CLIENTS:
        return False

    if request_is_directly_owned(request, current_user):
        return False

    client_id = request.get("client_id")

    if client_id is None:
        return False

    client_id = int(client_id)

    if client_id in (access_context.get("direct_client_ids") or set()):
        return False

    return client_id in (access_context.get("branch_client_ids") or set())


def attach_portal_request_permissions(
    request: dict,
    current_user: dict,
    access_context: dict | None = None,
) -> dict:
    """
    Флаги заявки для клиентского кабинета.

    Все действия сотрудников выставляются в False явно, а не по остаточному
    принципу. Сегодня у клиента нет прав requests.*, но если кто-то их
    выдаст, интерфейс не должен нарисовать кнопку «Завершить».
    """
    request["can_edit"] = False
    request["can_change_status"] = False
    request["can_manage_executors"] = False
    request["can_decide_schedule_approval"] = False
    request["can_delete"] = False
    request["can_delete_own_with_time_limit"] = False
    request["delete_window_seconds_left"] = 0
    request["can_edit_payment"] = False
    request["can_accept"] = False
    request["can_complete"] = False
    request["can_edit_vehicles"] = False
    request["can_fill_vehicle_vin"] = False

    request["can_view_prices"] = can_view_portal_prices(current_user)

    own_client_id = get_user_client_id(current_user)
    request_client_id = request.get("client_id")

    is_own_client_request = (
        own_client_id is not None
        and request_client_id is not None
        and int(request_client_id) == int(own_client_id)
    )

    # Заявка подклиента: показываем её иначе, чем свою.
    request["is_inherited_access"] = not is_own_client_request

    # Решение Р20(Б): отменить можно заявку по всей своей ветке, но только
    # ту, что завели из кабинета этого же клиента. Иначе получался тупик —
    # пользователь родителя заводит подклиента, создаёт ему заявку
    # и не может исправить собственную ошибку.
    #
    # Заявку, оформленную нашим менеджером, из кабинета не отменяют:
    # у неё своя история договорённостей.
    portal_user_ids = (access_context or {}).get("portal_user_ids") or set()
    created_by = request.get("created_by")

    created_from_portal = (
        created_by is not None and int(created_by) in portal_user_ids
    )

    request["can_cancel"] = bool(
        (is_own_client_request or created_from_portal)
        and can_cancel_portal_request(current_user)
        and str(request.get("status")) == "NEW"
    )

    return request


def attach_request_permissions(
    request: dict,
    current_user: dict,
    access_context: dict | None = None,
) -> dict:
    if is_client_user(current_user):
        return attach_portal_request_permissions(
            request,
            current_user,
            access_context,
        )

    user_id = int(current_user["id"])

    created_by = request.get("created_by")
    responsible_manager_id = request.get("responsible_manager_id")

    is_creator = created_by is not None and int(created_by) == user_id
    is_responsible_manager = (
        responsible_manager_id is not None
        and int(responsible_manager_id) == user_id
    )

    request["can_edit"] = (
        can_edit_all_requests(current_user)
        or user_can_edit_own_or_responsible_request(current_user, request)
    )

    request["can_change_status"] = can_change_request_status(current_user)
    request["can_manage_executors"] = can_manage_request_executors(current_user)
    request["can_decide_schedule_approval"] = user_can_decide_schedule_approval(current_user)

    request["can_delete"] = can_delete_any_request(current_user)

    delete_seconds_left = get_request_delete_seconds_left(request)

    request["can_delete_own_with_time_limit"] = bool(
        can_delete_own_request_with_time_limit(current_user)
        and is_creator
        and str(request.get("status")) == "NEW"
        and delete_seconds_left > 0
    )

    request["delete_window_seconds_left"] = (
        delete_seconds_left
        if request["can_delete_own_with_time_limit"]
        else 0
    )

    request["can_view_prices"] = can_view_price_fields(current_user)
    request["can_edit_payment"] = can_edit_payment_info(current_user)

    # Все условия принятия заявки считает сервер: право исполнителя,
    # область данных, статус, отсутствие исполнителя и согласование времени.
    request["can_accept"] = bool(
        user_can_self_accept_requests(current_user)
        and str(request.get("status")) == "NEW"
        and request.get("assigned_to") is None
        and str(request.get("schedule_approval_status") or "")
        not in [SCHEDULE_APPROVAL_PENDING, SCHEDULE_APPROVAL_REJECTED]
    )

    # Право завершить работы. Считаем здесь по той же причине, что и
    # can_accept: условий четыре — статус, наличие исполнителя, право
    # и (для «только своих») принадлежность к исполнителям. Фронт этот
    # набор повторять не должен, он разойдётся молча.
    #
    # Список исполнителей к этому моменту уже приклеен
    # (attach_executors_to_requests вызывается раньше), но на всякий
    # случай учитываем и assigned_to.
    current_user_is_request_executor = (
        request.get("assigned_to") is not None
        and int(request["assigned_to"]) == user_id
    ) or any(
        executor.get("user_id") is not None
        and int(executor["user_id"]) == user_id
        for executor in (request.get("executors") or [])
    )

    request["can_complete"] = bool(
        str(request.get("status")) == "IN_PROGRESS"
        and request.get("assigned_to") is not None
        and (
            user_can_complete_any_request(current_user)
            or (
                user_can_complete_assigned_request(current_user)
                and current_user_is_request_executor
            )
        )
    )

    # Машины заявки. Флаги считаем здесь, потому что «редактирование машин
    # своих клиентов» зависит от создателя и ответственного менеджера
    # КЛИЕНТА — этих полей у фронта нет и быть не должно.
    #
    # can_edit_vehicles     — открыть карточку машины на полное редактирование;
    # can_fill_vehicle_vin  — только вписать недостающий VIN. Второе есть
    #                         у монтажника, у которого прав на клиента нет
    #                         вовсе: доступ ему даёт сама заявка.
    request_client = {
        "id": request.get("client_id"),
        "type": request.get("client_type"),
        "name": request.get("client_name"),
        "company_name": request.get("company_name"),
        "status": request.get("client_status"),
        "created_by": request.get("client_created_by"),
        "responsible_manager_id": request.get("responsible_manager_id"),
    }

    request["can_edit_vehicles"] = bool(
        request.get("client_id")
        and can_edit_vehicle_for_client(request_client, current_user)
    )

    request["can_fill_vehicle_vin"] = can_fill_vehicle_vin(current_user)

    # Заявка подклиента, доступная через родителя: показываем, но
    # ничего менять по ней нельзя.
    is_inherited_access = request_is_inherited_from_subclient(
        request,
        current_user,
        access_context,
    )

    request["is_inherited_access"] = is_inherited_access

    if is_inherited_access:
        request["can_edit"] = False
        request["can_change_status"] = False
        request["can_manage_executors"] = False
        request["can_decide_schedule_approval"] = False
        request["can_delete"] = False
        request["can_delete_own_with_time_limit"] = False
        request["delete_window_seconds_left"] = 0
        request["can_edit_payment"] = False
        request["can_accept"] = False
        request["can_complete"] = False
        request["can_edit_vehicles"] = False
        request["can_fill_vehicle_vin"] = False

    return request


def attach_requests_permissions(
    requests: list[dict],
    current_user: dict,
    access_context: dict | None = None,
) -> list[dict]:
    for request in requests:
        attach_request_permissions(request, current_user, access_context)

    return requests


def user_can_access_request(
    request: dict,
    current_user: dict,
    user_city: str | None = None,
    access_context: dict | None = None,
) -> bool:
    user_id = int(current_user["id"])
    data_scope = get_effective_request_data_scope(current_user)

    if data_scope == DATA_SCOPE_ALL:
        return True

    if data_scope == DATA_SCOPE_CLIENT:
        # Без контекста доступа не пускаем: пустой набор клиентов
        # означает «ничего не видно», а не «видно всё».
        branch_client_ids = (access_context or {}).get("branch_client_ids") or set()
        client_id = request.get("client_id")

        if client_id is None:
            return False

        return int(client_id) in branch_client_ids

    if data_scope == DATA_SCOPE_RESPONSIBLE_CLIENTS:
        if request_is_directly_owned(request, current_user):
            return True

        # Вариант Б: кто ведёт родителя, видит заявки его подклиентов.
        branch_client_ids = (access_context or {}).get("branch_client_ids") or set()
        client_id = request.get("client_id")

        if client_id is not None and int(client_id) in branch_client_ids:
            return True

        return False

    if data_scope == DATA_SCOPE_OWN:
        created_by = request.get("created_by")

        return (
            created_by is not None
            and int(created_by) == user_id
        )

    if data_scope == DATA_SCOPE_CITY:
        effective_user_city = (
            user_city
            or (access_context or {}).get("user_city")
            or current_user.get("city")
        )

        if not effective_user_city:
            return False

        return (
            normalize_city(request.get("city"))
            == normalize_city(effective_user_city)
        )

    if data_scope in [DATA_SCOPE_ASSIGNED, DATA_SCOPE_CITY_ASSIGNED]:
        assigned_to = request.get("assigned_to")
        current_user_is_executor = bool(request.get("current_user_is_executor"))

        is_assigned_to_user = (
            assigned_to is not None
            and int(assigned_to) == user_id
        ) or current_user_is_executor

        # Для ограниченных исполнителей сохраняем старую бизнес-логику:
        # обычный исполнитель видит свободные заявки только при оплате/постоплате
        # и только в своём городе. Назначенные ему заявки доступны всегда.
        if is_assigned_to_user:
            return True

        if data_scope == DATA_SCOPE_ASSIGNED:
            return False

        if not request_is_visible_to_technician_by_payment(request):
            return False

        executor_city = (
            user_city
            or (access_context or {}).get("user_city")
            or current_user.get("city")
        )

        if not executor_city:
            return False

        if normalize_city(request.get("city")) != normalize_city(executor_city):
            return False

        return assigned_to is None

    return False

def attach_vehicles_to_requests(cursor, requests: list[dict]) -> list[dict]:
    """
    Добавляет к каждой заявке массив vehicles[] из request_vehicles.

    Новая структура:
    request = шапка заявки
    vehicles[] = автомобили внутри заявки + параметры установки
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

    request_vehicle_ids = [row["request_vehicle_id"] for row in rows]

    sensors_grouped = {}
    equipment_grouped = {}

    if request_vehicle_ids:
        sensor_placeholders = ", ".join(["%s"] * len(request_vehicle_ids))

        cursor.execute(
            f"""
            SELECT
                id,
                request_vehicle_id,
                name,
                price,
                created_at
            FROM request_vehicle_extra_sensors
            WHERE request_vehicle_id IN ({sensor_placeholders})
            ORDER BY id ASC
            """,
            tuple(request_vehicle_ids)
        )

        sensor_rows = cursor.fetchall()

        for sensor in sensor_rows:
            sensors_grouped.setdefault(sensor["request_vehicle_id"], []).append(sensor)

        equipment_placeholders = ", ".join(
            ["%s"] * len(request_vehicle_ids)
        )

        cursor.execute(
            f"""
            SELECT
                re.request_vehicle_id,
                COALESCE(re.quantity, 1) AS quantity,
                wi.category,
                wi.identifier_type,
                wi.identifier_value
            FROM request_equipment re
            INNER JOIN warehouse_items wi
                ON wi.id = re.warehouse_item_id
            WHERE re.request_vehicle_id IN ({equipment_placeholders})
            ORDER BY re.id ASC
            """,
            tuple(request_vehicle_ids)
        )

        equipment_rows = cursor.fetchall()
        relay_by_vehicle = {}

        for equipment in equipment_rows:
            request_vehicle_id = equipment["request_vehicle_id"]
            quantity = max(int(equipment.get("quantity") or 1), 1)

            equipment["quantity"] = quantity

            # Если реле добавляли несколькими действиями,
            # объединяем их в один бейдж "Реле ×N".
            if equipment.get("category") == "RELAY":
                existing_relay = relay_by_vehicle.get(request_vehicle_id)

                if existing_relay:
                    existing_relay["quantity"] += quantity
                    continue

                relay_by_vehicle[request_vehicle_id] = equipment

            equipment_grouped.setdefault(
                request_vehicle_id,
                []
            ).append(equipment)

    grouped = {}

    for row in rows:
        row["has_beacon"] = bool(row["has_beacon"])
        row["has_blocking"] = bool(row["has_blocking"])
        row["extra_sensors"] = sensors_grouped.get(row["request_vehicle_id"], [])
        row["equipment"] = equipment_grouped.get(
            row["request_vehicle_id"],
            []
        )

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

def get_request_executors(cursor, request_id: int) -> list[dict]:
    cursor.execute(
        """
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
        WHERE re.request_id = %s
        ORDER BY re.id ASC
        """,
        (request_id,)
    )

    return cursor.fetchall()


def attach_executors_to_requests(cursor, requests: list[dict]) -> list[dict]:
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


def user_is_request_executor(cursor, request_id: int, user_id: int) -> bool:
    cursor.execute(
        """
        SELECT id
        FROM request_executors
        WHERE request_id = %s
          AND user_id = %s
        LIMIT 1
        """,
        (request_id, user_id)
    )

    return cursor.fetchone() is not None


def validate_request_executor_ids(cursor, executor_ids: list[int]) -> list[dict]:
    unique_executor_ids = []

    for executor_id in executor_ids:
        if executor_id is None:
            continue

        executor_id = int(executor_id)

        if executor_id not in unique_executor_ids:
            unique_executor_ids.append(executor_id)

    if not unique_executor_ids:
        return []

    placeholders = ", ".join(["%s"] * len(unique_executor_ids))

    cursor.execute(
        f"""
        SELECT
            u.id,
            u.name,
            u.role,
            u.city,
            u.is_approved,
            u.is_active,
            u.deleted_at,
            COALESCE(r.can_be_request_executor, 0) AS can_be_request_executor
        FROM users u
        LEFT JOIN roles r ON r.code = u.role
        WHERE u.id IN ({placeholders})
        """,
        tuple(unique_executor_ids)
    )

    users = cursor.fetchall()
    users_map = {int(user["id"]): user for user in users}

    for executor_id in unique_executor_ids:
        user = users_map.get(executor_id)

        if not user:
            raise HTTPException(
                status_code=404,
                detail=f"Пользователь {executor_id} не найден"
            )

        if not to_bool(user.get("can_be_request_executor")):
            raise HTTPException(
                status_code=400,
                detail=f"Пользователь {user['name']} не является исполнителем заявки"
            )

        if not user["is_approved"]:
            raise HTTPException(
                status_code=400,
                detail=f"Пользователь {user['name']} не подтверждён"
            )

        if not user["is_active"] or user["deleted_at"] is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Пользователь {user['name']} удалён или неактивен"
            )

    return [users_map[executor_id] for executor_id in unique_executor_ids]


def replace_request_executors(
    cursor,
    request_id: int,
    executor_ids: list[int],
    assigned_by: int,
):
    unique_executor_ids = []

    for executor_id in executor_ids:
        if executor_id is None:
            continue

        executor_id = int(executor_id)

        if executor_id not in unique_executor_ids:
            unique_executor_ids.append(executor_id)

    cursor.execute(
        """
        SELECT user_id
        FROM request_executors
        WHERE request_id = %s
        """,
        (request_id,)
    )

    old_rows = cursor.fetchall()
    old_executor_ids = [int(row["user_id"]) for row in old_rows]

    to_add = [
        executor_id
        for executor_id in unique_executor_ids
        if executor_id not in old_executor_ids
    ]

    to_remove = [
        executor_id
        for executor_id in old_executor_ids
        if executor_id not in unique_executor_ids
    ]

    if to_remove:
        placeholders = ", ".join(["%s"] * len(to_remove))

        cursor.execute(
            f"""
            DELETE FROM request_executors
            WHERE request_id = %s
              AND user_id IN ({placeholders})
            """,
            tuple([request_id] + to_remove)
        )

    for executor_id in to_add:
        cursor.execute(
            """
            INSERT INTO request_executors (
                request_id,
                user_id,
                assigned_by,
                assigned_at
            )
            VALUES (%s, %s, %s, %s)
            """,
            (
                request_id,
                executor_id,
                assigned_by,
                almaty_now(),
            )
        )

    return {
        "executor_ids": unique_executor_ids,
        "old_executor_ids": old_executor_ids,
        "added_executor_ids": to_add,
        "removed_executor_ids": to_remove,
    }

@router.post("")
def create_request(data: RequestCreate, current_user: dict = Depends(get_current_user)):
    """
    Создание заявки с несколькими автомобилями.
    requests = шапка заявки
    request_vehicles = автомобили внутри заявки + параметры установки
    """
    # Кабинет создаёт заявки своим эндпоинтом, по параметрам установки
    # из договора. Общий /requests принимает произвольный client_id
    # и полный набор полей — клиенту здесь делать нечего.
    if is_client_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Создание заявки из личного кабинета выполняется отдельно",
        )

    if not can_create_request(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания заявки"
        )

    if not data.vehicles:
        raise HTTPException(
            status_code=400,
            detail="Нужно добавить хотя бы один автомобиль в заявку"
        )

    allowed_work_types = ["INSTALLATION", "DIAGNOSTIC", "REMOVAL", "REFLASHING"]
    allowed_visit_types = ["IN_OFFICE", "ON_SITE"]

    if data.work_type not in allowed_work_types:
        raise HTTPException(status_code=400, detail="Некорректный тип работ")

    if data.visit_type not in allowed_visit_types:
        raise HTTPException(status_code=400, detail="Некорректный формат работ")

    visit_price_code = resolve_visit_price_code(
        data.visit_type,
        data.visit_price_code,
        data.price,
    )

    scheduled_at = normalize_scheduled_at(data.scheduled_at)

    # Пустое время — не обязательно ошибка: у части клиентов время
    # подставляет система. Но узнать это можно только по параметрам
    # договора, а для них нужен курсор — поэтому разбор перенесён
    # внутрь, после проверки клиента.
    schedule_approval = None

    if scheduled_at is not None:
        validate_request_schedule(
            scheduled_at=scheduled_at,
            visit_type=data.visit_type,
            visit_price_code=visit_price_code,
            current_user=current_user,
        )

        schedule_approval = build_schedule_approval_data(
            scheduled_at=scheduled_at,
            current_user=current_user,
            reason=data.schedule_approval_reason,
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            # Проверяем клиента
            cursor.execute(
                """
                SELECT
                    id,
                    status,
                    parent_client_id,
                    created_by,
                    responsible_manager_id,
                    is_deleted,

                    -- Запасное значение для контактного лица заявки,
                    -- если менеджер стёр предзаполненные поля.
                    name,
                    phone
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
                    detail="Нельзя создать заявку для клиента из корзины"
                )

            # Блокировка наследуется вниз: заблокированный родитель
            # закрывает создание заявок всем подклиентам.
            ensure_client_branch_not_blocked(cursor, int(client["id"]))

            if not can_create_request_for_client(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для создания заявки по этому клиенту"
                )

            # Время работ. У большинства клиентов его выбирают руками,
            # и тогда сюда мы приходим с уже проверенным значением.
            # У части клиентов (банки) время определяет договор: заявка,
            # созданная в рабочее окно, закрывается в тот же день, и час
            # менеджеру банка выбирать бессмысленно.
            #
            # Совсем без времени обойтись нельзя — на нём стоит календарь
            # и сортировка, — поэтому подставляем ближайший рабочий слот.
            if scheduled_at is None:
                if client_schedule_time_is_required(cursor, int(client["id"])):
                    raise HTTPException(
                        status_code=400,
                        detail="Необходимо указать желаемую дату и время выполнения работ"
                    )

                scheduled_at = resolve_auto_scheduled_at(
                    data.visit_type,
                    visit_price_code,
                )

                # Слот заведомо в рабочем окне, поэтому согласование
                # не потребуется и причина не нужна.
                schedule_approval = build_schedule_approval_data(
                    scheduled_at=scheduled_at,
                    current_user=current_user,
                    reason=None,
                )

            # Проверяем все автомобили до создания заявки
            vehicle_ids = [v.vehicle_id for v in data.vehicles]

            if len(vehicle_ids) != len(set(vehicle_ids)):
                raise HTTPException(
                    status_code=400,
                    detail="Один и тот же автомобиль нельзя добавить в заявку несколько раз"
                )

            placeholders = ", ".join(["%s"] * len(vehicle_ids))

            cursor.execute(
                f"""
                SELECT id, client_id, is_deleted, vin
                FROM vehicles
                WHERE id IN ({placeholders})
                """,
                tuple(vehicle_ids)
            )
            vehicles_from_db = cursor.fetchall()
            vehicles_map = {v["id"]: v for v in vehicles_from_db}

            for vehicle_input in data.vehicles:
                vehicle = vehicles_map.get(vehicle_input.vehicle_id)

                if not vehicle:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Машина {vehicle_input.vehicle_id} не найдена"
                    )

                if vehicle["is_deleted"]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Машина {vehicle_input.vehicle_id} находится в корзине"
                    )

                # Требование VIN настраивается по клиенту. Это не отмена
                # требования: без VIN нельзя будет завершить работы —
                # проверка стоит в /requests/{id}/complete.
                if (
                    (not vehicle.get("vin") or not str(vehicle.get("vin")).strip())
                    and client_vin_is_required(cursor, int(client["id"]))
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"У машины {vehicle_input.vehicle_id} не указан VIN. Нельзя создать заявку без VIN"
                    )

                if vehicle["client_id"] != data.client_id:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Машина {vehicle_input.vehicle_id} не принадлежит выбранному клиенту"
                    )

            # Итог всегда считает сервер по строкам расчёта.
            # Присланный браузером total_price не сохраняем: это было
            # единственное место, где цена заявки принималась на веру.
            total_price = 0

            platform = data.platform.strip()

            if not platform:
                raise HTTPException(
                    status_code=400,
                    detail="Необходимо выбрать платформу мониторинга"
                )

            # Контактное лицо заявки. Пусто — берём из карточки клиента.
            contact_name, contact_phone = resolve_request_contact(
                data.contact_name,
                data.contact_phone,
                client,
            )

            # шапка заявки
            cursor.execute(
                """
                INSERT INTO requests (
                    client_id,
                    work_type,
                    visit_type,
                    visit_price_code,
                    address,
                    city,
                    platform,
                    contact_name,
                    contact_phone,
                    scheduled_at,
                    schedule_approval_status,
                    schedule_approval_reason,
                    schedule_approval_requested_by,
                    schedule_approval_requested_at,
                    schedule_approval_decided_by,
                    schedule_approval_decided_at,
                    schedule_approval_comment,
                    status,
                    total_price,
                    created_by,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    data.client_id,
                    data.work_type,
                    data.visit_type,
                    visit_price_code,
                    data.address,
                    data.city,
                    platform,
                    contact_name,
                    contact_phone,
                    scheduled_at,
                    schedule_approval["status"],
                    schedule_approval["reason"],
                    schedule_approval["requested_by"],
                    schedule_approval["requested_at"],
                    schedule_approval["decided_by"],
                    schedule_approval["decided_at"],
                    schedule_approval["comment"],
                    "NEW",
                    total_price,
                    current_user["id"],
                    almaty_now(),
                )
            )

            request_id = cursor.lastrowid

            # Добавляем автомобили заявки
            request_vehicle_id_by_index = {}

            for index, vehicle_input in enumerate(data.vehicles, start=1):
                has_beacon = bool(vehicle_input.has_beacon) if data.work_type == "INSTALLATION" else False
                has_blocking = bool(vehicle_input.has_blocking) if data.work_type == "INSTALLATION" else False

                cursor.execute(
                    """
                    INSERT INTO request_vehicles (
                        request_id,
                        vehicle_id,
                        has_beacon,
                        has_blocking
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        vehicle_input.vehicle_id,
                        has_beacon,
                        has_blocking,
                    )
                )

                request_vehicle_id = cursor.lastrowid
                request_vehicle_id_by_index[index] = request_vehicle_id

                # Дополнительные датчики сохраняем только для установки
                if data.work_type == "INSTALLATION" and vehicle_input.extra_sensors:
                    for sensor in vehicle_input.extra_sensors:
                        sensor_name = sensor.name.strip()

                        if not sensor_name:
                            continue

                        sensor_price = float(sensor.price or 0)

                        if sensor_price < 0:
                            raise HTTPException(
                                status_code=400,
                                detail="Цена дополнительного датчика не может быть отрицательной"
                            )

                        cursor.execute(
                            """
                            INSERT INTO request_vehicle_extra_sensors (
                                request_vehicle_id,
                                name,
                                price
                            )
                            VALUES (%s, %s, %s)
                            """,
                            (
                                request_vehicle_id,
                                sensor_name,
                                sensor_price
                            )
                        )

            saved_total_price = total_price

            if data.price and data.price.lines:
                resolved_lines = resolve_request_price_lines(
                    cursor,
                    data.price.lines,
                    data.client_id,
                    current_user,
                )

                calculated_total = 0

                for line in resolved_lines:
                    request_vehicle_id = None

                    if line["vehicle_index"]:
                        request_vehicle_id = request_vehicle_id_by_index.get(
                            line["vehicle_index"]
                        )

                        if not request_vehicle_id:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Не найден автомобиль заявки для строки цены vehicle_index={line['vehicle_index']}"
                            )

                    calculated_total += line["total_price"]

                    cursor.execute(
                        """
                        INSERT INTO request_price_lines (
                            request_id,
                            request_vehicle_id,
                            line_key,
                            code,
                            label,
                            quantity,
                            unit,
                            unit_price,
                            total_price,
                            source,
                            is_manual
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            request_id,
                            request_vehicle_id,
                            line["line_key"],
                            line["code"],
                            line["label"],
                            line["quantity"],
                            line["unit"],
                            line["unit_price"],
                            line["total_price"],
                            line["source"],
                            line["is_manual"],
                        )
                    )

                cursor.execute(
                    """
                    UPDATE requests
                    SET total_price = %s
                    WHERE id = %s
                    """,
                    (
                        calculated_total,
                        request_id,
                    )
                )

                saved_total_price = calculated_total

            cursor.execute(
                """
                INSERT INTO request_history (
                    request_id,
                    user_id,
                    action,
                    new_value
                )
                VALUES (%s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "CREATED",
                    f"Request created with {len(data.vehicles)} vehicle(s)"
                )
            )

            if schedule_approval["status"] == SCHEDULE_APPROVAL_PENDING:
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
                        "SCHEDULE_APPROVAL_REQUESTED",
                        None,
                        schedule_approval["reason"],
                    )
                )

            cursor.execute(
                """
                SELECT name, company_name
                FROM clients
                WHERE id = %s
                """,
                (data.client_id,)
            )
            client_for_notification = cursor.fetchone() or {}

            notify_new_request(
                cursor=cursor,
                request_id=request_id,
                city=data.city,
                client_name=client_for_notification.get("name"),
                company_name=client_for_notification.get("company_name"),
                actor_user_id=current_user["id"],
            )

            notify_request_time_conflict(
                cursor=cursor,
                request_id=request_id,
                scheduled_at=scheduled_at,
                city=data.city,
                client_name=client_for_notification.get("name"),
                company_name=client_for_notification.get("company_name"),
                actor_user_id=current_user["id"],
            )

            # Заявку завёл наш менеджер — кабинет клиента должен узнать
            # об этом так же, как если бы её создал сам клиент.
            notify_portal_request_created(
                cursor=cursor,
                request_id=request_id,
                client_id=data.client_id,
                scheduled_at=scheduled_at,
                client_name=(
                    client_for_notification.get("company_name")
                    or client_for_notification.get("name")
                ),
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "created",
                "request_id": request_id,
                "vehicles_count": len(data.vehicles),
                "total_price": saved_total_price
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("")
def get_requests(status: str = Query(None), current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            values = []
            conditions = ["r.is_deleted = 0"]

            if status:
                conditions.append("r.status = %s")
                values.append(status)

            access_context = build_request_access_context(cursor, current_user)
            data_scope = access_context["scope"]

            if data_scope == DATA_SCOPE_ALL:
                pass

            elif data_scope == DATA_SCOPE_RESPONSIBLE_CLIENTS:
                branch_client_ids = sorted(access_context["branch_client_ids"])

                if branch_client_ids:
                    client_placeholders = ", ".join(["%s"] * len(branch_client_ids))

                    # Свои заявки, свои клиенты и вся ветка их подклиентов.
                    conditions.append(
                        f"""
                        (
                            r.created_by = %s
                            OR c.responsible_manager_id = %s
                            OR r.client_id IN ({client_placeholders})
                        )
                        """
                    )
                    values.extend(
                        [current_user["id"], current_user["id"]] + branch_client_ids
                    )
                else:
                    conditions.append(
                        """
                        (
                            r.created_by = %s
                            OR c.responsible_manager_id = %s
                        )
                        """
                    )
                    values.extend([current_user["id"], current_user["id"]])

            elif data_scope == DATA_SCOPE_CLIENT:
                branch_client_ids = sorted(access_context["branch_client_ids"])

                if not branch_client_ids:
                    return []

                client_placeholders = ", ".join(["%s"] * len(branch_client_ids))

                conditions.append(f"r.client_id IN ({client_placeholders})")
                values.extend(branch_client_ids)

            elif data_scope == DATA_SCOPE_OWN:
                conditions.append("r.created_by = %s")
                values.append(current_user["id"])

            elif data_scope == DATA_SCOPE_CITY:
                user_city = access_context["user_city"]

                if not user_city:
                    return []

                conditions.append("r.city = %s")
                values.append(user_city)

            elif data_scope == DATA_SCOPE_ASSIGNED:
                conditions.append(
                    """
                    (
                        r.assigned_to = %s
                        OR EXISTS (
                            SELECT 1
                            FROM request_executors re_assigned_scope
                            WHERE re_assigned_scope.request_id = r.id
                              AND re_assigned_scope.user_id = %s
                        )
                    )
                    """
                )
                values.extend([current_user["id"], current_user["id"]])

            elif data_scope == DATA_SCOPE_CITY_ASSIGNED:
                user_city = access_context["user_city"]

                conditions.append(
                    """
                    (
                        r.assigned_to = %s
                        OR EXISTS (
                            SELECT 1
                            FROM request_executors re
                            WHERE re.request_id = r.id
                              AND re.user_id = %s
                        )
                        OR (
                            r.assigned_to IS NULL
                            AND r.city = %s
                            AND (
                                r.is_paid = 1
                                OR c.payment_type = 'POSTPAYMENT'
                            )
                        )
                    )
                    """
                )
                values.extend([
                    current_user["id"],
                    current_user["id"],
                    user_city,
                ])

            else:
                return []

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.visit_price_code,
                    r.address,
                    r.city,
                    r.platform,
                    r.contact_name,
                    r.contact_phone,
                    r.scheduled_at,
                    r.schedule_approval_status,
                    r.schedule_approval_reason,
                    r.schedule_approval_requested_by,
                    r.schedule_approval_requested_at,
                    r.schedule_approval_decided_by,
                    r.schedule_approval_decided_at,
                    r.schedule_approval_comment,
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
                    c.source_client_name AS client_source_name,
                    c.source_parent_client_name AS parent_client_source_name,
                    c.parent_client_id,

                    parent_client.name AS parent_client_name,
                    parent_client.company_name AS parent_client_company_name,
                    parent_client.type AS parent_client_type,

                    c.status AS client_status,
                    c.payment_type AS client_payment_type,
                    c.responsible_manager_id,
                    c.created_by AS client_created_by,

                    responsible.name AS responsible_manager_name

                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id

                LEFT JOIN clients parent_client
                    ON parent_client.id = c.parent_client_id
                   AND parent_client.is_deleted = 0

                LEFT JOIN users creator ON r.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                WHERE {where_clause}
                ORDER BY r.created_at DESC
                """,
                tuple(values)
            )

            requests = cursor.fetchall()
            requests = attach_vehicles_to_requests(cursor, requests)
            requests = attach_executors_to_requests(cursor, requests)
            requests = attach_requests_permissions(
                requests,
                current_user,
                access_context,
            )

            if not user_can_view_request_prices(current_user):
                requests = hide_request_prices(requests)

            # Последним шагом: строки уже отобраны и права проставлены,
            # теперь убираем из них внутренние поля.
            requests = sanitize_requests_for_client(requests, current_user)

            return requests

    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_requests(current_user: dict = Depends(get_current_user)):
    """Список удалённых заявок."""
    if not user_can_view_deleted_requests(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра корзины заявок"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.visit_price_code,
                    r.address,
                    r.city,
                    r.platform,
                    r.contact_name,
                    r.contact_phone,
                    r.scheduled_at,
                    r.schedule_approval_status,
                    r.schedule_approval_reason,
                    r.schedule_approval_requested_by,
                    r.schedule_approval_requested_at,
                    r.schedule_approval_decided_by,
                    r.schedule_approval_decided_at,
                    r.schedule_approval_comment,
                    r.status,
                    r.created_at,
                    r.assigned_to,
                    r.is_paid,
                    r.paid_at,
                    r.total_price,
                    r.deleted_at,
                    r.deleted_by,
                    r.created_by,

                    c.status AS client_status,
                    c.responsible_manager_id,
                    responsible.name AS responsible_manager_name,

                    creator.name AS created_by_name,
                    creator.role AS created_by_role,

                    c.name AS client_name,
                    c.company_name,
                    c.phone,
                    c.type AS client_type,
                    c.payment_type AS client_payment_type,

                    EXISTS (
                        SELECT 1
                        FROM request_executors re_current
                        WHERE re_current.request_id = r.id
                          AND re_current.user_id = %s
                    ) AS current_user_is_executor,

                    u.name AS deleted_by_name
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                LEFT JOIN users u ON r.deleted_by = u.id
                LEFT JOIN users creator ON r.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                WHERE r.is_deleted = 1
                ORDER BY r.deleted_at DESC
                """,
                (current_user["id"],)
            )

            requests = cursor.fetchall()

            access_context = build_request_access_context(cursor, current_user)
            user_city = access_context["user_city"]

            requests = [
                request
                for request in requests
                if user_can_access_request(
                    request,
                    current_user,
                    user_city,
                    access_context,
                )
            ]

            if not user_can_view_request_prices(current_user):
                requests = hide_request_prices(requests)

            return attach_vehicles_to_requests(cursor, requests)

    finally:
        connection.close()

@router.post("/comments")
def create_comment(data: CommentCreate, current_user: dict = Depends(get_current_user)):
    # чтобы монтажники не могли оставлять комментарии, раскомментируй эту проверку:
    # if current_user["role"] == "TECHNICIAN":
    #     raise HTTPException(status_code=403, detail="Обычный монтажник не может оставлять комментарии")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.payment_type AS client_payment_type,
                    c.responsible_manager_id,

                    EXISTS (
                        SELECT 1
                        FROM request_executors re
                        WHERE re.request_id = r.id
                          AND re.user_id = %s
                    ) AS current_user_is_executor
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (current_user["id"], data.request_id)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена или удалена")

            if not user_can_comment_requests(current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для добавления комментариев к заявке"
                )

            access_context = build_request_access_context(cursor, current_user)

            if not user_can_access_request(
                request,
                current_user,
                access_context["user_city"],
                access_context,
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для комментирования этой заявки"
                )

            # Заявку подклиента, доступную только через родителя,
            # комментировать нельзя: доступ дан на чтение.
            if request_is_inherited_from_subclient(request, current_user, access_context):
                raise HTTPException(
                    status_code=403,
                    detail="Заявка подклиента доступна только для просмотра"
                )

            cursor.execute(
                "INSERT INTO request_comments (request_id, user_id, message) VALUES (%s, %s, %s)",
                (data.request_id, current_user["id"], data.message)
            )

            # Переписка по заявке общая (решение Р8): сообщение видят
            # и клиент, и сотрудники. Автор из рассылки исключается
            # внутри сервиса.
            notify_portal_request_comment(
                cursor=cursor,
                request_id=data.request_id,
                client_id=request.get("client_id"),
                author_name=current_user.get("name"),
                comment_text=data.message,
                client_name=get_portal_client_name(cursor, request.get("client_id")),
                actor_user_id=current_user["id"],
            )

            connection.commit()
        return {"message": "comment added"}
    finally:
        connection.close()

@router.patch("/{request_id}/executors/assign")
def assign_request_executors(
    request_id: int,
    data: RequestExecutorsAssign,
    current_user: dict = Depends(get_current_user)
):
    """
    Массовое назначение исполнителей заявки.

    Логика:
    - ADMIN / ROP / SENIOR_TECHNICIAN выбирают одного или нескольких исполнителей.
    - После нажатия frontend-кнопки "Назначить" backend заменяет список исполнителей.
    - assigned_to остаётся основным/первым исполнителем для старой логики.
    - Если список исполнителей пустой — назначение снимается, заявка возвращается в NEW.
    """
    if not can_manage_request_executors(current_user):
        raise HTTPException(
            status_code=403,
            detail="Только Старший монтажник, РОП или Админ могут назначать исполнителей"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    client_id,
                    status,
                    assigned_to,
                    schedule_approval_status
                FROM requests
                WHERE id = %s
                  AND is_deleted = 0
                """,
                (request_id,)
            )

            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            if req.get("schedule_approval_status") == SCHEDULE_APPROVAL_PENDING:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя назначить исполнителей, пока не согласовано нерабочее время"
                )

            if req.get("schedule_approval_status") == SCHEDULE_APPROVAL_REJECTED:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя назначить исполнителей: нерабочее время отклонено администрацией"
                )

            if req["status"] not in ["NEW", "IN_PROGRESS"]:
                raise HTTPException(
                    status_code=400,
                    detail="Изменять исполнителей можно только у новой заявки или заявки в работе"
                )

            executor_ids = []

            for executor_id in data.executor_ids:
                executor_id = int(executor_id)

                if executor_id not in executor_ids:
                    executor_ids.append(executor_id)

            # Возвращённые строки нужны для уведомления клиенту:
            # ему положено имя исполнителя (решение Р7), и брать его
            # надо здесь, а не вторым запросом.
            executor_users = validate_request_executor_ids(cursor, executor_ids)

            result = replace_request_executors(
                cursor=cursor,
                request_id=request_id,
                executor_ids=executor_ids,
                assigned_by=current_user["id"],
            )

            old_assigned_to = req["assigned_to"]
            new_assigned_to = executor_ids[0] if executor_ids else None
            new_status = "IN_PROGRESS" if executor_ids else "NEW"

            cursor.execute(
                """
                UPDATE requests
                SET assigned_to = %s,
                    status = %s
                WHERE id = %s
                """,
                (
                    new_assigned_to,
                    new_status,
                    request_id,
                )
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
                    "EXECUTORS_ASSIGNED",
                    f"assigned_to={old_assigned_to}, executors={result['old_executor_ids']}, status={req['status']}",
                    f"assigned_to={new_assigned_to}, executors={executor_ids}, status={new_status}",
                )
            )

            if req["status"] != new_status:
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
                        "STATUS_CHANGED",
                        req["status"],
                        new_status,
                    )
                )

                notify_request_status_changed(
                    cursor=cursor,
                    request_id=request_id,
                    old_status=req["status"],
                    new_status=new_status,
                    assigned_to=new_assigned_to,
                    actor_user_id=current_user["id"],
                )

            if result["added_executor_ids"]:
                notify_request_executors_assigned(
                    cursor=cursor,
                    request_id=request_id,
                    executor_ids=result["added_executor_ids"],
                    actor_user_id=current_user["id"],
                )

            # --- Кабинет клиента ---
            portal_client_name = get_portal_client_name(cursor, req.get("client_id"))

            if result["added_executor_ids"] or result["removed_executor_ids"]:
                notify_portal_request_executors(
                    cursor=cursor,
                    request_id=request_id,
                    client_id=req.get("client_id"),
                    executor_names=[
                        user.get("name")
                        for user in executor_users
                        if user.get("name")
                    ],
                    client_name=portal_client_name,
                    actor_user_id=current_user["id"],
                )

            if req["status"] != new_status:
                notify_portal_request_status_changed(
                    cursor=cursor,
                    request_id=request_id,
                    client_id=req.get("client_id"),
                    old_status=req["status"],
                    new_status=new_status,
                    client_name=portal_client_name,
                    actor_user_id=current_user["id"],
                )

            connection.commit()

            return {
                "message": "Исполнители назначены",
                "request_id": request_id,
                "assigned_to": new_assigned_to,
                "executor_ids": executor_ids,
                "added_executor_ids": result["added_executor_ids"],
                "removed_executor_ids": result["removed_executor_ids"],
                "status": new_status,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/{request_id}/executors")
def get_request_executors_endpoint(
    request_id: int,
    current_user: dict = Depends(get_current_user)
):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.payment_type AS client_payment_type,
                    c.responsible_manager_id,
                    EXISTS (
                        SELECT 1
                        FROM request_executors re
                        WHERE re.request_id = r.id
                          AND re.user_id = %s
                    ) AS current_user_is_executor
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s
                  AND r.is_deleted = 0
                """,
                (
                    current_user["id"],
                    request_id,
                )
            )

            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            access_context = build_request_access_context(cursor, current_user)

            if not user_can_access_request(
                request,
                current_user,
                access_context["user_city"],
                access_context,
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра исполнителей этой заявки"
                )

            executors = get_request_executors(cursor, request_id)

            if is_client_user(current_user):
                return sanitize_executors_for_client(executors)

            return executors

    finally:
        connection.close()

@router.patch("/{request_id}")
def update_request(request_id: int, data: RequestUpdate, current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    ALLOWED_TRANSITIONS = {
        "NEW": ["IN_PROGRESS", "CANCELLED"],
        "IN_PROGRESS": ["COMPLETED", "CANCELLED"],
        "COMPLETED": [],
        "CANCELLED": []
    }

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.visit_price_code,
                    r.address,
                    r.city,
                    r.platform,
                    r.contact_name,
                    r.contact_phone,
                    r.scheduled_at,
                    r.schedule_approval_status,
                    r.schedule_approval_reason,
                    r.schedule_approval_requested_by,
                    r.schedule_approval_requested_at,
                    r.schedule_approval_decided_by,
                    r.schedule_approval_decided_at,
                    r.schedule_approval_comment,
                    r.status,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,

                    c.payment_type AS client_payment_type,

                    EXISTS (
                        SELECT 1
                        FROM request_executors re
                        WHERE re.request_id = r.id
                          AND re.user_id = %s
                    ) AS current_user_is_executor,

                    c.responsible_manager_id,

                    c.name AS portal_client_name,
                    c.company_name AS portal_client_company_name
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (current_user["id"], request_id)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            access_context = build_request_access_context(cursor, current_user)
            user_city = access_context["user_city"]

            if not user_can_access_request(req, current_user, user_city, access_context):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для редактирования этой заявки"
                )

            # Заявка подклиента, полученная через родителя, доступна
            # только на чтение.
            if request_is_inherited_from_subclient(req, current_user, access_context):
                raise HTTPException(
                    status_code=403,
                    detail="Заявка подклиента доступна только для просмотра"
                )

            # Право на оплату — это право на одно поле, а не на всю заявку.
            # Пока оно входило в can_edit_this_request, бухгалтер мог менять
            # адрес, город, платформу и дату любой заявки.
            can_edit_this_request = (
                can_edit_all_requests(current_user)
                or user_can_edit_own_or_responsible_request(current_user, req)
            )

            can_edit_request_payment = can_edit_payment_info(current_user)

            if (
                not can_edit_this_request
                and not can_edit_request_payment
                and data.status is None
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для редактирования этой заявки"
                )

            update_fields = []
            update_values = []

            # Изменения, о которых узнает клиент. Список закрытый:
            # поле попадает сюда, только если его явно пометили как
            # клиентское. Новое поле по умолчанию остаётся внутренним.
            portal_changes = []

            portal_client_name = (
                req.get("portal_client_company_name")
                or req.get("portal_client_name")
            )

            effective_visit_type = (
                data.visit_type if data.visit_type is not None else req["visit_type"]
            )

            if effective_visit_type not in ["IN_OFFICE", "ON_SITE"]:
                raise HTTPException(status_code=400, detail="Некорректный тип визита")

            requested_visit_price_code = (
                data.visit_price_code
                if data.visit_price_code is not None
                else req.get("visit_price_code")
            )
            effective_visit_price_code = resolve_visit_price_code(
                effective_visit_type,
                requested_visit_price_code,
            )
            schedule_rules_changed = False

            def add_history(action: str, old_value, new_value):
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
                        action,
                        str(old_value) if old_value is not None else None,
                        str(new_value) if new_value is not None else None
                    )
                )

            def add_portal_change(label: str, old_value, new_value, labels: dict | None = None):
                def show(value):
                    if labels:
                        return labels.get(str(value or ""), format_portal_value(value))

                    return format_portal_value(value)

                portal_changes.append(f"{label}: {show(old_value)} → {show(new_value)}")

            def add_request_update(
                field_name: str,
                new_value,
                history_action: str,
                portal_label: str | None = None,
                portal_labels: dict | None = None,
            ):
                old_value = req[field_name]

                if old_value != new_value:
                    update_fields.append(f"{field_name} = %s")
                    update_values.append(new_value)
                    add_history(history_action, old_value, new_value)

                    if portal_label:
                        add_portal_change(
                            portal_label,
                            old_value,
                            new_value,
                            portal_labels,
                        )

            # platform
            if data.platform is not None:
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                new_platform = data.platform.strip()

                if not new_platform:
                    raise HTTPException(
                        status_code=400,
                        detail="Платформа мониторинга не может быть пустой"
                    )

                add_request_update(
                    "platform",
                    new_platform,
                    "PLATFORM_CHANGED",
                    portal_label="платформа",
                )

            # visit_type
            if data.visit_type is not None and data.visit_type != req["visit_type"]:
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                add_request_update(
                    "visit_type",
                    data.visit_type,
                    "VISIT_TYPE_CHANGED",
                    portal_label="формат работ",
                    portal_labels=PORTAL_VISIT_TYPE_LABELS,
                )
                schedule_rules_changed = True

            # visit_price_code / тип выезда
            if (
                data.visit_type is not None
                or data.visit_price_code is not None
            ) and effective_visit_price_code != req.get("visit_price_code"):
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                add_request_update(
                    "visit_price_code",
                    effective_visit_price_code,
                    "VISIT_PRICE_CODE_CHANGED",
                    portal_label="тип выезда",
                    portal_labels=PORTAL_VISIT_PRICE_LABELS,
                )
                schedule_rules_changed = True

            # address
            if data.address is not None and data.address != req["address"]:
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                add_request_update(
                    "address",
                    data.address,
                    "ADDRESS_CHANGED",
                    portal_label="адрес",
                )

            # Контактное лицо заявки. Меняется той же кнопкой «Изменить
            # заявку», что и остальные поля: это данные заявки, а не
            # карточки клиента, и правка здесь на клиента не влияет.
            if (
                data.contact_name is not None
                and str(data.contact_name).strip() != str(req.get("contact_name") or "")
            ):
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                add_request_update(
                    "contact_name",
                    str(data.contact_name).strip() or None,
                    "CONTACT_NAME_CHANGED",
                    portal_label="контактное лицо",
                )

            if (
                data.contact_phone is not None
                and str(data.contact_phone).strip() != str(req.get("contact_phone") or "")
            ):
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                add_request_update(
                    "contact_phone",
                    str(data.contact_phone).strip() or None,
                    "CONTACT_PHONE_CHANGED",
                    portal_label="телефон контактного лица",
                )

            # city
            if data.city is not None and data.city != req["city"]:
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                add_request_update(
                    "city",
                    data.city,
                    "CITY_CHANGED",
                    portal_label="город",
                )

            # scheduled_at / желаемая дата выполнения
            scheduled_at_was_changed = False
            if data.scheduled_at is not None:
                new_scheduled_at = normalize_scheduled_at(data.scheduled_at)

                if req["scheduled_at"] != new_scheduled_at:
                    scheduled_at_was_changed = True
                    if not can_edit_this_request:
                        raise HTTPException(
                            status_code=403,
                            detail="Недостаточно прав для редактирования этой заявки"
                        )

                    validate_request_schedule(
                        scheduled_at=new_scheduled_at,
                        visit_type=effective_visit_type,
                        visit_price_code=effective_visit_price_code,
                        current_user=current_user,
                    )

                    schedule_approval = build_schedule_approval_data(
                        scheduled_at=new_scheduled_at,
                        current_user=current_user,
                        reason=data.schedule_approval_reason,
                    )

                    update_fields.append("scheduled_at = %s")
                    update_values.append(new_scheduled_at)

                    update_fields.append("schedule_approval_status = %s")
                    update_values.append(schedule_approval["status"])

                    update_fields.append("schedule_approval_reason = %s")
                    update_values.append(schedule_approval["reason"])

                    update_fields.append("schedule_approval_requested_by = %s")
                    update_values.append(schedule_approval["requested_by"])

                    update_fields.append("schedule_approval_requested_at = %s")
                    update_values.append(schedule_approval["requested_at"])

                    update_fields.append("schedule_approval_decided_by = %s")
                    update_values.append(schedule_approval["decided_by"])

                    update_fields.append("schedule_approval_decided_at = %s")
                    update_values.append(schedule_approval["decided_at"])

                    update_fields.append("schedule_approval_comment = %s")
                    update_values.append(schedule_approval["comment"])

                    add_history(
                        "SCHEDULED_AT_CHANGED",
                        req["scheduled_at"],
                        new_scheduled_at
                    )

                    # Перенос времени — то, ради чего уведомления и делались:
                    # клиент должен узнать об этом раньше, чем приедет монтажник.
                    add_portal_change(
                        "время работ",
                        req["scheduled_at"],
                        new_scheduled_at,
                    )

                    if schedule_approval["status"] == SCHEDULE_APPROVAL_PENDING:
                        add_history(
                            "SCHEDULE_APPROVAL_REQUESTED",
                            None,
                            schedule_approval["reason"]
                        )

            if (
                schedule_rules_changed
                and not scheduled_at_was_changed
                and req.get("scheduled_at") is not None
            ):
                validate_request_schedule(
                    scheduled_at=normalize_scheduled_at(req["scheduled_at"]),
                    visit_type=effective_visit_type,
                    visit_price_code=effective_visit_price_code,
                    current_user=current_user,
                )

            # payment
            if data.is_paid is not None:
                if not can_edit_request_payment:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав на изменение оплаты заявки"
                    )

                old_paid = bool(req["is_paid"])
                new_paid = bool(data.is_paid)

                if old_paid != new_paid:
                    paid_at_val = almaty_now() if new_paid else None

                    update_fields.append("is_paid = %s")
                    update_values.append(new_paid)

                    update_fields.append("paid_at = %s")
                    update_values.append(paid_at_val)

                    add_history("PAYMENT_UPDATED", f"is_paid={old_paid}", f"is_paid={new_paid}")

                    notify_request_payment_changed(
                        cursor=cursor,
                        request_id=request_id,
                        is_paid=new_paid,
                        actor_user_id=current_user["id"],
                    )

            # status
            if data.status is not None and data.status != req["status"]:
                if not can_change_request_status(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для изменения статуса"
                    )

                if data.status not in ["NEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"]:
                    raise HTTPException(status_code=400, detail="Некорректный статус заявки")

                if data.status == "COMPLETED":
                    raise HTTPException(
                        status_code=400,
                        detail="Завершение заявки выполняется только через /requests/{id}/complete"
                    )

                if not user_can_override_request_status_transitions(current_user):
                    allowed = ALLOWED_TRANSITIONS.get(req["status"], [])

                    if data.status not in allowed:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Нельзя сменить {req['status']} на {data.status}"
                        )

                add_request_update("status", data.status, "STATUS_CHANGED")

                notify_request_status_changed(
                    cursor=cursor,
                    request_id=request_id,
                    old_status=req["status"],
                    new_status=data.status,
                    assigned_to=req.get("assigned_to"),
                    actor_user_id=current_user["id"],
                )

                # Отмену клиенту показываем отдельным событием: у неё
                # свой текст и она всплывает, а не просто ложится
                # в колокольчик рядом с остальным.
                if data.status == "CANCELLED":
                    notify_portal_request_cancelled(
                        cursor=cursor,
                        request_id=request_id,
                        client_id=req.get("client_id"),
                        cancelled_by_client=False,
                        client_name=portal_client_name,
                        actor_user_id=current_user["id"],
                    )
                else:
                    notify_portal_request_status_changed(
                        cursor=cursor,
                        request_id=request_id,
                        client_id=req.get("client_id"),
                        old_status=req["status"],
                        new_status=data.status,
                        client_name=portal_client_name,
                        actor_user_id=current_user["id"],
                    )

            # Одно уведомление на всю правку, а не по одному на поле:
            # менеджер обычно меняет время и адрес одним действием,
            # и клиенту это одно событие, а не два.
            if portal_changes:
                notify_portal_request_updated(
                    cursor=cursor,
                    request_id=request_id,
                    client_id=req.get("client_id"),
                    changes=portal_changes,
                    client_name=portal_client_name,
                    actor_user_id=current_user["id"],
                )

            if update_fields:
                update_values.append(request_id)

                cursor.execute(
                    f"""
                    UPDATE requests
                    SET {', '.join(update_fields)}
                    WHERE id = %s
                    """,
                    tuple(update_values)
                )

            connection.commit()

            return {
                "message": "Request updated successfully",
                "updated_fields": len(update_fields)
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{request_id}/schedule-approval")
def decide_request_schedule_approval(
    request_id: int,
    data: RequestScheduleApproval,
    current_user: dict = Depends(get_current_user)
):
    if not user_can_decide_schedule_approval(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для согласования нерабочего времени"
        )

    if data.status not in [SCHEDULE_APPROVAL_APPROVED, SCHEDULE_APPROVAL_REJECTED]:
        raise HTTPException(
            status_code=400,
            detail="Статус согласования должен быть APPROVED или REJECTED"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.status,
                    r.scheduled_at,
                    r.schedule_approval_status,

                    c.name AS portal_client_name,
                    c.company_name AS portal_client_company_name
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (request_id,)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            portal_client_name = (
                req.get("portal_client_company_name")
                or req.get("portal_client_name")
            )

            if req["schedule_approval_status"] != SCHEDULE_APPROVAL_PENDING:
                raise HTTPException(
                    status_code=400,
                    detail="Эта заявка не ожидает согласования времени"
                )

            update_fields = [
                "schedule_approval_status = %s",
                "schedule_approval_decided_by = %s",
                "schedule_approval_decided_at = %s",
                "schedule_approval_comment = %s",
            ]

            update_values = [
                data.status,
                current_user["id"],
                almaty_now(),
                data.comment,
            ]

            if data.status == SCHEDULE_APPROVAL_REJECTED:
                update_fields.append("status = %s")
                update_values.append("CANCELLED")

            update_values.append(request_id)

            cursor.execute(
                f"""
                UPDATE requests
                SET {', '.join(update_fields)}
                WHERE id = %s
                """,
                tuple(update_values)
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
                    "SCHEDULE_APPROVAL_DECIDED",
                    req["schedule_approval_status"],
                    f"{data.status}: {data.comment or ''}".strip(),
                )
            )

            if data.status == SCHEDULE_APPROVAL_REJECTED and req["status"] != "CANCELLED":
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
                        "STATUS_CHANGED",
                        req["status"],
                        "CANCELLED",
                    )
                )

                notify_request_status_changed(
                    cursor=cursor,
                    request_id=request_id,
                    old_status=req["status"],
                    new_status="CANCELLED",
                    assigned_to=None,
                    actor_user_id=current_user["id"],
                )

                notify_portal_request_cancelled(
                    cursor=cursor,
                    request_id=request_id,
                    client_id=req.get("client_id"),
                    cancelled_by_client=False,
                    client_name=portal_client_name,
                    actor_user_id=current_user["id"],
                )

            # Причина согласования и комментарий администратора клиенту
            # не уходят: это переписка внутри компании, она и в карточке
            # ему не показывается.
            notify_portal_request_schedule_approval(
                cursor=cursor,
                request_id=request_id,
                client_id=req.get("client_id"),
                is_approved=(data.status == SCHEDULE_APPROVAL_APPROVED),
                scheduled_at=req.get("scheduled_at"),
                client_name=portal_client_name,
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "Согласование обновлено",
                "request_id": request_id,
                "schedule_approval_status": data.status,
                "request_status": "CANCELLED" if data.status == SCHEDULE_APPROVAL_REJECTED else req["status"],
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/{request_id}")
def delete_request(request_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.status,
                    r.created_by,
                    r.created_at,
                    r.is_deleted,
                    c.responsible_manager_id
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            if request["is_deleted"]:
                raise HTTPException(status_code=400, detail="Заявка уже удалена")

            access_context = build_request_access_context(cursor, current_user)

            # Заявка подклиента, видимая только через родителя,
            # удалению не подлежит.
            if request_is_inherited_from_subclient(request, current_user, access_context):
                raise HTTPException(
                    status_code=403,
                    detail="Заявка подклиента доступна только для просмотра"
                )

            can_delete = False

            if can_delete_any_request(current_user):
                can_delete = True

            elif can_delete_own_request_with_time_limit(current_user):
                is_creator = (
                    request.get("created_by") is not None
                    and int(request["created_by"]) == int(current_user["id"])
                )

                if not is_creator:
                    raise HTTPException(
                        status_code=403,
                        detail="Можно удалить только свою заявку"
                    )

                if request["status"] != "NEW":
                    raise HTTPException(
                        status_code=400,
                        detail="Удалить можно только новую заявку"
                    )

                if get_request_delete_seconds_left(request) <= 0:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Удалить свою заявку можно только в течение "
                            f"{REQUEST_DELETE_TIME_LIMIT_SECONDS // 60} мин. после создания"
                        )
                    )

                can_delete = True

            if not can_delete:
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для удаления заявки"
                )

            cursor.execute(
                """
                UPDATE requests
                SET is_deleted = 1,
                    deleted_at = %s,
                    deleted_by = %s
                WHERE id = %s
                """,
                (almaty_now(), current_user["id"], request_id)
            )

            cursor.execute(
                """
                INSERT INTO request_history
                (request_id, user_id, action, old_value, new_value)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "REQUEST_DELETED",
                    f"status={request['status']}",
                    "is_deleted=1"
                )
            )

            connection.commit()

            return {
                "message": "Заявка перемещена в корзину",
                "request_id": request_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{request_id}/restore")
def restore_request(request_id: int, current_user: dict = Depends(get_current_user)):
    """Восстановление заявки из корзины."""
    if not user_can_restore_deleted_requests(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для восстановления заявок")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, is_deleted
                FROM requests
                WHERE id = %s
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            if not request["is_deleted"]:
                raise HTTPException(status_code=400, detail="Заявка не находится в корзине")

            cursor.execute(
                """
                UPDATE requests
                SET is_deleted = 0,
                    deleted_at = NULL,
                    deleted_by = NULL
                WHERE id = %s
                """,
                (request_id,)
            )

            cursor.execute(
                """
                INSERT INTO request_history
                (request_id, user_id, action, old_value, new_value)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "REQUEST_RESTORED",
                    "is_deleted=1",
                    "is_deleted=0"
                )
            )

            connection.commit()

            return {
                "message": "Заявка восстановлена",
                "request_id": request_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/{request_id}/assign")
def assign_request(request_id: int, data: AssignRequest, current_user: dict = Depends(get_current_user)):
    if not can_manage_request_executors(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для назначения исполнителей")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем заявку
            cursor.execute(
                """
                SELECT
                    client_id,
                    status,
                    assigned_to,
                    schedule_approval_status
                FROM requests
                WHERE id = %s AND is_deleted = 0
                """,
                (request_id,)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            portal_client_name = get_portal_client_name(cursor, req.get("client_id"))

            if req.get("schedule_approval_status") == SCHEDULE_APPROVAL_PENDING:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя назначить заявку, пока не согласовано нерабочее время"
                )

            if req.get("schedule_approval_status") == SCHEDULE_APPROVAL_REJECTED:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя назначить заявку: нерабочее время отклонено администрацией"
                )

            # Снимать монтажника можно только с активной заявки
            if req["status"] not in ["NEW", "IN_PROGRESS"]:
                raise HTTPException(
                    status_code=400,
                    detail="Изменять назначение можно только у новой заявки или заявки в работе"
                )

            old_assigned_to = req["assigned_to"]

            # Если technician_id == None — снимаем назначенного монтажника
            if data.technician_id is None:
                cursor.execute(
                    """
                    UPDATE requests
                    SET assigned_to = NULL,
                        status = 'NEW'
                    WHERE id = %s
                    """,
                    (request_id,)
                )

                cursor.execute(
                    """
                    DELETE FROM request_executors
                    WHERE request_id = %s
                    """,
                    (request_id,)
                )

                cursor.execute(
                    """
                    INSERT INTO request_history
                    (request_id, user_id, action, old_value, new_value)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        current_user["id"],
                        "UNASSIGNED",
                        f"assigned_to={old_assigned_to}",
                        "assigned_to=NULL"
                    )
                )

                # Статус здесь возвращается в NEW, а записи STATUS_CHANGED
                # не было: в журнале заявки смена статуса не отражалась,
                # хотя /executors/assign и /complete её пишут. Дописываем,
                # иначе клиент получит уведомление о статусе, которого
                # нет в истории его же карточки.
                if req["status"] != "NEW":
                    cursor.execute(
                        """
                        INSERT INTO request_history
                        (request_id, user_id, action, old_value, new_value)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        (
                            request_id,
                            current_user["id"],
                            "STATUS_CHANGED",
                            req["status"],
                            "NEW",
                        )
                    )

                    notify_request_status_changed(
                        cursor=cursor,
                        request_id=request_id,
                        old_status=req["status"],
                        new_status="NEW",
                        assigned_to=None,
                        actor_user_id=current_user["id"],
                    )

                    notify_portal_request_status_changed(
                        cursor=cursor,
                        request_id=request_id,
                        client_id=req.get("client_id"),
                        old_status=req["status"],
                        new_status="NEW",
                        client_name=portal_client_name,
                        actor_user_id=current_user["id"],
                    )

                notify_portal_request_executors(
                    cursor=cursor,
                    request_id=request_id,
                    client_id=req.get("client_id"),
                    executor_names=[],
                    client_name=portal_client_name,
                    actor_user_id=current_user["id"],
                )

                connection.commit()

                return {
                    "message": "Technician unassigned",
                    "request_id": request_id
                }

            # Если technician_id НЕ None — назначаем монтажника.
            # Та же проверка, что и в /executors/assign: флаг исполнителя,
            # подтверждён, активен, не удалён. Раньше здесь проверялись
            # только роль и флаг — уволенного можно было назначить на заявку.
            technician_users = validate_request_executor_ids(
                cursor,
                [data.technician_id],
            )

            cursor.execute(
                """
                UPDATE requests
                SET assigned_to = %s,
                    status = 'IN_PROGRESS'
                WHERE id = %s
                """,
                (data.technician_id, request_id)
            )

            cursor.execute(
                """
                DELETE FROM request_executors
                WHERE request_id = %s
                """,
                (request_id,)
            )

            cursor.execute(
                """
                INSERT INTO request_executors (
                    request_id,
                    user_id,
                    assigned_by,
                    assigned_at
                )
                VALUES (%s, %s, %s, %s)
                """,
                (
                    request_id,
                    data.technician_id,
                    current_user["id"],
                    almaty_now(),
                )
            )

            cursor.execute(
                """
                INSERT INTO request_history
                (request_id, user_id, action, old_value, new_value)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "ASSIGNED",
                    f"assigned_to={old_assigned_to}",
                    f"assigned_to={data.technician_id}"
                )
            )

            notify_request_assigned(
                cursor=cursor,
                request_id=request_id,
                technician_id=data.technician_id,
                actor_user_id=current_user["id"],
            )

            # Та же недостающая запись, что и в ветке снятия исполнителя.
            if req["status"] != "IN_PROGRESS":
                cursor.execute(
                    """
                    INSERT INTO request_history
                    (request_id, user_id, action, old_value, new_value)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        current_user["id"],
                        "STATUS_CHANGED",
                        req["status"],
                        "IN_PROGRESS",
                    )
                )

                notify_request_status_changed(
                    cursor=cursor,
                    request_id=request_id,
                    old_status=req["status"],
                    new_status="IN_PROGRESS",
                    assigned_to=data.technician_id,
                    actor_user_id=current_user["id"],
                )

                notify_portal_request_status_changed(
                    cursor=cursor,
                    request_id=request_id,
                    client_id=req.get("client_id"),
                    old_status=req["status"],
                    new_status="IN_PROGRESS",
                    client_name=portal_client_name,
                    actor_user_id=current_user["id"],
                )

            notify_portal_request_executors(
                cursor=cursor,
                request_id=request_id,
                client_id=req.get("client_id"),
                executor_names=[
                    user.get("name")
                    for user in technician_users
                    if user.get("name")
                ],
                client_name=portal_client_name,
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "Technician assigned",
                "request_id": request_id,
                "technician_id": data.technician_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{request_id}/complete")
def complete_request(request_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, client_id, work_type, status, assigned_to, is_deleted
                FROM requests
                WHERE id = %s
                """,
                (request_id,)
            )
            req = cursor.fetchone()

            current_user_is_executor = user_is_request_executor(
                cursor=cursor,
                request_id=request_id,
                user_id=current_user["id"],
            )

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            if req["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя завершить удалённую заявку"
                )

            if req["status"] != "IN_PROGRESS":
                raise HTTPException(
                    status_code=400,
                    detail="Завершить можно только заявку в процессе"
                )

            if not req["assigned_to"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя завершить заявку без назначенного исполнителя"
                )

            is_main_executor = (
                req["assigned_to"] is not None
                and int(req["assigned_to"]) == int(current_user["id"])
            )

            if user_can_complete_any_request(current_user):
                pass
            elif user_can_complete_assigned_request(current_user):
                if not is_main_executor and not current_user_is_executor:
                    raise HTTPException(
                        status_code=403,
                        detail="Исполнитель может завершить только свою заявку"
                    )
            else:
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для завершения заявки"
                )

            # ----------------------------------------------------------------
            # Проверки перед завершением работ.
            #
            # Порядок важен: без VIN оборудование всё равно не привязать,
            # и монтажник должен увидеть сначала «нет VIN», а не «нет
            # оборудования» — иначе он полезет привязывать и упрётся
            # во вторую стену.
            # ----------------------------------------------------------------

            # 1. VIN — для всех видов работ.
            #
            # Клиент вроде ФортеБанка создаёт заявку без VIN: машину
            # показывает поставщик уже на месте. Здесь эта отсрочка
            # заканчивается — монтажник стоит у машины и VIN видит.
            vehicles_without_vin = find_request_vehicles_without_vin(cursor, request_id)

            if vehicles_without_vin:
                cursor.execute(
                    """
                    SELECT id
                    FROM request_vehicles
                    WHERE request_id = %s
                    ORDER BY id ASC
                    """,
                    (request_id,),
                )

                # Позиция машины в заявке, а не в списке «без VIN»:
                # иначе третье авто назвалось бы первым.
                position_by_request_vehicle_id = {
                    int(row["id"]): index
                    for index, row in enumerate(cursor.fetchall() or [], start=1)
                }

                missing_vin_names = ", ".join(
                    describe_vehicle_without_vin(
                        vehicle,
                        position_by_request_vehicle_id.get(
                            int(vehicle["request_vehicle_id"])
                        ),
                    )
                    for vehicle in vehicles_without_vin
                )

                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Нельзя завершить работы, пока не указан VIN: "
                        f"{missing_vin_names}. Впишите VIN в карточке заявки "
                        "или обратитесь к ответственному менеджеру."
                    ),
                )

            # 2. Оборудование — только для установки (решение Р43).
            #
            # Требуем хотя бы одну единицу на КАЖДУЮ машину: установка
            # делается по машинам, и заявка на три авто с оборудованием,
            # привязанным к одной, — это потерянные два трекера.
            #
            # Снятие, диагностика и перепрошивка сюда не попадают:
            # там оборудования может не быть вовсе.
            if str(req.get("work_type") or "") == "INSTALLATION":
                cursor.execute(
                    """
                    SELECT
                        rv.id AS request_vehicle_id,
                        v.brand,
                        v.model,
                        v.plate_number,
                        v.vin,
                        COUNT(re.id) AS equipment_count
                    FROM request_vehicles rv
                    LEFT JOIN vehicles v ON v.id = rv.vehicle_id
                    LEFT JOIN request_equipment re
                        ON re.request_vehicle_id = rv.id
                    WHERE rv.request_id = %s
                    GROUP BY
                        rv.id,
                        v.brand,
                        v.model,
                        v.plate_number,
                        v.vin
                    HAVING COUNT(re.id) = 0
                    ORDER BY rv.id ASC
                    """,
                    (request_id,),
                )

                vehicles_without_equipment = cursor.fetchall() or []

                if vehicles_without_equipment:
                    cursor.execute(
                        """
                        SELECT id
                        FROM request_vehicles
                        WHERE request_id = %s
                        ORDER BY id ASC
                        """,
                        (request_id,),
                    )

                    position_by_request_vehicle_id = {
                        int(row["id"]): index
                        for index, row in enumerate(cursor.fetchall() or [], start=1)
                    }

                    missing_equipment_names = ", ".join(
                        describe_vehicle_without_vin(
                            vehicle,
                            position_by_request_vehicle_id.get(
                                int(vehicle["request_vehicle_id"])
                            ),
                        )
                        for vehicle in vehicles_without_equipment
                    )

                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Нельзя завершить установку: не привязано "
                            f"оборудование к машинам — {missing_equipment_names}. "
                            "Привяжите оборудование в карточке заявки."
                        ),
                    )

            cursor.execute(
                """
                UPDATE requests
                SET status = 'COMPLETED'
                WHERE id = %s
                """,
                (request_id,)
            )

            if req.get("work_type") == "REMOVAL":
                # 1. Оборудование, привязанное напрямую к авто через vehicle_equipment.
                # Берём:
                # - серийные устройства;
                # - возвратные расходники, например RELAY.
                cursor.execute(
                    """
                    SELECT
                        ve.id AS vehicle_equipment_link_id,
                        NULL AS source_request_equipment_id,
                        NULL AS source_request_id,
                        NULL AS source_request_vehicle_id,

                        rv.id AS removal_request_vehicle_id,
                        rv.vehicle_id,

                        ve.warehouse_item_id,
                        ve.quantity,

                        wi.category,
                        wi.name,
                        wi.manufacturer,
                        wi.model,
                        wi.identifier_type,
                        wi.identifier_value,
                        wi.serial_number,
                        wi.is_serialized,
                        wi.status AS warehouse_status,
                        wi.condition_status,
                        wi.returnable_on_removal,
                        wi.city_id,

                        v.brand,
                        v.model AS vehicle_model,
                        v.plate_number,
                        v.vin
                    FROM request_vehicles rv
                    INNER JOIN vehicle_equipment ve
                        ON ve.vehicle_id = rv.vehicle_id
                       AND ve.is_active = 1
                    INNER JOIN warehouse_items wi
                        ON wi.id = ve.warehouse_item_id
                    LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                    WHERE rv.request_id = %s
                      AND (
                            (
                                wi.is_serialized = 1
                                AND wi.is_deleted = 0
                            )
                            OR (
                                wi.is_serialized = 0
                                AND wi.returnable_on_removal = 1
                            )
                      )
                    FOR UPDATE
                    """,
                    (request_id,)
                )

                direct_removal_rows = cursor.fetchall()

                # 2. Оборудование, которое было установлено через старую заявку установки.
                # Серийные устройства считаем активными по wi.status = INSTALLED.
                # Возвратные расходники считаем по request_equipment, но защищаемся
                # от повторного возврата через warehouse_item_movements.
                cursor.execute(
                    """
                    SELECT
                        NULL AS vehicle_equipment_link_id,
                        re.id AS source_request_equipment_id,
                        re.request_id AS source_request_id,
                        re.request_vehicle_id AS source_request_vehicle_id,

                        removal_rv.id AS removal_request_vehicle_id,
                        removal_rv.vehicle_id,

                        re.warehouse_item_id,
                        re.quantity,

                        wi.category,
                        wi.name,
                        wi.manufacturer,
                        wi.model,
                        wi.identifier_type,
                        wi.identifier_value,
                        wi.serial_number,
                        wi.is_serialized,
                        wi.status AS warehouse_status,
                        wi.condition_status,
                        wi.returnable_on_removal,
                        wi.city_id,

                        v.brand,
                        v.model AS vehicle_model,
                        v.plate_number,
                        v.vin
                    FROM request_vehicles removal_rv
                    INNER JOIN request_vehicles source_rv
                        ON source_rv.vehicle_id = removal_rv.vehicle_id
                    INNER JOIN request_equipment re
                        ON re.request_vehicle_id = source_rv.id
                    INNER JOIN requests source_r
                        ON source_r.id = re.request_id
                       AND source_r.is_deleted = 0
                    INNER JOIN warehouse_items wi
                        ON wi.id = re.warehouse_item_id
                    LEFT JOIN vehicles v ON removal_rv.vehicle_id = v.id
                    WHERE removal_rv.request_id = %s
                      AND re.request_id <> %s
                      AND source_r.work_type = 'INSTALLATION'
                      AND (
                            (
                                wi.is_serialized = 1
                                AND wi.is_deleted = 0
                                AND wi.status = 'INSTALLED'
                            )
                            OR (
                                wi.is_serialized = 0
                                AND wi.returnable_on_removal = 1
                                AND NOT EXISTS (
                                    SELECT 1
                                    FROM warehouse_item_movements wm
                                    WHERE wm.request_equipment_id = re.id
                                      AND wm.action = 'RETURNABLE_CONSUMABLE_RETURNED_AFTER_REMOVAL'
                                )
                            )
                      )
                    ORDER BY re.attached_at DESC, re.id DESC
                    FOR UPDATE
                    """,
                    (
                        request_id,
                        request_id,
                    )
                )

                request_source_removal_rows = cursor.fetchall()

                removal_equipment_rows = (
                    list(direct_removal_rows or [])
                    + list(request_source_removal_rows or [])
                )

                processed_keys = set()
                removed_equipment_count = 0
                returned_consumables_count = 0

                for equipment_row in removal_equipment_rows:
                    warehouse_item_id = int(equipment_row["warehouse_item_id"])
                    is_serialized = bool(equipment_row.get("is_serialized"))
                    is_returnable_consumable = (
                        not is_serialized
                        and bool(equipment_row.get("returnable_on_removal"))
                    )

                    if is_serialized:
                        processed_key = ("SERIALIZED", warehouse_item_id)
                    elif equipment_row.get("vehicle_equipment_link_id"):
                        processed_key = (
                            "DIRECT_CONSUMABLE",
                            int(equipment_row["vehicle_equipment_link_id"])
                        )
                    else:
                        processed_key = (
                            "REQUEST_CONSUMABLE",
                            int(equipment_row["source_request_equipment_id"])
                        )

                    if processed_key in processed_keys:
                        continue

                    processed_keys.add(processed_key)

                    old_warehouse_status = equipment_row.get("warehouse_status")
                    old_condition_status = equipment_row.get("condition_status") or "NEW"

                    vehicle_title = f"{equipment_row.get('brand') or ''} {equipment_row.get('vehicle_model') or ''}".strip()

                    if equipment_row.get("plate_number"):
                        vehicle_title += f" ({equipment_row.get('plate_number')})"

                    if equipment_row.get("vin"):
                        vehicle_title += f" VIN: {equipment_row.get('vin')}"

                    item_title = equipment_row.get("name") or "Оборудование"

                    if equipment_row.get("model"):
                        item_title += f" {equipment_row.get('model')}"

                    if equipment_row.get("identifier_value"):
                        item_title += (
                            f" ({equipment_row.get('identifier_type')}: "
                            f"{equipment_row.get('identifier_value')})"
                        )
                    elif equipment_row.get("serial_number"):
                        item_title += f" (S/N: {equipment_row.get('serial_number')})"

                    quantity = int(equipment_row.get("quantity") or 1)

                    # Если оборудование было привязано напрямую к авто — закрываем активную связь.
                    if equipment_row.get("vehicle_equipment_link_id"):
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
                                f"Снято при завершении заявки #{request_id}",
                                equipment_row["vehicle_equipment_link_id"],
                            )
                        )

                    if is_serialized:
                        # Серийное устройство возвращаем на склад и помечаем как БУ.
                        cursor.execute(
                            """
                            UPDATE warehouse_items
                            SET status = 'IN_STOCK',
                                condition_status = 'USED',
                                assigned_to_user_id = NULL,
                                assigned_at = NULL,
                                assigned_by = NULL,
                                updated_at = NOW()
                            WHERE id = %s
                            """,
                            (warehouse_item_id,)
                        )

                        movement_warehouse_item_id = warehouse_item_id
                        movement_action = "REMOVAL_COMPLETED_MARKED_USED"
                        movement_old_status = old_warehouse_status
                        movement_new_status = "IN_STOCK"
                        movement_old_value = old_condition_status
                        movement_new_value = "USED"
                        movement_reason = (
                            f"Оборудование снято с авто при завершении заявки на снятие. "
                        )

                        removed_equipment_count += 1

                    elif is_returnable_consumable:
                        # Возвратный расходник, например RELAY.
                        # Важно: НЕ меняем condition_status у исходной строки,
                        # потому что там могут остаться новые реле.
                        # Возвращаем снятое количество в отдельную БУ-пачку.
                        cursor.execute(
                            """
                            SELECT id, quantity
                            FROM warehouse_items
                            WHERE category = %s
                              AND name = %s
                              AND manufacturer <=> %s
                              AND model <=> %s
                              AND city_id = %s
                              AND is_serialized = 0
                              AND status = 'IN_STOCK'
                              AND condition_status = 'USED'
                              AND assigned_to_user_id IS NULL
                              AND is_deleted = 0
                            LIMIT 1
                            FOR UPDATE
                            """,
                            (
                                equipment_row.get("category"),
                                equipment_row.get("name"),
                                equipment_row.get("manufacturer"),
                                equipment_row.get("model"),
                                equipment_row.get("city_id"),
                            )
                        )

                        used_bucket = cursor.fetchone()

                        if used_bucket:
                            returned_bucket_id = used_bucket["id"]

                            cursor.execute(
                                """
                                UPDATE warehouse_items
                                SET quantity = quantity + %s,
                                    updated_at = NOW()
                                WHERE id = %s
                                """,
                                (
                                    quantity,
                                    returned_bucket_id,
                                )
                            )
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
                                    created_by,
                                    updated_at
                                )
                                VALUES (%s, %s, %s, %s, 'NONE', NULL, NULL, 0, %s, %s, 'IN_STOCK', 'USED', %s, %s, NOW())
                                """,
                                (
                                    equipment_row.get("category"),
                                    equipment_row.get("name"),
                                    equipment_row.get("manufacturer"),
                                    equipment_row.get("model"),
                                    quantity,
                                    equipment_row.get("city_id"),
                                    f"Автоматически возвращено как БУ после снятия. Источник: warehouse_item_id={warehouse_item_id}",
                                    current_user["id"],
                                )
                            )

                            returned_bucket_id = cursor.lastrowid

                        movement_warehouse_item_id = returned_bucket_id
                        movement_action = "RETURNABLE_CONSUMABLE_RETURNED_AFTER_REMOVAL"
                        movement_old_status = old_warehouse_status
                        movement_new_status = "IN_STOCK"
                        movement_old_value = f"source_item_id={warehouse_item_id}, condition={old_condition_status}"
                        movement_new_value = f"returned_quantity={quantity}, condition=USED"
                        movement_reason = (
                            f"Возвратный расходник снят с авто и возвращён на склад как БУ. "
                        )

                        returned_consumables_count += quantity
                        removed_equipment_count += quantity

                    else:
                        continue

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
                            quantity,
                            old_status,
                            new_status,
                            old_value,
                            new_value,
                            reason,
                            created_by
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            movement_warehouse_item_id,
                            movement_action,
                            equipment_row.get("city_id"),
                            equipment_row.get("city_id"),
                            request_id,
                            equipment_row.get("removal_request_vehicle_id"),
                            equipment_row.get("vehicle_id"),
                            equipment_row.get("source_request_equipment_id"),
                            quantity,
                            movement_old_status,
                            movement_new_status,
                            movement_old_value,
                            movement_new_value,
                            movement_reason,
                            current_user["id"],
                        )
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
                            "REMOVAL_EQUIPMENT_DETACHED",
                            f"{item_title}, quantity={quantity}, status={old_warehouse_status}, condition={old_condition_status}",
                            f"Снято с авто и возвращено на склад как БУ.",
                        )
                    )

                if removed_equipment_count > 0:
                    result_text = f"Снято и помечено как БУ: {removed_equipment_count} ед."

                    if returned_consumables_count > 0:
                        result_text += f" В том числе возвратных расходников: {returned_consumables_count} шт."

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
                            "REMOVAL_COMPLETED_EQUIPMENT_RESULT",
                            None,
                            result_text,
                        )
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
                    "STATUS_CHANGED",
                    "IN_PROGRESS",
                    "COMPLETED"
                )
            )

            notify_request_status_changed(
                cursor=cursor,
                request_id=request_id,
                old_status="IN_PROGRESS",
                new_status="COMPLETED",
                assigned_to=req["assigned_to"],
                actor_user_id=current_user["id"],
            )

            notify_portal_request_status_changed(
                cursor=cursor,
                request_id=request_id,
                client_id=req.get("client_id"),
                old_status="IN_PROGRESS",
                new_status="COMPLETED",
                client_name=get_portal_client_name(cursor, req.get("client_id")),
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "Заявка завершена",
                "request_id": request_id,
                "status": "COMPLETED"
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/calendar")
def get_requests_calendar(
    date_from: str = Query(...),
    date_to: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Лёгкий endpoint для календаря заявок.

    Право "Календарь заявок" открывает свои заявки по data_scope роли.
    Право "Общий календарь заявок" добавляет чужие заявки как занятые слоты,
    но без данных клиента — детали по-прежнему контролирует can_open_details.
    """
    if not user_can_view_calendar(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра календаря заявок",
        )

    range_from = parse_calendar_date(date_from, "date_from")
    range_to = parse_calendar_date(date_to, "date_to")

    if range_to <= range_from:
        raise HTTPException(
            status_code=400,
            detail="date_to должен быть больше date_from"
        )

    if (range_to - range_from).days > 31:
        raise HTTPException(
            status_code=400,
            detail="Календарь можно загружать максимум за 31 день"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            access_context = build_request_access_context(cursor, current_user)
            user_city = access_context["user_city"]

            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.visit_price_code,
                    r.address,
                    r.city,
                    r.platform,
                    r.contact_name,
                    r.contact_phone,
                    r.scheduled_at,
                    r.scheduled_duration_minutes,
                    r.schedule_approval_status,
                    r.status,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,

                    c.name AS client_name,
                    c.company_name,
                    c.payment_type AS client_payment_type,
                    c.responsible_manager_id,

                    creator.name AS created_by_name,
                    responsible.name AS responsible_manager_name,

                    assigned_user.name AS assigned_to_name,

                    EXISTS (
                        SELECT 1
                        FROM request_executors re_current
                        WHERE re_current.request_id = r.id
                          AND re_current.user_id = %s
                    ) AS current_user_is_executor,

                    GROUP_CONCAT(
                        DISTINCT
                        TRIM(
                            CONCAT(
                                COALESCE(v.brand, ''),
                                ' ',
                                COALESCE(v.model, ''),
                                CASE
                                    WHEN v.plate_number IS NOT NULL AND v.plate_number <> ''
                                    THEN CONCAT(' (', v.plate_number, ')')
                                    ELSE ''
                                END
                            )
                        )
                        ORDER BY rv.id ASC
                        SEPARATOR ', '
                    ) AS vehicles_summary,

                    GROUP_CONCAT(
                        DISTINCT executor_user.name
                        ORDER BY executor_user.name ASC
                        SEPARATOR ', '
                    ) AS executors_summary

                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                LEFT JOIN users creator ON r.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                LEFT JOIN users assigned_user ON r.assigned_to = assigned_user.id

                LEFT JOIN request_vehicles rv ON rv.request_id = r.id
                LEFT JOIN vehicles v ON rv.vehicle_id = v.id

                LEFT JOIN request_executors re ON re.request_id = r.id
                LEFT JOIN users executor_user ON re.user_id = executor_user.id

                WHERE r.is_deleted = 0
                  AND r.scheduled_at IS NOT NULL
                  AND r.scheduled_at >= %s
                  AND r.scheduled_at < %s

                GROUP BY
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.visit_price_code,
                    r.address,
                    r.city,
                    r.platform,
                    r.contact_name,
                    r.contact_phone,
                    r.scheduled_at,
                    r.scheduled_duration_minutes,
                    r.schedule_approval_status,
                    r.status,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.name,
                    c.company_name,
                    c.payment_type,
                    c.responsible_manager_id,
                    creator.name,
                    responsible.name,
                    assigned_user.name

                ORDER BY r.scheduled_at ASC, r.id ASC
                """,
                (
                    current_user["id"],
                    range_from,
                    range_to,
                )
            )

            rows = cursor.fetchall()

            result = []

            can_view_foreign_requests = user_can_view_all_calendar(current_user)

            for row in rows:
                can_open_details = user_can_access_request(
                    row,
                    current_user,
                    user_city,
                    access_context,
                )

                # Без права "Общий календарь заявок" видно только свои заявки.
                if not can_open_details and not can_view_foreign_requests:
                    continue

                duration_minutes = int(row.get("scheduled_duration_minutes") or 60)
                scheduled_at = row.get("scheduled_at")
                scheduled_end_at = None

                if scheduled_at:
                    scheduled_end_at = scheduled_at + timedelta(
                        minutes=duration_minutes
                    )

                vehicles_summary = row.get("vehicles_summary") or ""

                if can_open_details:
                    client_title = (
                        row.get("company_name")
                        or row.get("client_name")
                        or f"Клиент #{row.get('client_id')}"
                    )
                else:
                    # Чужая заявка видна как занятый слот, без данных клиента.
                    client_title = "Заявка другого сотрудника"
                    vehicles_summary = ""

                result.append({
                    "id": row["id"],
                    "client_id": row["client_id"] if can_open_details else None,

                    "title": f"{client_title} · {vehicles_summary or 'Авто не указано'}",

                    "work_type": row["work_type"],
                    "visit_type": row["visit_type"],
                    "visit_price_code": row.get("visit_price_code"),
                    "status": row["status"],
                    "city": row["city"],
                    "address": row["address"] if can_open_details else None,
                    "platform": row["platform"],

                    "scheduled_at": row["scheduled_at"],
                    "scheduled_end_at": scheduled_end_at,
                    "scheduled_duration_minutes": duration_minutes,

                    "schedule_approval_status": row.get("schedule_approval_status"),

                    "client_name": row.get("client_name") if can_open_details else None,
                    "company_name": row.get("company_name") if can_open_details else None,
                    "vehicles_summary": vehicles_summary,
                    "assigned_to_name": row.get("assigned_to_name"),
                    "executors_summary": (
                        row.get("executors_summary")
                        or row.get("assigned_to_name")
                        or ""
                    ),
                    "responsible_manager_name": (
                        row.get("responsible_manager_name") if can_open_details else None
                    ),
                    "created_by_name": (
                        row.get("created_by_name") if can_open_details else None
                    ),

                    "can_open_details": bool(can_open_details),

                    "is_inherited_access": request_is_inherited_from_subclient(
                        row,
                        current_user,
                        access_context,
                    ),
                })

            return {
                "date_from": range_from,
                "date_to": range_to,
                "items": result,
                "total": len(result),
            }

    finally:
        connection.close()

@router.get("/{request_id}")
def get_request_detail(request_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.visit_price_code,
                    r.address,
                    r.city,
                    r.platform,
                    r.contact_name,
                    r.contact_phone,
                    r.scheduled_at,
                    r.schedule_approval_status,
                    r.schedule_approval_reason,
                    r.schedule_approval_requested_by,
                    r.schedule_approval_requested_at,
                    r.schedule_approval_decided_by,
                    r.schedule_approval_decided_at,
                    r.schedule_approval_comment,
                    r.status,
                    r.created_at,
                    r.assigned_to,
                    r.is_paid,
                    r.paid_at,
                    r.total_price,
                    r.created_by,
                    c.status AS client_status,
                    c.payment_type AS client_payment_type,
                    c.responsible_manager_id,
                    c.created_by AS client_created_by,
                    c.parent_client_id,
                    responsible.name AS responsible_manager_name,

                    parent_client.name AS parent_client_name,
                    parent_client.company_name AS parent_client_company_name,

                    creator.name AS created_by_name,
                    creator.role AS created_by_role,

                    c.name AS client_name,
                    c.company_name,
                    c.phone,
                    c.email,
                    c.type AS client_type,

                    EXISTS (
                        SELECT 1
                        FROM request_executors re
                        WHERE re.request_id = r.id
                          AND re.user_id = %s
                    ) AS current_user_is_executor
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                LEFT JOIN clients parent_client
                    ON parent_client.id = c.parent_client_id
                   AND parent_client.is_deleted = 0
                LEFT JOIN users creator ON r.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (current_user["id"], request_id)
            )
            request_data = cursor.fetchone()

            if not request_data:
                raise HTTPException(status_code=404, detail="Request not found")

            access_context = build_request_access_context(cursor, current_user)
            user_city = access_context["user_city"]

            if not user_can_access_request(
                request_data,
                current_user,
                user_city,
                access_context,
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра деталей этой заявки"
                )

            request_data = attach_vehicles_to_requests(cursor, [request_data])[0]
            request_data = attach_executors_to_requests(cursor, [request_data])[0]
            attach_request_permissions(request_data, current_user, access_context)

            cursor.execute(
                """
                SELECT
                    rc.id,
                    u.name AS author,
                    rc.message,
                    rc.created_at
                FROM request_comments rc
                LEFT JOIN users u ON rc.user_id = u.id
                WHERE rc.request_id = %s
                ORDER BY rc.created_at ASC
                """,
                (request_id,)
            )
            comments = cursor.fetchall()

            cursor.execute(
                """
                SELECT
                    h.action,
                    h.old_value,
                    h.new_value,
                    h.created_at,
                    u.name AS user_name
                FROM request_history h
                LEFT JOIN users u ON h.user_id = u.id
                WHERE h.request_id = %s
                ORDER BY h.created_at ASC
                """,
                (request_id,)
            )
            history = cursor.fetchall()

            # Для клиентской учётной записи история режется по белому списку,
            # а ID исполнителей заменяются именами. Для сотрудников — как есть.
            history = filter_request_history_for_client(
                cursor,
                history,
                current_user,
            )

            if not user_can_view_request_prices(current_user):
                request_data["total_price"] = None
                price_lines = []
            else:
                cursor.execute(
                    """
                    SELECT
                        id,
                        request_id,
                        request_vehicle_id,
                        line_key,
                        code,
                        label,
                        quantity,
                        unit,
                        unit_price,
                        total_price,
                        source,
                        is_manual,
                        created_at
                    FROM request_price_lines
                    WHERE request_id = %s
                    ORDER BY id ASC
                    """,
                    (request_id,)
                )

                price_lines = cursor.fetchall()

            request_data["price_lines"] = price_lines

            sanitize_request_for_client(request_data, current_user)

            return {
                "request": request_data,
                "vehicles": request_data["vehicles"],
                "executors": request_data["executors"],
                "comments": comments,
                "history": history,
                "price_lines": price_lines
            }

    finally:
        connection.close()

@router.get("/{request_id}/comments")
def get_comments(request_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.payment_type AS client_payment_type,
                    c.responsible_manager_id,

                    EXISTS (
                        SELECT 1
                        FROM request_executors re
                        WHERE re.request_id = r.id
                          AND re.user_id = %s
                    ) AS current_user_is_executor
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (current_user["id"], request_id)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            access_context = build_request_access_context(cursor, current_user)

            if not user_can_access_request(
                request,
                current_user,
                access_context["user_city"],
                access_context,
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра комментариев этой заявки"
                )

            sql = """
            SELECT rc.id, u.name AS author, rc.message, rc.created_at
            FROM request_comments rc
            LEFT JOIN users u ON rc.user_id = u.id
            WHERE rc.request_id = %s
            ORDER BY rc.created_at ASC
            """
            cursor.execute(sql, (request_id,))
            return cursor.fetchall()
    finally:
        connection.close()

@router.post("/{request_id}/accept")
def accept_request(
    request_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Самостоятельное принятие заявки монтажником.
    TECHNICIAN может принять только оплаченную свободную заявку своего города.
    SENIOR_TECHNICIAN может принять свободную заявку без ограничения по городу.
    """
    if not user_can_self_accept_requests(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для самостоятельного принятия заявки"
        )

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, role, city
                FROM users
                WHERE id = %s
                """,
                (current_user["id"],)
            )
            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if user_is_limited_executor(current_user) and not user["city"]:
                raise HTTPException(
                    status_code=400,
                    detail="У пользователя не указан город"
                )

            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.city,
                    r.status,
                    r.assigned_to,
                    r.is_paid,
                    r.is_deleted,
                    r.schedule_approval_status,
                    c.payment_type AS client_payment_type,

                    c.name AS portal_client_name,
                    c.company_name AS portal_client_company_name
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Request not found")

            if request["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя принять удалённую заявку"
                )

            if request.get("schedule_approval_status") == SCHEDULE_APPROVAL_PENDING:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя принять заявку, пока не согласовано нерабочее время"
                )

            if request.get("schedule_approval_status") == SCHEDULE_APPROVAL_REJECTED:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя принять заявку: нерабочее время отклонено администрацией"
                )

            if (
                user_is_limited_executor(current_user)
                and not request_is_visible_to_technician_by_payment(request)
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Обычный монтажник может принять только оплаченную заявку или заявку клиента с постоплатой"
                )

            if user_is_limited_executor(current_user) and request["city"] != user["city"]:
                raise HTTPException(
                    status_code=403,
                    detail="Нельзя принять заявку другого города"
                )

            if request["assigned_to"] is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Заявка уже назначена другому монтажнику"
                )

            if request["status"] not in ["NEW"]:
                raise HTTPException(
                    status_code=400,
                    detail="Можно принять только новую заявку"
                )

            cursor.execute(
                """
                UPDATE requests
                SET assigned_to = %s,
                    status = 'IN_PROGRESS'
                WHERE id = %s
                  AND assigned_to IS NULL
                  AND status = 'NEW'
                """,
                (current_user["id"], request_id)
            )

            # rowcount читаем сразу после UPDATE: любой следующий запрос
            # его перезапишет, и проверка перестанет ловить гонку.
            if cursor.rowcount == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Заявку уже успели принять или изменить"
                )

            cursor.execute(
                """
                INSERT INTO request_executors (
                    request_id,
                    user_id,
                    assigned_by,
                    assigned_at
                )
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    assigned_by = VALUES(assigned_by),
                    assigned_at = VALUES(assigned_at)
                """,
                (
                    request_id,
                    current_user["id"],
                    current_user["id"],
                    almaty_now(),
                )
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
                    "SELF_ACCEPTED",
                    "assigned_to=NULL, status=NEW",
                    f"assigned_to={current_user['id']}, status=IN_PROGRESS"
                )
            )

            notify_request_self_accepted(
                cursor=cursor,
                request_id=request_id,
                technician_id=current_user["id"],
                actor_user_id=current_user["id"],
            )

            # Запись SELF_ACCEPTED в истории есть, а STATUS_CHANGED не было —
            # то же расхождение, что в /assign. Клиенту статус меняется
            # на «Принято в работу», и в журнале это должно быть видно.
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
                    "STATUS_CHANGED",
                    "NEW",
                    "IN_PROGRESS",
                )
            )

            portal_client_name = (
                request.get("portal_client_company_name")
                or request.get("portal_client_name")
            )

            notify_portal_request_status_changed(
                cursor=cursor,
                request_id=request_id,
                client_id=request.get("client_id"),
                old_status="NEW",
                new_status="IN_PROGRESS",
                client_name=portal_client_name,
                actor_user_id=current_user["id"],
            )

            notify_portal_request_executors(
                cursor=cursor,
                request_id=request_id,
                client_id=request.get("client_id"),
                executor_names=[current_user.get("name")],
                client_name=portal_client_name,
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "Заявка принята",
                "request_id": request_id,
                "assigned_to": current_user["id"],
                "status": "IN_PROGRESS"
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.post("/{request_id}/portal/cancel")
def cancel_portal_request(
    request_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Отмена собственной заявки из личного кабинета.

    Границы, принятые в решении Р18 (вариант А):
      - только заявка своего клиента, не подклиента — ветка открыта
        на чтение, действия по ней остаются у сотрудников;
      - только статус NEW: как только заявку приняли в работу, отменять
        её нужно через менеджера, иначе монтажник узнает об отмене,
        уже выехав.

    Блокировка клиента отмену НЕ запрещает. Режим чтения закрывает
    создание новых обязательств, а не отзыв своих: заставлять
    заблокированного клиента ждать выезда по ненужной заявке
    бессмысленно.
    """
    if not is_client_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Эндпоинт предназначен для личного кабинета клиента",
        )

    if not can_cancel_portal_request(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для отмены заявки",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.status,
                    r.assigned_to,
                    r.created_by,
                    r.is_deleted,
                    c.responsible_manager_id
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s
                  AND r.is_deleted = 0
                """,
                (request_id,),
            )

            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            access_context = build_request_access_context(cursor, current_user)

            if not user_can_access_request(
                request,
                current_user,
                access_context["user_city"],
                access_context,
            ):
                # 404, а не 403: клиенту не за чем знать, что заявка
                # с таким номером вообще существует.
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            own_client_id = get_user_client_id(current_user)
            request_client_id = request.get("client_id")

            is_own_client_request = (
                own_client_id is not None
                and request_client_id is not None
                and int(request_client_id) == int(own_client_id)
            )

            # Та же пара условий, что и во флаге can_cancel: своя заявка
            # либо заявка ветки, заведённая из этого же кабинета.
            # Правило продублировано намеренно — флаг подсказывает
            # интерфейсу, а решает сервер.
            created_by = request.get("created_by")
            portal_user_ids = access_context.get("portal_user_ids") or set()

            created_from_portal = (
                created_by is not None and int(created_by) in portal_user_ids
            )

            if not is_own_client_request and not created_from_portal:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Эту заявку оформлял ваш менеджер. "
                        "Отмену выполняет он же."
                    ),
                )

            if str(request.get("status")) != "NEW":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Отменить можно только заявку в статусе «В ожидании». "
                        "Свяжитесь с вашим менеджером."
                    ),
                )

            cursor.execute(
                """
                UPDATE requests
                SET status = 'CANCELLED'
                WHERE id = %s
                  AND status = 'NEW'
                  AND is_deleted = 0
                """,
                (request_id,),
            )

            # rowcount читаем сразу после UPDATE: следующий запрос его
            # перезапишет. Та же защита от гонки, что и в accept_request —
            # заявку могли принять в работу секунду назад.
            if cursor.rowcount == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Заявку уже успели принять или изменить",
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
                    "STATUS_CHANGED",
                    "NEW",
                    "CANCELLED",
                ),
            )

            notify_request_status_changed(
                cursor=cursor,
                request_id=request_id,
                old_status="NEW",
                new_status="CANCELLED",
                assigned_to=request.get("assigned_to"),
                actor_user_id=current_user["id"],
            )

            # Отменивший исключается из рассылки внутри сервиса,
            # а его коллеги по организации узнают: заявка общая,
            # и отменил её не тот, кто создавал.
            notify_portal_request_cancelled(
                cursor=cursor,
                request_id=request_id,
                client_id=request.get("client_id"),
                cancelled_by_client=True,
                client_name=get_portal_client_name(
                    cursor,
                    request.get("client_id"),
                ),
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "Заявка отменена",
                "request_id": request_id,
                "status": "CANCELLED",
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()