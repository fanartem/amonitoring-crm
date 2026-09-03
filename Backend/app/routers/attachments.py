import os
import uuid
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse

from app.database import get_connection
from app.security import get_current_user
from app.schemas import AttachmentUpdate

from app.permissions import (
    has_any_permission,
    is_super_admin,
    is_client_owned_by_user,
    is_client_user,
    is_employee_user,
    can_delete_attachment,
)

from app.routers.requests import (
    user_can_access_request,
    user_is_limited_executor,
    get_current_user_city,
)

router = APIRouter(prefix="/attachments", tags=["Attachments"])

ATTACHMENT_DELETE_TIME_LIMIT_SECONDS = 120

UPLOADS_ROOT = Path("uploads")
ALLOWED_ENTITY_TYPES = ["CLIENT", "REQUEST"]

MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB

ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp",
    ".pdf", ".doc", ".docx",
    ".xls", ".xlsx", ".csv",
    ".txt"
}

ATTACHMENT_VIEW_PERMISSION_CODES = [
    "attachments.view",
    "attachments.manage",
]

# Область видимости файлов внутри доступной карточки/заявки.
ATTACHMENT_VIEW_ALL_PERMISSION_CODES = [
    "attachments.view_all",
    "attachments.manage",
]

ATTACHMENT_VIEW_OWN_PERMISSION_CODES = [
    "attachments.view_own",
]

ATTACHMENT_UPLOAD_PERMISSION_CODES = [
    "attachments.upload",
    "attachments.manage",
]

ATTACHMENT_UPDATE_PERMISSION_CODES = [
    "attachments.rename",
    "attachments.edit",
    "attachments.manage",
]

ATTACHMENT_DELETE_PERMISSION_CODES = [
    "attachments.delete",
    "attachments.manage",
]

ENTITY_ATTACHMENT_PERMISSION_CODES = {
    "CLIENT": {
        "view": [
            "clients.attachments.view",
            "clients.attachments.manage",
            "clients.manage",
        ],
        "upload": [
            "clients.attachments.upload",
            "clients.attachments.manage",
            "clients.manage",
        ],
        "update": [
            "clients.attachments.rename",
            "clients.attachments.edit",
            "clients.attachments.manage",
            "clients.manage",
        ],
        "delete": [
            "clients.attachments.delete",
            "clients.attachments.manage",
            "clients.manage",
        ],
    },
    "REQUEST": {
        "view": [
            "requests.attachments.view",
            "requests.attachments.manage",
        ],
        "upload": [
            "requests.attachments.upload",
            "requests.attachments.manage",
        ],
        "update": [
            "requests.attachments.rename",
            "requests.attachments.edit",
            "requests.attachments.manage",
        ],
        "delete": [
            "requests.attachments.delete",
            "requests.attachments.manage",
        ],
    },
}

# Область данных для файлов клиентов.
# Право на действие (view/upload) отвечает "можно ли работать с файлами вообще",
# эти два кода — "чьи именно карточки доступны".
CLIENT_ATTACHMENTS_VIEW_ALL_PERMISSION_CODES = [
    "clients.attachments.view_all",
    "clients.attachments.manage",
    "clients.view_all",
    "clients.manage",
]

CLIENT_ATTACHMENTS_VIEW_OWN_PERMISSION_CODES = [
    "clients.attachments.view_own",
    "clients.view_own",
]


def normalize_entity_type(entity_type: str) -> str:
    value = str(entity_type or "").strip().upper()

    if value not in ALLOWED_ENTITY_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Некорректный тип сущности. Доступно: CLIENT, REQUEST"
        )

    return value


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


def get_entity_permission_codes(entity_type: str, action: str) -> list[str]:
    return ENTITY_ATTACHMENT_PERMISSION_CODES.get(entity_type, {}).get(action, [])


def attachment_is_owner(attachment: dict, current_user: dict) -> bool:
    return (
        attachment.get("uploaded_by") is not None
        and int(attachment["uploaded_by"]) == int(current_user["id"])
    )


def attachment_is_internal(attachment: dict) -> bool:
    """
    Внутренний файл виден только сотрудникам.

    Отсутствие поля в выборке трактуем как «внутренний»: если кто-то
    добавит новый SELECT и забудет колонку, файл спрячется, а не утечёт.
    """
    if attachment is None:
        return True

    if "is_internal" not in attachment:
        return True

    return to_bool(attachment.get("is_internal"))


def get_attachment_age_seconds(attachment: dict) -> int:
    return int(attachment.get("age_seconds") or 0)


def attachment_is_within_time_limit(attachment: dict) -> bool:
    return get_attachment_age_seconds(attachment) <= ATTACHMENT_DELETE_TIME_LIMIT_SECONDS


def can_manage_attachment_by_permission(attachment: dict, current_user: dict) -> bool:
    entity_type = normalize_entity_type(attachment.get("entity_type"))

    return user_has_any_permission(
        current_user,
        [
            "attachments.manage",
            *get_entity_permission_codes(entity_type, "update"),
            *get_entity_permission_codes(entity_type, "delete"),
        ],
    )


def user_can_view_attachment(attachment: dict, current_user: dict) -> bool:
    entity_type = normalize_entity_type(attachment.get("entity_type"))

    # 0. Клиентская учётная запись не видит внутренние файлы никогда —
    # даже с attachments.view_all. Свои собственные загрузки видит всегда:
    # клиент не должен терять доступ к тому, что сам же и принёс.
    if is_client_user(current_user):
        if attachment_is_internal(attachment) and not attachment_is_owner(
            attachment, current_user
        ):
            return False

    # 1. Право работать с файлами этой сущности вообще.
    if not user_has_any_permission(
        current_user,
        [
            *ATTACHMENT_VIEW_PERMISSION_CODES,
            *get_entity_permission_codes(entity_type, "view"),
        ],
    ):
        return False

    # 2. Область: все файлы или только загруженные самим пользователем.
    if user_has_any_permission(current_user, ATTACHMENT_VIEW_ALL_PERMISSION_CODES):
        return True

    if user_has_any_permission(current_user, ATTACHMENT_VIEW_OWN_PERMISSION_CODES):
        return attachment_is_owner(attachment, current_user)

    return False


def user_can_upload_attachment(entity_type: str, current_user: dict) -> bool:
    entity_type = normalize_entity_type(entity_type)

    return user_has_any_permission(
        current_user,
        [
            *ATTACHMENT_UPLOAD_PERMISSION_CODES,
            *get_entity_permission_codes(entity_type, "upload"),
        ],
    )


def user_can_update_attachment(attachment: dict, current_user: dict) -> bool:
    entity_type = normalize_entity_type(attachment.get("entity_type"))

    if not user_can_view_attachment(attachment, current_user):
        return False

    if user_has_any_permission(
        current_user,
        [
            *ATTACHMENT_UPDATE_PERMISSION_CODES,
            *get_entity_permission_codes(entity_type, "update"),
        ],
    ):
        return True

    # Старое поведение: владелец может переименовать свой файл только 2 минуты.
    return attachment_is_owner(attachment, current_user) and attachment_is_within_time_limit(attachment)


def user_can_mark_attachment_internal(attachment: dict, current_user: dict) -> bool:
    """
    Галочка «внутренний файл» — инструмент сотрудника.
    Клиент её не видит и снять не может, иначе смысл признака теряется.
    """
    if not is_employee_user(current_user):
        return False

    return user_can_update_attachment(attachment, current_user)


def user_can_delete_attachment(attachment: dict, current_user: dict) -> bool:
    entity_type = normalize_entity_type(attachment.get("entity_type"))
    within_time_limit = attachment_is_within_time_limit(attachment)

    if not user_can_view_attachment(attachment, current_user):
        return False

    if user_has_any_permission(
        current_user,
        [
            *ATTACHMENT_DELETE_PERMISSION_CODES,
            *get_entity_permission_codes(entity_type, "delete"),
        ],
    ):
        return True

    # Совместимость со старой permission-функцией: админы/РОП/менеджеры и/или
    # владелец в пределах 2 минут — в зависимости от текущей реализации
    # permissions.py.
    return can_delete_attachment(attachment, current_user, within_time_limit)


def attach_attachment_permissions(attachment: dict, current_user: dict) -> dict:
    attachment["is_deleted"] = to_bool(attachment.get("is_deleted"))
    attachment["is_internal"] = attachment_is_internal(attachment)
    attachment["can_download"] = user_can_view_attachment(attachment, current_user)
    attachment["can_rename"] = user_can_update_attachment(attachment, current_user)
    attachment["can_mark_internal"] = user_can_mark_attachment_internal(
        attachment, current_user
    )
    attachment["can_delete"] = user_can_delete_attachment(attachment, current_user)

    return attachment


def validate_file(file: UploadFile):
    original_name = file.filename or ""

    if not original_name.strip():
        raise HTTPException(status_code=400, detail="Имя файла не указано")

    suffix = Path(original_name).suffix.lower()

    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимый формат файла: {suffix}"
        )


def check_entity_exists(cursor, entity_type: str, entity_id: int):
    if entity_type == "CLIENT":
        cursor.execute(
            """
            SELECT id
            FROM clients
            WHERE id = %s
            AND is_deleted = 0
            """,
            (entity_id,)
        )
        entity = cursor.fetchone()

        if not entity:
            raise HTTPException(status_code=404, detail="Клиент не найден")

    elif entity_type == "REQUEST":
        cursor.execute(
            """
            SELECT id
            FROM requests
            WHERE id = %s
            AND is_deleted = 0
            """,
            (entity_id,)
        )
        entity = cursor.fetchone()

        if not entity:
            raise HTTPException(status_code=404, detail="Заявка не найдена")


def user_can_access_client_entity(
    cursor,
    client_id: int,
    current_user: dict,
) -> bool:
    if user_has_any_permission(
        current_user,
        CLIENT_ATTACHMENTS_VIEW_ALL_PERMISSION_CODES,
    ):
        return True

    if not user_has_any_permission(
        current_user,
        CLIENT_ATTACHMENTS_VIEW_OWN_PERMISSION_CODES,
    ):
        return False

    cursor.execute(
        """
        SELECT
            id,
            created_by,
            responsible_manager_id
        FROM clients
        WHERE id = %s
        """,
        (client_id,),
    )

    client = cursor.fetchone()

    if not client:
        return False

    return is_client_owned_by_user(client, current_user)


def user_can_access_request_entity(
    cursor,
    request_id: int,
    current_user: dict,
) -> bool:
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
        (current_user["id"], request_id),
    )

    request = cursor.fetchone()

    if not request:
        return False

    user_city = None

    if user_is_limited_executor(current_user):
        user_city = get_current_user_city(cursor, current_user)

    return user_can_access_request(request, current_user, user_city)


def user_can_access_attachment_entity(
    cursor,
    entity_type: str,
    entity_id: int,
    current_user: dict,
) -> bool:
    entity_type = normalize_entity_type(entity_type)

    if entity_type == "CLIENT":
        return user_can_access_client_entity(cursor, entity_id, current_user)

    return user_can_access_request_entity(cursor, entity_id, current_user)


def ensure_attachment_entity_access(
    cursor,
    entity_type: str,
    entity_id: int,
    current_user: dict,
):
    if not user_can_access_attachment_entity(
        cursor,
        entity_type,
        entity_id,
        current_user,
    ):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для доступа к файлам этой карточки",
        )


@router.get("/entity/{entity_type}/{entity_id}")
def get_attachments(
    entity_type: str,
    entity_id: int,
    current_user: dict = Depends(get_current_user),
):
    entity_type = normalize_entity_type(entity_type)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            check_entity_exists(cursor, entity_type, entity_id)
            ensure_attachment_entity_access(
                cursor,
                entity_type,
                entity_id,
                current_user,
            )

            conditions = [
                "a.entity_type = %s",
                "a.entity_id = %s",
                "a.is_deleted = 0",
            ]

            values = [entity_type, entity_id]

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    a.id,
                    a.entity_type,
                    a.entity_id,
                    a.original_filename,
                    a.display_name,
                    a.stored_filename,
                    a.file_path,
                    a.content_type,
                    a.file_size,
                    a.is_internal,
                    a.uploaded_by,
                    u.name AS uploaded_by_name,
                    u.role AS uploaded_by_role,
                    a.uploaded_at,
                    TIMESTAMPDIFF(SECOND, a.uploaded_at, NOW()) AS age_seconds,
                    a.is_deleted,
                    a.deleted_at,
                    a.deleted_by
                FROM attachments a
                LEFT JOIN users u ON a.uploaded_by = u.id
                WHERE {where_clause}
                ORDER BY a.uploaded_at DESC
                """,
                tuple(values)
            )

            rows = cursor.fetchall()

            visible_rows = []

            for row in rows:
                row = attach_attachment_permissions(row, current_user)

                if row["can_download"]:
                    visible_rows.append(row)

            return visible_rows

    finally:
        connection.close()


@router.post("/entity/{entity_type}/{entity_id}")
def upload_attachment(
    entity_type: str,
    entity_id: int,
    file: UploadFile = File(...),
    is_internal: bool = Form(default=False),
    current_user: dict = Depends(get_current_user),
):
    entity_type = normalize_entity_type(entity_type)
    validate_file(file)

    if not user_can_upload_attachment(entity_type, current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для загрузки файла"
        )

    # Клиент не помечает файлы внутренними: он и так видит только то,
    # что ему открыли, а свой файл прятать от нас смысла нет.
    is_internal_flag = bool(is_internal) if is_employee_user(current_user) else False

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            check_entity_exists(cursor, entity_type, entity_id)
            ensure_attachment_entity_access(
                cursor,
                entity_type,
                entity_id,
                current_user,
            )

            original_filename = file.filename
            suffix = Path(original_filename).suffix.lower()
            stored_filename = f"{uuid.uuid4().hex}{suffix}"

            entity_folder = UPLOADS_ROOT / entity_type.lower() / str(entity_id)
            entity_folder.mkdir(parents=True, exist_ok=True)

            file_path = entity_folder / stored_filename

            file.file.seek(0, os.SEEK_END)
            file_size = file.file.tell()
            file.file.seek(0)

            if file_size > MAX_FILE_SIZE_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail="Файл слишком большой. Максимальный размер: 20 MB"
                )

            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            cursor.execute(
                """
                INSERT INTO attachments (
                    entity_type,
                    entity_id,
                    original_filename,
                    display_name,
                    stored_filename,
                    file_path,
                    content_type,
                    file_size,
                    is_internal,
                    uploaded_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    entity_type,
                    entity_id,
                    original_filename,
                    original_filename,
                    stored_filename,
                    str(file_path),
                    file.content_type,
                    file_size,
                    1 if is_internal_flag else 0,
                    current_user["id"],
                )
            )

            attachment_id = cursor.lastrowid
            connection.commit()

            return {
                "message": "Файл загружен",
                "attachment_id": attachment_id,
                "display_name": original_filename,
                "is_internal": is_internal_flag,
                "can_rename": True,
                "can_mark_internal": is_employee_user(current_user),
                "can_delete": True,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()

        if "file_path" in locals() and file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass

        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.get("/{attachment_id}/download")
def download_attachment(
    attachment_id: int,
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    a.id,
                    a.entity_type,
                    a.entity_id,
                    a.original_filename,
                    a.display_name,
                    a.file_path,
                    a.content_type,
                    a.is_internal,
                    a.uploaded_by,
                    u.role AS uploaded_by_role,
                    TIMESTAMPDIFF(SECOND, a.uploaded_at, NOW()) AS age_seconds,
                    a.is_deleted
                FROM attachments a
                LEFT JOIN users u ON a.uploaded_by = u.id
                WHERE a.id = %s
                """,
                (attachment_id,)
            )

            attachment = cursor.fetchone()

            if not attachment or attachment["is_deleted"]:
                raise HTTPException(status_code=404, detail="Файл не найден")

            ensure_attachment_entity_access(
                cursor,
                attachment["entity_type"],
                attachment["entity_id"],
                current_user,
            )

            if not user_can_view_attachment(attachment, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра файла"
                )

            file_path = Path(attachment["file_path"])

            if not file_path.exists():
                raise HTTPException(
                    status_code=404,
                    detail="Файл отсутствует на сервере"
                )

            return FileResponse(
                path=file_path,
                filename=attachment["display_name"] or attachment["original_filename"],
                media_type=attachment["content_type"] or "application/octet-stream"
            )

    finally:
        connection.close()


@router.patch("/{attachment_id}")
def update_attachment(
    attachment_id: int,
    data: AttachmentUpdate,
    current_user: dict = Depends(get_current_user),
):
    update_data = data.dict(exclude_unset=True)

    new_name = None

    if "display_name" in update_data:
        new_name = str(update_data.get("display_name") or "").strip()

        if not new_name:
            raise HTTPException(
                status_code=400,
                detail="Название файла не может быть пустым",
            )

    next_is_internal = None

    if "is_internal" in update_data and update_data.get("is_internal") is not None:
        next_is_internal = bool(update_data["is_internal"])

    if new_name is None and next_is_internal is None:
        raise HTTPException(status_code=400, detail="Нет данных для обновления")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    entity_type,
                    entity_id,
                    display_name,
                    is_internal,
                    uploaded_by,
                    uploaded_at,
                    TIMESTAMPDIFF(SECOND, uploaded_at, NOW()) AS age_seconds,
                    is_deleted
                FROM attachments
                WHERE id = %s
                """,
                (attachment_id,)
            )

            attachment = cursor.fetchone()

            if not attachment or attachment["is_deleted"]:
                raise HTTPException(status_code=404, detail="Файл не найден")

            if not user_can_update_attachment(attachment, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Переименовать файл может пользователь с правом управления файлами либо автор файла в течение 2 минут после загрузки"
                )

            if next_is_internal is not None and not user_can_mark_attachment_internal(
                attachment, current_user
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для изменения видимости файла",
                )

            ensure_attachment_entity_access(
                cursor,
                attachment["entity_type"],
                attachment["entity_id"],
                current_user,
            )

            updates = []
            values = []

            if new_name is not None and new_name != attachment.get("display_name"):
                updates.append("display_name = %s")
                values.append(new_name)

            if (
                next_is_internal is not None
                and next_is_internal != attachment_is_internal(attachment)
            ):
                updates.append("is_internal = %s")
                values.append(1 if next_is_internal else 0)

            if not updates:
                return {
                    "message": "Изменений нет",
                    "attachment_id": attachment_id,
                    "display_name": attachment.get("display_name"),
                    "is_internal": attachment_is_internal(attachment),
                }

            values.append(attachment_id)

            cursor.execute(
                f"""
                UPDATE attachments
                SET {', '.join(updates)}
                WHERE id = %s
                """,
                tuple(values)
            )

            connection.commit()

            return {
                "message": "Файл обновлён",
                "attachment_id": attachment_id,
                "display_name": (
                    new_name if new_name is not None else attachment.get("display_name")
                ),
                "is_internal": (
                    next_is_internal
                    if next_is_internal is not None
                    else attachment_is_internal(attachment)
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


@router.delete("/{attachment_id}")
def delete_attachment(
    attachment_id: int,
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    entity_type,
                    entity_id,
                    is_internal,
                    uploaded_by,
                    uploaded_at,
                    TIMESTAMPDIFF(SECOND, uploaded_at, NOW()) AS age_seconds,
                    is_deleted
                FROM attachments
                WHERE id = %s
                """,
                (attachment_id,)
            )

            attachment = cursor.fetchone()

            if not attachment or attachment["is_deleted"]:
                raise HTTPException(status_code=404, detail="Файл не найден")

            if not user_can_delete_attachment(attachment, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Удалить файл может пользователь с правом удаления файлов либо автор файла в течение 2 минут после загрузки"
                )

            ensure_attachment_entity_access(
                cursor,
                attachment["entity_type"],
                attachment["entity_id"],
                current_user,
            )

            cursor.execute(
                """
                UPDATE attachments
                SET is_deleted = 1,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], attachment_id)
            )

            connection.commit()

            return {
                "message": "Файл удалён",
                "attachment_id": attachment_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()