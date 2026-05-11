from datetime import datetime
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
    city: str | None = None
    installation: InstallationDetails | None = None

class RequestUpdate(BaseModel):
    client_id: int | None = None
    vehicle_id: int | None = None
    visit_type: str | None = None
    address: str | None = None
    city: str | None = None
    scheduled_at: datetime | None = None
    status: str | None = None
    is_paid: Optional[bool] = None
    installation: InstallationDetails | None = None

class CommentCreate(BaseModel):
    request_id: int
    message: str

class AssignRequest(BaseModel):
    technician_id: int

class ClientCreate(BaseModel):
    type: str
    name: str
    company_name: str | None = None
    phone: str
    email: str | None = None

class ClientUpdate(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

class VehicleCreate(BaseModel):
    client_id: int
    brand: str
    model: str
    plate_number: str
    vin: str | None = None
    year: int | None = None
    type: str | None = None

class VehicleUpdate(BaseModel):
    brand: Optional[str] = None
    model: Optional[str] = None
    plate_number: Optional[str] = None
    vin: Optional[str] = None
    year: Optional[int] = None
    type: Optional[str] = None

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: str

class UserUpdate(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None

class WarehouseItemCreate(BaseModel):
    category: str
    name: str
    manufacturer: str | None = None
    model: str | None = None

    identifier_type: str = "NONE"
    identifier_value: str | None = None
    serial_number: str | None = None

    is_serialized: bool = True
    quantity: int = 1

    note: str | None = None

class WarehouseItemUpdate(BaseModel):
    category: str | None = None
    name: str | None = None
    manufacturer: str | None = None
    model: str | None = None

    identifier_type: str | None = None
    identifier_value: str | None = None
    serial_number: str | None = None

    is_serialized: bool | None = None
    quantity: int | None = None

    status: str | None = None
    note: str | None = None