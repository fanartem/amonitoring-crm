import os
import uuid
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from app.database import get_connection
from app.security import get_current_user
from app.schemas import AttachmentUpdate

router = APIRouter(prefix="/attachments", tags=["Attachments"])

UPLOADS_ROOT = Path("uploads")
ALLOWED_ENTITY_TYPES = ["CLIENT", "REQUEST"]

MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB

ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp",
    ".pdf", ".doc", ".docx",
    ".xls", ".xlsx", ".csv",
    ".txt"
}

def normalize_entity_type(entity_type: str) -> str:
    value = str(entity_type or "").strip().upper()

    if value not in ALLOWED_ENTITY_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Некорректный тип сущности. Доступно: CLIENT, REQUEST"
        )

    return value


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


def can_manage_attachment(attachment: dict, current_user: dict) -> bool:
    if current_user["role"] in ["ADMIN", "MANAGER"]:
        return True

    if attachment.get("uploaded_by") and int(attachment["uploaded_by"]) == int(current_user["id"]):
        return True

    return False

def is_attachment_restricted_user(current_user: dict) -> bool:
    return current_user.get("role") in ["TECHNICIAN", "SENIOR_TECHNICIAN"]


def can_view_attachment(attachment: dict, current_user: dict) -> bool:
    if not is_attachment_restricted_user(current_user):
        return True

    return (
        attachment.get("uploaded_by") is not None
        and int(attachment["uploaded_by"]) == int(current_user["id"])
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

            conditions = [
                "a.entity_type = %s",
                "a.entity_id = %s",
                "a.is_deleted = 0",
            ]

            values = [entity_type, entity_id]

            if is_attachment_restricted_user(current_user):
                conditions.append("a.uploaded_by = %s")
                values.append(current_user["id"])

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
                    a.uploaded_by,
                    u.name AS uploaded_by_name,
                    a.uploaded_at,
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

            for row in rows:
                row["is_deleted"] = bool(row["is_deleted"])

            return rows

    finally:
        connection.close()

@router.post("/entity/{entity_type}/{entity_id}")
def upload_attachment(
    entity_type: str,
    entity_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    entity_type = normalize_entity_type(entity_type)
    validate_file(file)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            check_entity_exists(cursor, entity_type, entity_id)

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
                    uploaded_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    current_user["id"],
                )
            )

            attachment_id = cursor.lastrowid
            connection.commit()

            return {
                "message": "Файл загружен",
                "attachment_id": attachment_id,
                "display_name": original_filename
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
                    id,
                    original_filename,
                    display_name,
                    file_path,
                    content_type,
                    uploaded_by,
                    is_deleted
                FROM attachments
                WHERE id = %s
                """,
                (attachment_id,)
            )

            attachment = cursor.fetchone()

            if not attachment or attachment["is_deleted"]:
                raise HTTPException(status_code=404, detail="Файл не найден")
            
            if not can_view_attachment(attachment, current_user):
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
    new_name = data.display_name.strip()

    if not new_name:
        raise HTTPException(status_code=400, detail="Название файла не может быть пустым")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, uploaded_by, is_deleted
                FROM attachments
                WHERE id = %s
                """,
                (attachment_id,)
            )

            attachment = cursor.fetchone()

            if not attachment or attachment["is_deleted"]:
                raise HTTPException(status_code=404, detail="Файл не найден")

            if not can_manage_attachment(attachment, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для переименования файла"
                )

            cursor.execute(
                """
                UPDATE attachments
                SET display_name = %s
                WHERE id = %s
                """,
                (new_name, attachment_id)
            )

            connection.commit()

            return {
                "message": "Название файла обновлено",
                "attachment_id": attachment_id,
                "display_name": new_name
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
                SELECT id, uploaded_by, is_deleted
                FROM attachments
                WHERE id = %s
                """,
                (attachment_id,)
            )

            attachment = cursor.fetchone()

            if not attachment or attachment["is_deleted"]:
                raise HTTPException(status_code=404, detail="Файл не найден")

            if not can_manage_attachment(attachment, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для удаления файла"
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