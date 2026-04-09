from fastapi import APIRouter, Depends, HTTPException
from app.security import get_current_user
from app.database import get_connection
from app.schemas import ClientCreate

router = APIRouter(prefix="/clients", tags=["Clients"])

@router.post("")
def create_client(data: ClientCreate, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            INSERT INTO clients (type, name, company_name, phone, email)
            VALUES (%s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (
                data.type,
                data.name,
                data.company_name,
                data.phone,
                data.email
            ))
            connection.commit()
        return {"message": "client created"}
    finally:
        connection.close()

@router.get("")
def get_clients(current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM clients")
            return cursor.fetchall()
    finally:
        connection.close()