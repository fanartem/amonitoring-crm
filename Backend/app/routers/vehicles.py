from fastapi import APIRouter, HTTPException, Query
from app.database import get_connection
from app.schemas import VehicleCreate

router = APIRouter(prefix="/vehicles", tags=["Vehicles"])

@router.post("")
def create_vehicle(data: VehicleCreate):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем, существует ли клиент
            cursor.execute("SELECT id FROM clients WHERE id = %s", (data.client_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Client not found")

            sql = """
            INSERT INTO vehicles 
            (client_id, brand, model, plate_number, vin, year, type)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (
                data.client_id, data.brand, data.model, 
                data.plate_number, data.vin, data.year, data.type
            ))
            connection.commit()
        return {"message": "vehicle created"}
    finally:
        connection.close()

@router.get("")
def get_vehicles(client_id: int = Query(None)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            if client_id:
                cursor.execute("SELECT * FROM vehicles WHERE client_id = %s", (client_id,))
            else:
                cursor.execute("SELECT * FROM vehicles")
            return cursor.fetchall()
    finally:
        connection.close()