from pydantic import BaseModel
from typing import Optional

class InstallationDetails(BaseModel):
    has_beacon: bool = False
    has_blocking: bool = False

class RequestCreate(BaseModel):
    client_id: int
    vehicle_id: int
    work_type: str
    visit_type: str
    installation: InstallationDetails | None = None

class RequestUpdate(BaseModel):
    status: str | None = None
    is_paid: Optional[bool] = None   # для обновления статуса оплаты
    installation: InstallationDetails | None = None  # для обновления деталей установки

class CommentCreate(BaseModel):
    request_id: int
    message: str

class AssignRequest(BaseModel):
    technician_id: int

class ClientCreate(BaseModel):
    type: str  # TOO / IP / INDIVIDUAL
    name: str
    company_name: str | None = None
    phone: str
    email: str | None = None

class VehicleCreate(BaseModel):
    client_id: int
    brand: str
    model: str
    plate_number: str
    vin: str | None = None
    year: int | None = None
    type: str | None = None

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: str # ADMIN, MANAGER, TECHNICIAN, SENIOR_TECHNICIAN