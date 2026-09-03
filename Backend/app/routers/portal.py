"""
Данные клиентского кабинета.

Почему отдельный роутер, а не расширение vehicles.py и clients.py:

  - в vehicles.py четырнадцать эндпоинтов, кабинету нужен один. Остальные —
    глобальный поиск по всей базе, корзина, история VIN, перенос машин
    между клиентами, импорт из Excel. Закрыть тринадцать одной зависимостью
    и написать один аккуратный портальный честнее, чем расширять общий;
  - там два запроса делают SELECT *. Для сотрудника это нормально, для
    внешнего контракта — нет: новая колонка уехала бы клиенту сама.

Здесь набор полей задан списком. Всё, чего в списке нет, клиент не увидит,
даже если появится в таблице.

Заявки живут не здесь: в requests.py уже была машинерия областей данных,
и портальный доступ лёг туда одной веткой (область CLIENT). Разное
решение для разных файлов — осознанное, а не случайное.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pymysql.err import IntegrityError

from app.database import get_connection
from app.security import get_current_user
from app.schemas import PortalSubclientCreate
from app.permissions import (
    add_client_history,
    can_access_portal,
    can_create_portal_subclient,
    can_view_portal_subclients,
    can_view_portal_vehicles,
    client_branch_is_blocked,
    get_client_branch_ids,
    get_user_client_id,
)

# Проверки данных клиента переиспользуем из clients.py, а не пишем заново:
# правило «для ТОО и ИП БИН обязателен» и поиск дублей по телефону должны
# работать одинаково, кто бы ни заводил клиента — менеджер или кабинет.
# Кольца импортов нет: clients.py про portal.py не знает.
from app.routers.clients import (
    find_duplicate_client,
    get_client_display_name,
    normalize_optional_str,
    validate_client_bin_iin,
)


def ensure_portal_access(current_user: dict = Depends(get_current_user)):
    """
    Кабинет и только кабинет.

    can_access_portal проверяет три вещи сразу: это клиентская учётка,
    она привязана к клиенту, и у неё есть portal.access. Сотрудник сюда
    не пройдёт, даже если ему по ошибке выдадут право портала.
    """
    if not can_access_portal(current_user):
        raise HTTPException(
            status_code=403,
            detail="Раздел доступен только пользователям личного кабинета",
        )

    return current_user


router = APIRouter(
    prefix="/portal",
    tags=["Client Portal"],
    dependencies=[Depends(ensure_portal_access)],
)


MAX_PORTAL_PAGE_SIZE = 200

ALLOWED_PORTAL_CLIENT_TYPES = ["INDIVIDUAL", "IP", "TOO"]

CLIENT_TYPE_LABELS = {
    "INDIVIDUAL": "Физическое лицо",
    "IP": "ИП",
    "TOO": "ТОО",
}

# Потолок на ветку. Не защита от злоумышленника — тот и так ограничен
# своей веткой, — а страховка от скрипта, который в цикле создаёт клиентов
# и незаметно раздувает базу. Реальные ветки на порядок меньше.
MAX_SUBCLIENTS_PER_BRANCH = 2000


def get_portal_visible_client_ids(cursor, current_user: dict) -> set[int]:
    """
    Организации, данные которых видит этот пользователь кабинета:
    своя плюс вся ветка подклиентов.

    Решение Р22(Б): право «Портал: просмотр подклиентов» — общий
    выключатель структуры, а не только вкладка со списком организаций.
    Нет права — кабинет показывает только свою организацию везде:
    и в машинах, и в заявках, и в списке организаций.

    Иначе получалось несимметрично: список подклиентов закрыт,
    а их машины видны — и состав структуры всё равно читается по данным.
    """
    own_client_id = get_user_client_id(current_user)

    if not own_client_id:
        return set()

    if not can_view_portal_subclients(current_user):
        return {int(own_client_id)}

    return get_client_branch_ids(cursor, own_client_id)


def ensure_client_in_branch(
    client_id: int | None,
    visible_client_ids: set[int],
) -> int | None:
    """
    Фильтр по конкретной организации. Чужой id даёт 404, а не 403:
    клиенту незачем узнавать перебором, какие организации существуют.
    """
    if client_id is None:
        return None

    if int(client_id) not in visible_client_ids:
        raise HTTPException(status_code=404, detail="Организация не найдена")

    return int(client_id)


def ensure_portal_branch_not_blocked(cursor, current_user: dict):
    """
    Режим чтения закрывает создание новых обязательств.

    Блокировка наследуется вниз, поэтому проверяем всю цепочку вверх:
    заблокированная головная организация закрывает создание и подклиенту.
    """
    branch = client_branch_is_blocked(cursor, get_user_client_id(current_user))

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


def load_own_client(cursor, client_id: int) -> dict:
    cursor.execute(
        """
        SELECT
            id,
            name,
            company_name,
            status,
            payment_type,
            responsible_manager_id,
            is_deleted
        FROM clients
        WHERE id = %s
        LIMIT 1
        """,
        (int(client_id),),
    )

    client = cursor.fetchone()

    if not client or client["is_deleted"]:
        raise HTTPException(
            status_code=403,
            detail="Доступ в личный кабинет закрыт. Обратитесь к вашему менеджеру.",
        )

    return client


@router.get("/clients")
def get_portal_clients(current_user: dict = Depends(get_current_user)):
    """
    Своя организация и её подклиенты.

    Нужен фильтру на вкладке автомобилей и вкладке подклиентов.
    """
    own_client_id = get_user_client_id(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            visible_client_ids = get_portal_visible_client_ids(cursor, current_user)

            if not visible_client_ids:
                return {"own_client_id": own_client_id, "items": []}

            placeholders = ", ".join(["%s"] * len(visible_client_ids))
            ordered_ids = sorted(visible_client_ids)

            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.name,
                    c.company_name,
                    c.type,
                    c.parent_client_id,

                    (
                        SELECT COUNT(*)
                        FROM vehicles v
                        WHERE v.client_id = c.id
                          AND v.is_deleted = 0
                    ) AS vehicle_count
                FROM clients c
                WHERE c.id IN ({placeholders})
                  AND c.is_deleted = 0
                ORDER BY
                    c.id = %s DESC,
                    c.company_name ASC,
                    c.name ASC
                """,
                tuple(ordered_ids) + (own_client_id,),
            )

            rows = cursor.fetchall() or []

            items = [
                {
                    "id": row["id"],
                    "name": row.get("company_name") or row.get("name"),
                    "contact_name": row.get("name"),
                    "type": row.get("type"),
                    "parent_client_id": row.get("parent_client_id"),
                    "is_own": int(row["id"]) == int(own_client_id or 0),
                    "vehicle_count": int(row.get("vehicle_count") or 0),
                }
                for row in rows
            ]

            return {
                "own_client_id": own_client_id,
                "items": items,
            }

    finally:
        connection.close()


@router.get("/vehicles")
def get_portal_vehicles(
    client_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=MAX_PORTAL_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """
    Автомобили своей организации и организаций своей структуры.

    Отдаются только эти поля. Ни причин удаления, ни того, кто удалил,
    ни служебных колонок таблицы vehicles здесь нет и не появится
    само собой — список явный.
    """
    if not can_view_portal_vehicles(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра автомобилей",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            visible_client_ids = get_portal_visible_client_ids(cursor, current_user)

            if not visible_client_ids:
                return {
                    "items": [],
                    "total": 0,
                    "limit": limit,
                    "offset": offset,
                }

            selected_client_id = ensure_client_in_branch(
                client_id,
                visible_client_ids,
            )

            if selected_client_id is not None:
                client_ids = [selected_client_id]
            else:
                client_ids = sorted(visible_client_ids)

            placeholders = ", ".join(["%s"] * len(client_ids))

            conditions = [
                "v.is_deleted = 0",
                f"v.client_id IN ({placeholders})",
            ]

            values = list(client_ids)

            search = str(q or "").strip()

            if len(search) >= 2:
                like_value = f"%{search}%"

                conditions.append(
                    """
                    (
                        v.plate_number LIKE %s
                        OR v.vin LIKE %s
                        OR v.brand LIKE %s
                        OR v.model LIKE %s
                    )
                    """
                )

                values.extend([like_value, like_value, like_value, like_value])

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM vehicles v
                WHERE {where_clause}
                """,
                tuple(values),
            )

            total_row = cursor.fetchone()
            total = int((total_row or {}).get("total") or 0)

            cursor.execute(
                f"""
                SELECT
                    v.id,
                    v.client_id,
                    v.brand,
                    v.model,
                    v.plate_number,
                    v.vin,
                    v.year,
                    v.type,

                    c.name AS client_contact_name,
                    c.company_name AS client_company_name
                FROM vehicles v
                LEFT JOIN clients c ON c.id = v.client_id
                WHERE {where_clause}
                ORDER BY v.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(values) + (limit, offset),
            )

            rows = cursor.fetchall() or []

            own_client_id = get_user_client_id(current_user)

            items = [
                {
                    "id": row["id"],
                    "client_id": row["client_id"],
                    "client_name": (
                        row.get("client_company_name")
                        or row.get("client_contact_name")
                    ),
                    "is_own_client": (
                        own_client_id is not None
                        and row.get("client_id") is not None
                        and int(row["client_id"]) == int(own_client_id)
                    ),
                    "brand": row.get("brand"),
                    "model": row.get("model"),
                    "plate_number": row.get("plate_number"),
                    "vin": row.get("vin"),
                    "year": row.get("year"),
                    "type": row.get("type"),
                }
                for row in rows
            ]

            return {
                "items": items,
                "total": total,
                "limit": limit,
                "offset": offset,
            }

    finally:
        connection.close()


@router.get("/subclients")
def get_portal_subclients(
    q: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    Организации в структуре клиента, без него самого.

    Счётчики автомобилей и заявок — те же цифры, что видит менеджер
    в карточке клиента: скрывать их от владельца структуры незачем.
    """
    if not can_view_portal_subclients(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра подклиентов",
        )

    own_client_id = get_user_client_id(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            visible_client_ids = get_portal_visible_client_ids(cursor, current_user)
            visible_client_ids.discard(int(own_client_id or 0))

            if not visible_client_ids:
                return {
                    "items": [],
                    "total": 0,
                    "can_create": can_create_portal_subclient(current_user),
                }

            ordered_ids = sorted(visible_client_ids)
            placeholders = ", ".join(["%s"] * len(ordered_ids))

            conditions = [
                f"c.id IN ({placeholders})",
                "c.is_deleted = 0",
            ]

            values = list(ordered_ids)

            search = str(q or "").strip()

            if len(search) >= 2:
                like_value = f"%{search}%"

                conditions.append(
                    """
                    (
                        c.name LIKE %s
                        OR c.company_name LIKE %s
                        OR c.bin_iin LIKE %s
                        OR c.phone LIKE %s
                    )
                    """
                )

                values.extend([like_value, like_value, like_value, like_value])

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.type,
                    c.name,
                    c.company_name,
                    c.bin_iin,
                    c.phone,
                    c.email,
                    c.created_at,
                    c.parent_client_id,

                    (
                        SELECT COUNT(*)
                        FROM vehicles v
                        WHERE v.client_id = c.id
                          AND v.is_deleted = 0
                    ) AS vehicle_count,

                    (
                        SELECT COUNT(*)
                        FROM requests r
                        WHERE r.client_id = c.id
                          AND r.is_deleted = 0
                    ) AS request_count
                FROM clients c
                WHERE {where_clause}
                ORDER BY
                    c.company_name ASC,
                    c.name ASC
                """,
                tuple(values),
            )

            rows = cursor.fetchall() or []

            # Статус клиента (должник / заблокирован) намеренно не отдаётся:
            # это наша внутренняя оценка, а не информация для владельца
            # структуры. Ограничения он и так почувствует по кнопкам.
            items = [
                {
                    "id": row["id"],
                    "type": row.get("type"),
                    "type_label": CLIENT_TYPE_LABELS.get(
                        str(row.get("type") or "").upper(),
                        row.get("type"),
                    ),
                    "name": row.get("company_name") or row.get("name"),
                    "contact_name": row.get("name"),
                    "bin_iin": row.get("bin_iin"),
                    "phone": row.get("phone"),
                    "email": row.get("email"),
                    "created_at": row.get("created_at"),
                    "is_direct_child": (
                        row.get("parent_client_id") is not None
                        and int(row["parent_client_id"]) == int(own_client_id or 0)
                    ),
                    "vehicle_count": int(row.get("vehicle_count") or 0),
                    "request_count": int(row.get("request_count") or 0),
                }
                for row in rows
            ]

            return {
                "items": items,
                "total": len(items),
                "can_create": can_create_portal_subclient(current_user),
            }

    finally:
        connection.close()


@router.post("/subclients")
def create_portal_subclient(
    data: PortalSubclientCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Клиент заводит организацию в своей структуре.

    Родителем становится организация самого пользователя — выбрать
    родителя нельзя, такого поля нет в схеме запроса.

    Что наследуется от родителя и почему:
      payment_type          — условия оплаты у ветки общие. Если завести
                              заёмщика на предоплате, его заявки будут
                              скрыты от монтажников до оплаты, хотя платит
                              головная организация;
      responsible_manager_id — ветку ведёт тот же менеджер. Иначе новый
                              клиент оказывается ничей, и заявка по нему
                              повисает.

    Статус всегда ACTIVE: менять платёжную дисциплину клиент себе не может.
    """
    if not can_create_portal_subclient(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания организации",
        )

    client_type = str(data.type or "").strip().upper()

    if client_type not in ALLOWED_PORTAL_CLIENT_TYPES:
        raise HTTPException(status_code=400, detail="Некорректный тип лица")

    name = str(data.name or "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="Укажите ФИО контактного лица")

    company_name = normalize_optional_str(data.company_name)

    if client_type in ["IP", "TOO"] and not company_name:
        raise HTTPException(
            status_code=400,
            detail="Для ТОО и ИП укажите наименование организации",
        )

    if client_type == "INDIVIDUAL":
        company_name = None

    phone = str(data.phone or "").strip()

    if not phone:
        raise HTTPException(status_code=400, detail="Укажите контактный телефон")

    email = normalize_optional_str(data.email)

    # Та же проверка, что у менеджера: для ТОО и ИП БИН обязателен.
    bin_iin = validate_client_bin_iin(client_type, data.bin_iin)

    own_client_id = get_user_client_id(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            parent_client = load_own_client(cursor, own_client_id)

            ensure_portal_branch_not_blocked(cursor, current_user)

            branch_ids = get_client_branch_ids(cursor, own_client_id)

            if len(branch_ids) >= MAX_SUBCLIENTS_PER_BRANCH:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Достигнут предел числа организаций в структуре. "
                        "Обратитесь к вашему менеджеру."
                    ),
                )

            duplicate = find_duplicate_client(
                cursor=cursor,
                client_type=client_type,
                name=name,
                company_name=company_name,
                phone=phone,
            )

            if duplicate:
                # Дубль внутри своей ветки называем: это его же организация.
                # Дубль снаружи — только факт, без названия и телефона.
                # Иначе перебором номеров выясняется, кто у нас обслуживается.
                if int(duplicate["id"]) in branch_ids:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Такая организация уже есть в вашей структуре: "
                            f"{get_client_display_name(duplicate)}"
                        ),
                    )

                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Организация с такими данными уже зарегистрирована "
                        "в системе. Обратитесь к вашему менеджеру."
                    ),
                )

            cursor.execute(
                """
                INSERT INTO clients (
                    type,
                    bin_iin,
                    name,
                    company_name,
                    phone,
                    email,
                    status,
                    payment_type,
                    created_by,
                    responsible_manager_id,
                    parent_client_id,
                    responsible_changed_at,
                    responsible_changed_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE', %s, %s, %s, %s, NOW(), %s)
                """,
                (
                    client_type,
                    bin_iin,
                    name,
                    company_name,
                    phone,
                    email,
                    parent_client.get("payment_type") or "PREPAYMENT",
                    current_user["id"],
                    parent_client.get("responsible_manager_id"),
                    int(own_client_id),
                    current_user["id"],
                ),
            )

            new_client_id = cursor.lastrowid

            add_client_history(
                cursor,
                client_id=new_client_id,
                user_id=current_user["id"],
                action="CLIENT_CREATED",
                new_value=company_name or name,
                comment="Организация создана из личного кабинета",
            )

            add_client_history(
                cursor,
                client_id=new_client_id,
                user_id=current_user["id"],
                action="PARENT_CHANGED",
                field_name="parent_client_id",
                old_value=None,
                new_value=int(own_client_id),
                comment=f"Родитель: {get_client_display_name(parent_client)}",
            )

            # Запись в карточке родителя: менеджер должен видеть, что клиент
            # сам расширил структуру, не открывая карточку новой организации.
            add_client_history(
                cursor,
                client_id=int(own_client_id),
                user_id=current_user["id"],
                action="SUBCLIENT_CREATED",
                field_name="subclient",
                old_value=None,
                new_value=company_name or name,
                comment="Организация добавлена из личного кабинета",
            )

            connection.commit()

            return {
                "id": new_client_id,
                "name": company_name or name,
                "type": client_type,
                "parent_client_id": int(own_client_id),
                "message": "Организация добавлена в вашу структуру",
            }

    except HTTPException:
        connection.rollback()
        raise
    except IntegrityError as e:
        connection.rollback()

        if e.args and e.args[0] == 1062:
            raise HTTPException(
                status_code=409,
                detail="Организация с такими данными уже существует",
            )

        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()