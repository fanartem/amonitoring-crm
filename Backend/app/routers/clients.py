from fastapi import APIRouter, HTTPException, Depends
from app.database import get_connection
from app.schemas import ClientCreate
from app.security import get_current_user

router = APIRouter(prefix="/clients", tags=["Clients"])

@router.post("")
def create_client(data: ClientCreate, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Твой SQL запрос
            sql = """INSERT INTO clients (type, name, company_name, phone, email) 
                     VALUES (%s, %s, %s, %s, %s)"""
            
            cursor.execute(sql, (
                data.type,
                data.name,
                data.company_name,
                data.phone,
                data.email
            ))
            connection.commit()
            
            # === ВОТ ДВЕ ГЛАВНЫЕ СТРОЧКИ ===
            # Получаем ID только что созданной записи в MySQL
            new_id = cursor.lastrowid 
            
            # Обязательно возвращаем его под ключом "id"
            return {"id": new_id, "message": "client created"}
            
    except Exception as e:
        # Если что-то пойдет не так, возвращаем понятную ошибку
        raise HTTPException(status_code=500, detail=str(e))
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