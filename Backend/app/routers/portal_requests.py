"""
Создание заявки из клиентского кабинета.

Отдельный файл от portal.py: там чтение данных, здесь запись с расчётом
цены и созданием машин. Роутер тот же по префиксу (/portal), но объект
свой — как у clients.py и portal_users.py.

Не путать с portal_users.py: тот про учётные записи кабинета и живёт
на стороне сотрудника, этот — про то, что делает сам клиент.

Главный принцип: клиент присылает только то, что знает сам.
Вид работ, платформа, трекер, подписки, блокировка, маяк, датчики и тип
выезда берутся из параметров установки договора. Цена считается той же
функцией, что и в CRM (build_request_price_lines) — второго расчёта
в системе быть не должно.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.database import get_connection
from app.security import get_current_user
from app.schemas import (
    CalculateExtraSensor,
    CalculateRequestPrice,
    CalculateRequestVehicle,
    PortalRequestCreate,
)
from app.permissions import (
    can_create_portal_request,
    can_view_portal_installation_settings,
    can_view_portal_prices,
    client_branch_is_blocked,
    get_user_client_id,
)

from app.routers.portal import (
    ensure_portal_access,
    get_portal_visible_client_ids,
)

from app.routers.clients import (
    get_client_display_name,
    load_client_for_settings,
    resolve_client_installation_settings,
)

from app.routers.prices import build_request_price_lines

from app.routers.requests import (
    SCHEDULE_APPROVAL_PENDING,
    almaty_now,
    build_schedule_approval_data,
    normalize_scheduled_at,
    validate_request_schedule,
)

from app.routers.vehicles import (
    FOREIGN_VIN_MESSAGE,
    normalize_plate_number,
    normalize_vehicle_text,
    normalize_vin,
)

from app.notification_service import (
    notify_new_request,
    notify_portal_request_created,
    notify_request_time_conflict,
)

router = APIRouter(
    prefix="/portal",
    tags=["Client Portal"],
    dependencies=[Depends(ensure_portal_access)],
)


PORTAL_WORK_TYPE = "INSTALLATION"

# Командировка по километражу зависит от адреса, а не от договора,
# и в параметрах установки её выбрать нельзя (см. clients.py).
# Значит и в кабинете её быть не может.
ALLOWED_PORTAL_VISIT_PRICE_CODES = ["ON_SITE_CITY", "ON_SITE_OUTSIDE_CITY"]

MAX_PORTAL_REQUEST_VEHICLES = 50

SETTINGS_NOT_CONFIGURED_MESSAGE = (
    "Параметры установки не согласованы. Обратитесь к вашему менеджеру — "
    "после согласования вы сможете оформлять заявки самостоятельно."
)


def resolve_target_client(cursor, current_user: dict, client_id: int | None) -> dict:
    """
    Организация, для которой создаётся заявка: своя или подклиент
    из своей ветки. Чужой id даёт 404, а не 403.
    """
    own_client_id = get_user_client_id(current_user)

    if not own_client_id:
        raise HTTPException(
            status_code=403,
            detail="Учётная запись не привязана к организации",
        )

    target_client_id = int(client_id) if client_id else int(own_client_id)

    if target_client_id != int(own_client_id):
        visible_client_ids = get_portal_visible_client_ids(cursor, current_user)

        if target_client_id not in visible_client_ids:
            raise HTTPException(status_code=404, detail="Организация не найдена")

    return load_client_for_settings(cursor, target_client_id)


def ensure_target_branch_not_blocked(cursor, client_id: int):
    """
    Блокировка наследуется вниз, поэтому смотрим всю цепочку вверх.
    Формулировки без слова «заблокирован» и без упоминания долга:
    это сообщение читает клиент.
    """
    branch = client_branch_is_blocked(cursor, client_id)

    if not branch["is_blocked"]:
        return

    if branch["is_blocked_by_parent"]:
        raise HTTPException(
            status_code=403,
            detail=(
                "Обслуживание приостановлено по головной организации. "
                "Обратитесь к вашему менеджеру."
            ),
        )

    raise HTTPException(
        status_code=403,
        detail="Обслуживание приостановлено. Обратитесь к вашему менеджеру.",
    )


def load_portal_installation_settings(cursor, client: dict) -> dict:
    """
    Параметры установки: свои или унаследованные от родителя.

    Решение Р24(А): без согласованных параметров заявку из кабинета
    создать нельзя. Иначе в CRM прилетит заявка без трекера, без
    платформы и с нулевой ценой, и монтажник не поймёт, что ставить.
    """
    payload = resolve_client_installation_settings(cursor, client)

    if not payload.get("is_configured"):
        raise HTTPException(status_code=400, detail=SETTINGS_NOT_CONFIGURED_MESSAGE)

    settings = payload.get("settings") or {}

    visit_type = str(settings.get("visit_type") or "").strip().upper()

    if visit_type not in ["IN_OFFICE", "ON_SITE"]:
        raise HTTPException(status_code=400, detail=SETTINGS_NOT_CONFIGURED_MESSAGE)

    platform = str(settings.get("platform") or "").strip()

    if not platform:
        raise HTTPException(status_code=400, detail=SETTINGS_NOT_CONFIGURED_MESSAGE)

    visit_price_code = None

    if visit_type == "ON_SITE":
        visit_price_code = str(settings.get("visit_price_code") or "").strip().upper()

        if visit_price_code not in ALLOWED_PORTAL_VISIT_PRICE_CODES:
            raise HTTPException(
                status_code=400,
                detail=SETTINGS_NOT_CONFIGURED_MESSAGE,
            )

    return {
        "payload": payload,
        "settings": settings,
        "visit_type": visit_type,
        "visit_price_code": visit_price_code,
        "platform": platform,
        "sensors": payload.get("sensors") or [],
    }


def validate_portal_city(cursor, value) -> str:
    city = str(value or "").strip()

    if not city:
        raise HTTPException(status_code=400, detail="Укажите город")

    cursor.execute(
        """
        SELECT name
        FROM cities
        WHERE name = %s
          AND is_active = 1
        LIMIT 1
        """,
        (city,),
    )

    row = cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=400,
            detail="Указан несуществующий или недоступный город",
        )

    return row["name"]


def resolve_portal_request_vehicles(
    cursor,
    *,
    client: dict,
    visible_client_ids: set[int],
    vehicles_input: list,
) -> list[int]:
    """
    Приводит машины заявки к идентификаторам в базе.

    Существующая машина должна принадлежать той же организации.
    Новая создаётся по VIN, и VIN проверяется по всей базе:

      - занят машиной этой же организации — берём её, а не плодим дубль;
      - занят другой организацией из своей ветки — говорим какой,
        это данные клиента;
      - занят кем-то ещё — только факт, без марки и без названия.
        Та же анонимизация, что в /vehicles/check-vin.
    """
    if not vehicles_input:
        raise HTTPException(
            status_code=400,
            detail="Добавьте хотя бы один автомобиль",
        )

    if len(vehicles_input) > MAX_PORTAL_REQUEST_VEHICLES:
        raise HTTPException(
            status_code=400,
            detail=(
                "За одну заявку можно оформить не больше "
                f"{MAX_PORTAL_REQUEST_VEHICLES} автомобилей"
            ),
        )

    client_id = int(client["id"])

    vehicle_ids = []
    seen_vins = set()

    for index, vehicle_input in enumerate(vehicles_input, start=1):
        if vehicle_input.vehicle_id:
            cursor.execute(
                """
                SELECT id, client_id, vin, is_deleted
                FROM vehicles
                WHERE id = %s
                LIMIT 1
                """,
                (int(vehicle_input.vehicle_id),),
            )

            existing = cursor.fetchone()

            if (
                not existing
                or existing["is_deleted"]
                or int(existing["client_id"] or 0) != client_id
            ):
                raise HTTPException(
                    status_code=404,
                    detail=f"Автомобиль {index}: не найден у выбранной организации",
                )

            if not str(existing.get("vin") or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"Автомобиль {index}: у машины не указан VIN",
                )

            if int(existing["id"]) in vehicle_ids:
                raise HTTPException(
                    status_code=400,
                    detail="Один и тот же автомобиль указан несколько раз",
                )

            vehicle_ids.append(int(existing["id"]))
            continue

        vin = normalize_vin(vehicle_input.vin)

        if not vin:
            raise HTTPException(
                status_code=400,
                detail=f"Автомобиль {index}: укажите VIN",
            )

        if vin in seen_vins:
            raise HTTPException(
                status_code=400,
                detail=f"VIN {vin} указан у нескольких автомобилей в заявке",
            )

        seen_vins.add(vin)

        brand = normalize_vehicle_text(vehicle_input.brand)
        model = normalize_vehicle_text(vehicle_input.model)

        if not brand or not model:
            raise HTTPException(
                status_code=400,
                detail=f"Автомобиль {index}: укажите марку и модель",
            )

        year = None

        if vehicle_input.year:
            year = int(vehicle_input.year)

            if year < 1900 or year > 2100:
                raise HTTPException(
                    status_code=400,
                    detail=f"Автомобиль {index}: некорректный год выпуска",
                )

        cursor.execute(
            """
            SELECT
                v.id,
                v.client_id,
                v.is_deleted,
                c.name AS client_name,
                c.company_name AS client_company_name
            FROM vehicles v
            LEFT JOIN clients c ON c.id = v.client_id
            WHERE v.vin = %s
              AND v.is_deleted = 0
            LIMIT 1
            """,
            (vin,),
        )

        vin_owner = cursor.fetchone()

        if vin_owner:
            owner_client_id = int(vin_owner["client_id"] or 0)

            if owner_client_id == client_id:
                if int(vin_owner["id"]) in vehicle_ids:
                    raise HTTPException(
                        status_code=400,
                        detail="Один и тот же автомобиль указан несколько раз",
                    )

                vehicle_ids.append(int(vin_owner["id"]))
                continue

            if owner_client_id in visible_client_ids:
                owner_name = (
                    vin_owner.get("client_company_name")
                    or vin_owner.get("client_name")
                    or f"организация #{owner_client_id}"
                )

                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Автомобиль с VIN {vin} уже числится за организацией "
                        f"«{owner_name}». Оформите заявку от её имени."
                    ),
                )

            raise HTTPException(status_code=400, detail=FOREIGN_VIN_MESSAGE)

        cursor.execute(
            """
            INSERT INTO vehicles (
                client_id,
                brand,
                model,
                plate_number,
                vin,
                year,
                type
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                client_id,
                brand,
                model,
                normalize_plate_number(vehicle_input.plate_number) or "БЕЗГРНЗ",
                vin,
                year,
                normalize_vehicle_text(vehicle_input.type) or "Легковая",
            ),
        )

        vehicle_ids.append(cursor.lastrowid)

    return vehicle_ids


def build_portal_price_input(
    *,
    client_id: int,
    visit_type: str,
    visit_price_code: str | None,
    settings: dict,
    sensors: list,
    vehicles_count: int,
) -> CalculateRequestPrice:
    """
    Собирает вход расчёта из параметров договора.

    Все машины заявки получают одинаковые параметры: договор один
    на организацию, отдельных условий по конкретной машине в нём нет.
    """
    sensor_inputs = [
        CalculateExtraSensor(
            name=str(sensor.get("name") or "").strip(),
            price=float(sensor.get("price") or 0),
        )
        for sensor in sensors
        if str(sensor.get("name") or "").strip()
    ]

    gps_price_code = str(settings.get("gps_price_code") or "").strip() or None

    def build_vehicle_input() -> CalculateRequestVehicle:
        # Каждой машине — свой объект, а не копия одного и того же:
        # так не зависим от версии pydantic и от того, изменит ли
        # расчёт переданные ему модели.
        return CalculateRequestVehicle(
            gps_price_code=gps_price_code,
            tracker_subscription_months=(
                int(settings.get("tracker_subscription_months") or 0)
                if gps_price_code
                else 0
            ),
            has_beacon=bool(settings.get("has_beacon")),
            beacon_subscription_months=(
                int(settings.get("beacon_subscription_months") or 0)
                if settings.get("has_beacon")
                else 0
            ),
            has_blocking=(
                bool(settings.get("has_blocking")) if gps_price_code else False
            ),
            extra_sensors=[
                CalculateExtraSensor(name=sensor.name, price=sensor.price)
                for sensor in sensor_inputs
            ],
        )

    return CalculateRequestPrice(
        client_id=client_id,
        work_type=PORTAL_WORK_TYPE,
        visit_type=visit_type,
        visit_price_code=visit_price_code,
        visit_km=None,
        has_power_restore=False,
        vehicles=[build_vehicle_input() for _ in range(vehicles_count)],
        manual_lines=[],
    )


@router.get("/cities")
def get_portal_cities(current_user: dict = Depends(get_current_user)):
    """
    Справочник городов для формы заявки.

    Свой эндпоинт, а не общий /cities: данные здесь не секретные,
    но правило у кабинета одно для всех ответов — перечисляем поля
    сами. Заодно не приходится снимать охрану сотрудников с чужого
    роутера ради одной выпадашки.
    """
    if not can_create_portal_request(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания заявки",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT name
                FROM cities
                WHERE is_active = 1
                ORDER BY name ASC
                """
            )

            return {"items": [row["name"] for row in cursor.fetchall()]}

    finally:
        connection.close()


@router.get("/installation-settings")
def get_portal_installation_settings(
    client_id: int | None = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Что будет установлено по договору: платформа, трекер, подписки,
    блокировка, маяк, датчики и формат работ.

    Отдаём и когда параметров нет — фронт должен показать, что заявку
    оформить пока нельзя, а не гадать по ошибке при отправке.
    """
    if not can_view_portal_installation_settings(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра параметров установки",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = resolve_target_client(cursor, current_user, client_id)

            payload = resolve_client_installation_settings(cursor, client)

            settings = payload.get("settings") or {}
            show_prices = can_view_portal_prices(current_user)

            # Клиенту показываем название оборудования, а не код прайса.
            # Код оставляем тоже: по нему фронт понимает, что трекер вообще
            # выбран, и не зависит от того, заполнено ли название.
            gps_price_code = str(settings.get("gps_price_code") or "").strip()
            gps_price_name = None

            if gps_price_code:
                cursor.execute(
                    "SELECT name FROM price_items WHERE code = %s LIMIT 1",
                    (gps_price_code,),
                )

                gps_price_row = cursor.fetchone()

                if gps_price_row:
                    gps_price_name = gps_price_row["name"]

            sensors = [
                {
                    "name": sensor.get("name"),
                    "price": (
                        float(sensor.get("price") or 0) if show_prices else None
                    ),
                }
                for sensor in (payload.get("sensors") or [])
            ]

            return {
                "client_id": int(client["id"]),
                "client_name": get_client_display_name(client),
                "is_configured": bool(payload.get("is_configured")),
                "can_create_request": (
                    bool(payload.get("is_configured"))
                    and can_create_portal_request(current_user)
                ),
                "not_configured_message": (
                    None
                    if payload.get("is_configured")
                    else SETTINGS_NOT_CONFIGURED_MESSAGE
                ),
                "settings": {
                    "visit_type": settings.get("visit_type"),
                    "visit_price_code": settings.get("visit_price_code"),
                    "platform": settings.get("platform"),
                    "gps_price_code": settings.get("gps_price_code"),
                    "gps_price_name": gps_price_name,
                    "tracker_subscription_months": int(
                        settings.get("tracker_subscription_months") or 0
                    ),
                    "has_blocking": bool(settings.get("has_blocking")),
                    "has_beacon": bool(settings.get("has_beacon")),
                    "beacon_subscription_months": int(
                        settings.get("beacon_subscription_months") or 0
                    ),
                },
                "sensors": sensors,
            }

    finally:
        connection.close()


@router.post("/requests")
def create_portal_request(
    data: PortalRequestCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Заявка на установку из личного кабинета.

    Клиент присылает организацию, дату, город, адрес, автомобили
    и комментарий. Всё остальное — из договора, цену считает сервер.
    """
    if not can_create_portal_request(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания заявки",
        )

    scheduled_at = normalize_scheduled_at(data.scheduled_at)

    if scheduled_at is None:
        raise HTTPException(
            status_code=400,
            detail="Укажите желаемую дату и время работ",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = resolve_target_client(cursor, current_user, data.client_id)
            client_id = int(client["id"])

            ensure_target_branch_not_blocked(cursor, client_id)

            contract = load_portal_installation_settings(cursor, client)

            visit_type = contract["visit_type"]
            visit_price_code = contract["visit_price_code"]
            platform = contract["platform"]

            city = validate_portal_city(cursor, data.city)

            address = str(data.address or "").strip() or None

            if visit_type == "ON_SITE" and not address:
                raise HTTPException(
                    status_code=400,
                    detail="По вашему договору работы выполняются с выездом. Укажите адрес.",
                )

            if visit_type == "IN_OFFICE":
                address = None

            # Правила времени те же, что у сотрудников: шаг 30 минут,
            # окно 08:00–20:00, минимальный запас по типу выезда.
            # Права на обход у клиентской учётки нет и быть не может.
            validate_request_schedule(
                scheduled_at=scheduled_at,
                visit_type=visit_type,
                visit_price_code=visit_price_code,
                current_user=current_user,
            )

            schedule_approval = build_schedule_approval_data(
                scheduled_at=scheduled_at,
                current_user=current_user,
                reason=data.schedule_approval_reason,
            )

            visible_client_ids = get_portal_visible_client_ids(cursor, current_user)

            vehicle_ids = resolve_portal_request_vehicles(
                cursor,
                client=client,
                visible_client_ids=visible_client_ids,
                vehicles_input=data.vehicles,
            )

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
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'NEW', 0, %s, %s)
                """,
                (
                    client_id,
                    PORTAL_WORK_TYPE,
                    visit_type,
                    visit_price_code,
                    address,
                    city,
                    platform,
                    scheduled_at,
                    schedule_approval["status"],
                    schedule_approval["reason"],
                    schedule_approval["requested_by"],
                    schedule_approval["requested_at"],
                    schedule_approval["decided_by"],
                    schedule_approval["decided_at"],
                    schedule_approval["comment"],
                    current_user["id"],
                    almaty_now(),
                ),
            )

            request_id = cursor.lastrowid

            settings = contract["settings"]
            sensors = contract["sensors"]

            has_beacon = bool(settings.get("has_beacon"))
            has_blocking = bool(settings.get("has_blocking")) and bool(
                str(settings.get("gps_price_code") or "").strip()
            )

            request_vehicle_id_by_index = {}

            for index, vehicle_id in enumerate(vehicle_ids, start=1):
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
                    (request_id, vehicle_id, has_beacon, has_blocking),
                )

                request_vehicle_id = cursor.lastrowid
                request_vehicle_id_by_index[index] = request_vehicle_id

                for sensor in sensors:
                    sensor_name = str(sensor.get("name") or "").strip()

                    if not sensor_name:
                        continue

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
                            float(sensor.get("price") or 0),
                        ),
                    )

            # Цена считается той же функцией, что и в CRM.
            # allow_manual_lines=True: датчики пришли из договора,
            # цену им назначил менеджер, а не клиент.
            price_input = build_portal_price_input(
                client_id=client_id,
                visit_type=visit_type,
                visit_price_code=visit_price_code,
                settings=settings,
                sensors=sensors,
                vehicles_count=len(vehicle_ids),
            )

            price_lines = build_request_price_lines(
                cursor,
                price_input,
                allow_manual_lines=True,
            )

            total_price = 0

            for line in price_lines:
                request_vehicle_id = None

                if line.get("vehicle_index"):
                    request_vehicle_id = request_vehicle_id_by_index.get(
                        line["vehicle_index"]
                    )

                    if not request_vehicle_id:
                        raise HTTPException(
                            status_code=500,
                            detail=(
                                "Не найден автомобиль заявки для строки расчёта "
                                f"vehicle_index={line['vehicle_index']}"
                            ),
                        )

                # is_manual считает сам расчёт; запасной вариант нужен
                # только на случай, если строка пришла без этого поля.
                is_manual = line.get("is_manual")

                if is_manual is None:
                    is_manual = 1 if line.get("code") is None else 0

                total_price += float(line["total_price"] or 0)

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
                        line.get("line_key"),
                        line.get("code"),
                        line.get("label"),
                        line.get("quantity"),
                        line.get("unit"),
                        line.get("unit_price"),
                        line.get("total_price"),
                        line.get("source"),
                        int(bool(is_manual)),
                    ),
                )

            cursor.execute(
                """
                UPDATE requests
                SET total_price = %s
                WHERE id = %s
                """,
                (total_price, request_id),
            )

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
                    f"Заявка создана из личного кабинета: {len(vehicle_ids)} авто",
                ),
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
                    ),
                )

            comment = str(data.comment or "").strip()

            if comment:
                cursor.execute(
                    """
                    INSERT INTO request_comments (request_id, user_id, message)
                    VALUES (%s, %s, %s)
                    """,
                    (request_id, current_user["id"], comment),
                )

            notify_new_request(
                cursor=cursor,
                request_id=request_id,
                city=city,
                client_name=client.get("name"),
                company_name=client.get("company_name"),
                actor_user_id=current_user["id"],
            )

            notify_request_time_conflict(
                cursor=cursor,
                request_id=request_id,
                scheduled_at=scheduled_at,
                city=city,
                client_name=client.get("name"),
                company_name=client.get("company_name"),
                actor_user_id=current_user["id"],
            )

            # Коллеги по организации и головная организация должны увидеть
            # заявку, даже если завёл её кто-то другой. Автор исключается
            # из рассылки внутри сервиса.
            notify_portal_request_created(
                cursor=cursor,
                request_id=request_id,
                client_id=client_id,
                scheduled_at=scheduled_at,
                client_name=get_client_display_name(client),
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "request_id": request_id,
                "client_id": client_id,
                "client_name": get_client_display_name(client),
                "vehicles_count": len(vehicle_ids),
                "schedule_approval_status": schedule_approval["status"],
                "total_price": (
                    total_price if can_view_portal_prices(current_user) else None
                ),
                "message": "Заявка создана",
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()