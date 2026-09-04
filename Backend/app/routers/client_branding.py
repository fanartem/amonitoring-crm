"""
Оформление кабинета клиента: логотип и основной цвет.
"""

import base64
import uuid
from pathlib import Path
import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.database import get_connection
from app.security import get_current_user
from app.schemas import ClientBrandingUpdate

from app.permissions import (
    add_client_history,
    get_user_client_id,
    has_any_permission,
)

from app.routers.clients import (
    can_open_client_details_for_router,
    ensure_client_visible_by_scope,
    ensure_employee_access,
    get_client_display_name,
    load_client_for_settings,
)

from app.routers.portal import ensure_portal_access


router = APIRouter(
    prefix="/clients",
    tags=["Client branding"],
    dependencies=[Depends(ensure_employee_access)],
)

# Второй роутер того же модуля: чтение брендинга кабинетом. Отдельный
# объект нужен из-за префикса и из-за того, что клиентская учётка не
# должна проходить через ensure_employee_access.
portal_router = APIRouter(prefix="/portal", tags=["Portal branding"])


BRANDING_ROOT = Path("uploads") / "branding"

# 512 КБ. Ограничение не про диск, а про то, что файл едет к клиенту
# внутри JSON в base64, то есть примерно в полтора раза тяжелее.
# Горизонтальному логотипу в шапке хватает 20-60 КБ.
MAX_LOGO_SIZE_BYTES = 512 * 1024

# SVG в списке нет намеренно, и это решение, а не недосмотр: SVG — это
# документ, внутри которого может лежать скрипт, а отдаём мы его со
# своего домена. Растровый логотип в 2x для шапки неотличим от вектора,
# а риска не несёт.
ALLOWED_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}

# Проверяем не только расширение, но и первые байты: .png, внутри
# которого лежит что угодно другое, дальше этой проверки не пройдёт.
LOGO_SIGNATURES = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
]

HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-f]{6}$")

BRANDING_VIEW_PERMISSION_CODES = [
    "clients.branding.manage",
    "clients.view_all",
    "clients.manage",
]

BRANDING_MANAGE_PERMISSION_CODES = [
    "clients.branding.manage",
    "clients.manage",
]


# --------------------------------------------------------------------------
# Права
# --------------------------------------------------------------------------


def can_view_client_branding(current_user: dict) -> bool:
    return has_any_permission(current_user, BRANDING_VIEW_PERMISSION_CODES)


def can_manage_client_branding(current_user: dict) -> bool:
    return has_any_permission(current_user, BRANDING_MANAGE_PERMISSION_CODES)


def load_client_for_branding(cursor, client_id: int, current_user: dict) -> dict:
    """
    Клиент плюс проверка, что этот сотрудник вообще имеет к нему доступ.

    Порядок проверок тот же, что и у параметров установки: сначала
    область данных, потом право на действие. Иначе сотрудник с правом
    на брендинг мог бы менять оформление чужим клиентам.
    """
    client = load_client_for_settings(cursor, client_id)

    ensure_client_visible_by_scope(client, current_user)

    if not can_open_client_details_for_router(client, current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для доступа к этому клиенту",
        )

    return client


def ensure_can_manage_branding(current_user: dict):
    if not can_manage_client_branding(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для настройки оформления кабинета",
        )


# --------------------------------------------------------------------------
# Данные
# --------------------------------------------------------------------------


def normalize_base_color(value) -> str | None:
    """
    Пустая строка и None означают одно и то же — «цвет не задан»,
    то есть стандартное оформление.
    """
    if value is None:
        return None

    normalized = str(value).strip().lower()

    if not normalized:
        return None

    if not normalized.startswith("#"):
        normalized = f"#{normalized}"

    # Короткая запись #abc — обычная для дизайнеров, разворачиваем.
    if re.fullmatch(r"#[0-9a-f]{3}", normalized):
        normalized = "#" + "".join(ch * 2 for ch in normalized[1:])

    if not HEX_COLOR_PATTERN.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail="Цвет должен быть в формате #RRGGBB",
        )

    return normalized


def load_branding_row(cursor, client_id: int) -> dict | None:
    cursor.execute(
        """
        SELECT
            client_id,
            is_enabled,
            base_color,
            logo_stored_name,
            logo_original_name,
            logo_content_type,
            logo_file_size,
            logo_version,
            updated_at,
            updated_by
        FROM client_portal_branding
        WHERE client_id = %s
        LIMIT 1
        """,
        (client_id,),
    )

    return cursor.fetchone()


def get_logo_path(client_id: int, stored_name: str | None) -> Path | None:
    if not stored_name:
        return None

    return BRANDING_ROOT / str(client_id) / stored_name


def build_logo_data_url(client_id: int, row: dict | None) -> str | None:
    """
    Логотип в виде data-URI.

    Пропажу файла на диске трактуем как «логотипа нет»: кабинет должен
    открыться со стандартной шапкой, а не с ошибкой. В настройках
    сотрудник увидит, что логотип не загружен, и загрузит заново.
    """
    if not row:
        return None

    path = get_logo_path(int(row["client_id"]), row.get("logo_stored_name"))

    if not path or not path.exists():
        return None

    try:
        payload = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return None

    content_type = row.get("logo_content_type") or "image/png"

    return f"data:{content_type};base64,{payload}"


def build_branding_payload(cursor, client: dict, current_user: dict) -> dict:
    row = load_branding_row(cursor, int(client["id"]))
    logo_data_url = build_logo_data_url(int(client["id"]), row)

    return {
        "client_id": int(client["id"]),
        "client_name": get_client_display_name(client),
        "is_configured": bool(row),
        "is_enabled": bool(row["is_enabled"]) if row else False,
        "base_color": (row or {}).get("base_color"),
        "logo": (
            {
                "data_url": logo_data_url,
                "original_name": row.get("logo_original_name"),
                "content_type": row.get("logo_content_type"),
                "file_size": int(row.get("logo_file_size") or 0),
                "version": int(row.get("logo_version") or 0),
            }
            if row and logo_data_url
            else None
        ),
        "updated_at": (row or {}).get("updated_at"),
        "can_manage": can_manage_client_branding(current_user),
        "max_logo_size_bytes": MAX_LOGO_SIZE_BYTES,
        "allowed_logo_extensions": sorted(ALLOWED_LOGO_EXTENSIONS),
    }


def describe_branding(row: dict | None) -> str:
    """Одна строка для журнала изменений — читаемая человеком."""
    if not row:
        return "не настроено"

    parts = []

    parts.append("включено" if row.get("is_enabled") else "выключено")
    parts.append(
        f"цвет {row['base_color']}" if row.get("base_color") else "цвет стандартный"
    )
    parts.append(
        f"логотип {row['logo_original_name']}"
        if row.get("logo_stored_name")
        else "без логотипа"
    )

    return "; ".join(parts)


def upsert_branding(
    cursor,
    client_id: int,
    user_id: int,
    is_enabled: bool,
    base_color: str | None,
):
    cursor.execute(
        """
        INSERT INTO client_portal_branding (
            client_id,
            is_enabled,
            base_color,
            updated_by
        )
        VALUES (%s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            is_enabled = VALUES(is_enabled),
            base_color = VALUES(base_color),
            updated_by = VALUES(updated_by)
        """,
        (client_id, 1 if is_enabled else 0, base_color, user_id),
    )


# --------------------------------------------------------------------------
# Эндпоинты для сотрудника
# --------------------------------------------------------------------------


@router.get("/{client_id}/branding")
def get_client_branding(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    if not can_view_client_branding(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра оформления кабинета",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = load_client_for_branding(cursor, client_id, current_user)

            return build_branding_payload(cursor, client, current_user)

    finally:
        connection.close()


@router.put("/{client_id}/branding")
def update_client_branding(
    client_id: int,
    data: ClientBrandingUpdate,
    current_user: dict = Depends(get_current_user),
):
    ensure_can_manage_branding(current_user)

    base_color = normalize_base_color(data.base_color)
    is_enabled = bool(data.is_enabled)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = load_client_for_branding(cursor, client_id, current_user)

            before = load_branding_row(cursor, int(client["id"]))

            upsert_branding(
                cursor,
                client_id=int(client["id"]),
                user_id=current_user["id"],
                is_enabled=is_enabled,
                base_color=base_color,
            )

            after = load_branding_row(cursor, int(client["id"]))

            # Журнал только при реальном изменении: сохранение без правок
            # не должно засорять историю клиента.
            if describe_branding(before) != describe_branding(after):
                add_client_history(
                    cursor,
                    client_id=int(client["id"]),
                    user_id=current_user["id"],
                    action="BRANDING_CHANGED",
                    field_name="portal_branding",
                    old_value=describe_branding(before),
                    new_value=describe_branding(after),
                )

            connection.commit()

            return build_branding_payload(cursor, client, current_user)

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


def validate_logo_file(content: bytes, filename: str) -> str:
    """
    Возвращает content-type. Расширение и первые байты должны совпадать
    друг с другом — иначе это не тот файл, за который себя выдаёт.
    """
    suffix = Path(filename or "").suffix.lower()

    if suffix not in ALLOWED_LOGO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Логотип принимается в формате PNG, JPG или WEBP",
        )

    if not content:
        raise HTTPException(status_code=400, detail="Файл пустой")

    if len(content) > MAX_LOGO_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail="Логотип больше 512 КБ. Для шапки достаточно файла в десятки килобайт",
        )

    for signature, content_type in LOGO_SIGNATURES:
        if content.startswith(signature):
            return content_type

    # WEBP: RIFF....WEBP, размер файла между ними.
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"

    raise HTTPException(
        status_code=400,
        detail="Файл не похож на изображение PNG, JPG или WEBP",
    )


@router.post("/{client_id}/branding/logo")
def upload_client_branding_logo(
    client_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    ensure_can_manage_branding(current_user)

    content = file.file.read()
    content_type = validate_logo_file(content, file.filename or "")

    connection = get_connection()
    saved_path = None

    try:
        with connection.cursor() as cursor:
            client = load_client_for_branding(cursor, client_id, current_user)

            before = load_branding_row(cursor, int(client["id"]))

            suffix = Path(file.filename or "").suffix.lower()
            stored_name = f"{uuid.uuid4().hex}{suffix}"

            folder = BRANDING_ROOT / str(client["id"])
            folder.mkdir(parents=True, exist_ok=True)

            saved_path = folder / stored_name
            saved_path.write_bytes(content)

            # Строка может ещё не существовать: логотип загружают и до
            # выбора цвета. Создаём её включённой — сотрудник только что
            # осознанно загрузил логотип, прятать его незачем.
            cursor.execute(
                """
                INSERT INTO client_portal_branding (
                    client_id,
                    is_enabled,
                    logo_stored_name,
                    logo_original_name,
                    logo_content_type,
                    logo_file_size,
                    logo_version,
                    updated_by
                )
                VALUES (%s, 1, %s, %s, %s, %s, 1, %s)
                ON DUPLICATE KEY UPDATE
                    logo_stored_name = VALUES(logo_stored_name),
                    logo_original_name = VALUES(logo_original_name),
                    logo_content_type = VALUES(logo_content_type),
                    logo_file_size = VALUES(logo_file_size),
                    logo_version = logo_version + 1,
                    updated_by = VALUES(updated_by)
                """,
                (
                    int(client["id"]),
                    stored_name,
                    file.filename,
                    content_type,
                    len(content),
                    current_user["id"],
                ),
            )

            add_client_history(
                cursor,
                client_id=int(client["id"]),
                user_id=current_user["id"],
                action="BRANDING_LOGO_CHANGED",
                field_name="portal_logo",
                old_value=(before or {}).get("logo_original_name"),
                new_value=file.filename,
            )

            connection.commit()

            # Прежний файл удаляем только после успешного коммита:
            # упади транзакция раньше — в базе остался бы старый файл,
            # которого уже нет на диске.
            previous_path = get_logo_path(
                int(client["id"]), (before or {}).get("logo_stored_name")
            )

            if previous_path and previous_path.exists():
                try:
                    previous_path.unlink()
                except OSError:
                    pass

            return build_branding_payload(cursor, client, current_user)

    except HTTPException:
        connection.rollback()

        if saved_path and saved_path.exists():
            try:
                saved_path.unlink()
            except OSError:
                pass

        raise
    except Exception as e:
        connection.rollback()

        if saved_path and saved_path.exists():
            try:
                saved_path.unlink()
            except OSError:
                pass

        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/{client_id}/branding/logo")
def delete_client_branding_logo(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    ensure_can_manage_branding(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = load_client_for_branding(cursor, client_id, current_user)

            before = load_branding_row(cursor, int(client["id"]))

            if not before or not before.get("logo_stored_name"):
                raise HTTPException(status_code=404, detail="Логотип не загружен")

            cursor.execute(
                """
                UPDATE client_portal_branding
                SET logo_stored_name = NULL,
                    logo_original_name = NULL,
                    logo_content_type = NULL,
                    logo_file_size = NULL,
                    logo_version = logo_version + 1,
                    updated_by = %s
                WHERE client_id = %s
                """,
                (current_user["id"], int(client["id"])),
            )

            add_client_history(
                cursor,
                client_id=int(client["id"]),
                user_id=current_user["id"],
                action="BRANDING_LOGO_CHANGED",
                field_name="portal_logo",
                old_value=before.get("logo_original_name"),
                new_value=None,
            )

            connection.commit()

            path = get_logo_path(int(client["id"]), before.get("logo_stored_name"))

            if path and path.exists():
                try:
                    path.unlink()
                except OSError:
                    pass

            return build_branding_payload(cursor, client, current_user)

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


# --------------------------------------------------------------------------
# Эндпоинт кабинета
# --------------------------------------------------------------------------


@portal_router.get("/branding")
def get_portal_branding(current_user: dict = Depends(get_current_user)):
    """
    Оформление своего кабинета.

    Наследования нет (Р57(Б)): подклиент видит своё оформление или
    стандартное, но не родительское.
    """
    ensure_portal_access(current_user)

    empty = {
        "is_enabled": False,
        "base_color": None,
        "logo_data_url": None,
        "logo_version": 0,
    }

    client_id = get_user_client_id(current_user)

    if not client_id:
        return empty

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            row = load_branding_row(cursor, int(client_id))

            if not row or not row.get("is_enabled"):
                return empty

            return {
                "is_enabled": True,
                "base_color": row.get("base_color"),
                "logo_data_url": build_logo_data_url(int(client_id), row),
                "logo_version": int(row.get("logo_version") or 0),
            }

    finally:
        connection.close()