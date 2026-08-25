from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

class RequestCreate(BaseModel):
    client_id: int
    work_type: str
    visit_type: str
    visit_price_code: str | None = None
    city: str | None = None
    platform: str
    address: str | None = None
    scheduled_at: datetime | None = None
    schedule_approval_reason: str | None = None
    vehicles: list["RequestVehicleInput"]
    price: "RequestPriceInput | None" = None

class RequestUpdate(BaseModel):
    visit_type: str | None = None
    visit_price_code: str | None = None
    address: str | None = None
    city: str | None = None
    platform: str | None = None
    scheduled_at: datetime | None = None
    schedule_approval_reason: str | None = None
    status: str | None = None
    is_paid: Optional[bool] = None

class RequestScheduleApproval(BaseModel):
    status: str
    comment: str | None = None

class RequestVehicleInput(BaseModel):
    vehicle_id: int
    has_beacon: bool = False
    has_blocking: bool = False
    extra_sensors: list["ExtraSensorInput"] = []

class ExtraSensorInput(BaseModel):
    name: str
    price: float = 0

class CommentCreate(BaseModel):
    request_id: int
    message: str

class SupportRequestCreate(BaseModel):
    client_id: int
    vehicle_id: int | None = None
    contact_phone: str
    problem_description: str
    priority: str = "NORMAL"
    assigned_to: int | None = None


class SupportRequestUpdate(BaseModel):
    client_id: int | None = None
    vehicle_id: int | None = None
    contact_phone: str | None = None
    problem_description: str | None = None
    priority: str | None = None
    status: str | None = None
    assigned_to: int | None = None


class SupportRequestCommentCreate(BaseModel):
    message: str

class AssignRequest(BaseModel):
    technician_id: int | None = None

class RequestExecutorsAssign(BaseModel):
    executor_ids: list[int] = []

class ClientCreate(BaseModel):
    type: str
    name: str
    company_name: str | None = None
    bin_iin: str | None = None
    phone: str
    email: str | None = None
    monitoring_login: str | None = None
    monitoring_password: str | None = None

    status: str | None = None
    payment_type: str | None = None
    responsible_manager_id: int | None = None

    source_system: str | None = None
    source_client_name: str | None = None
    source_parent_client_name: str | None = None
    source_inn: str | None = None


class ClientUpdate(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    company_name: Optional[str] = None
    bin_iin: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    monitoring_login: Optional[str] = None
    monitoring_password: Optional[str] = None

    status: Optional[str] = None
    responsible_manager_id: Optional[int] = None

    source_system: Optional[str] = None
    source_client_name: Optional[str] = None
    source_parent_client_name: Optional[str] = None
    source_inn: Optional[str] = None

class ClientStatusUpdate(BaseModel):
    status: str

class ClientResponsibleUpdate(BaseModel):
    responsible_manager_id: int | None = None
    apply_to_subclients: bool = True

class ClientPaymentTypeUpdate(BaseModel):
    payment_type: str

class VehicleCreate(BaseModel):
    client_id: int
    brand: str
    model: str
    plate_number: str
    vin: str
    year: int | None = None
    type: str | None = None

class VehicleUpdate(BaseModel):
    brand: Optional[str] = None
    model: Optional[str] = None
    plate_number: Optional[str] = None
    vin: Optional[str] = None
    year: Optional[int] = None
    type: Optional[str] = None

class VehicleClientTransfer(BaseModel):
    new_client_id: int
    reason: str

class VehicleDeleteRequest(BaseModel):
    delete_reason_type: str
    delete_reason: str

class CityCreate(BaseModel):
    name: str

class CityUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: str
    city: str | None = None

class UserUpdate(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    city: Optional[str] = None

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

    city_id: int

    condition_status: str | None = None
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

    city_id: Optional[int] = None

    status: str | None = None
    condition_status: str | None = None
    note: str | None = None

class WarehouseItemTransfer(BaseModel):
    from_city_id: int
    to_city_id: int
    quantity: int = 1
    reason: Optional[str] = None

class WarehouseItemAssignToUser(BaseModel):
    target_user_id: int
    quantity: int = 1
    reason: Optional[str] = None


class WarehouseItemReturnToStock(BaseModel):
    city_id: int
    quantity: int = 1
    reason: Optional[str] = None


class WarehouseManualAddToUser(BaseModel):
    category: str
    name: str
    manufacturer: str | None = None
    model: str | None = None

    identifier_type: str = "NONE"
    identifier_value: str | None = None
    serial_number: str | None = None

    is_serialized: bool = True
    quantity: int = 1

    city_id: int
    target_user_id: int

    condition_status: str | None = None
    note: str | None = None
    reason: str | None = None


class WarehouseInventoryTransfer(BaseModel):
    from_user_id: int | None = None
    target_user_id: int | None = None
    to_city_id: int | None = None
    quantity: int = 1
    reason: str | None = None


class WarehouseConsumableThresholdUpdate(BaseModel):
    city_id: int
    category: str
    name: str
    manufacturer: str | None = None
    model: str | None = None
    threshold_quantity: int = 20

class RequestEquipmentAttach(BaseModel):
    request_vehicle_id: int
    warehouse_item_id: int
    quantity: int = 1

    # Необязательно.
    # Нужно для ADMIN / WAREHOUSE_MANAGER, когда они добавляют оборудование
    # за монтажника или напрямую со склада.
    # Если не передать, backend сам определит:
    # - assigned_to_user_id у предмета
    # - либо current_user
    installed_by_user_id: int | None = None

    note: str | None = None

class VehicleEquipmentAttach(BaseModel):
    warehouse_item_id: int
    quantity: int = 1
    note: str | None = None

class VehicleEquipmentDetach(BaseModel):
    reason: str | None = None

class PriceItemCreate(BaseModel):
    code: str
    name: str
    category: str
    default_price: float = 0
    unit: str = "шт"


class PriceItemUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    default_price: Optional[float] = None
    unit: Optional[str] = None
    is_active: Optional[bool] = None


class ClientPriceOverrideItem(BaseModel):
    price_item_id: int
    price: float


class ClientPriceOverrideUpdate(BaseModel):
    prices: list[ClientPriceOverrideItem]

class CalculateExtraSensor(BaseModel):
    name: str
    price: float = 0


class CalculateManualLine(BaseModel):
    label: str
    quantity: float = 1
    unit_price: float = 0


class CalculateRequestVehicle(BaseModel):
    # GPS может быть не выбран, потому что бывают заявки "только маяк"
    gps_price_code: Optional[str] = None

    # Подписка на трекер отдельной строкой
    tracker_subscription_months: int = 1

    # Маяк
    has_beacon: bool = False

    # Подписка на маяк отдельной строкой
    beacon_subscription_months: int = 1

    # Блокировка
    has_blocking: bool = False

    # Дополнительные датчики конкретного авто
    extra_sensors: list[CalculateExtraSensor] = []


class CalculateRequestPrice(BaseModel):
    client_id: Optional[int] = None

    work_type: str
    visit_type: str

    # Если ON_SITE, можно выбрать тип выезда
    # ON_SITE_CITY / ON_SITE_OUTSIDE_CITY / BUSINESS_TRIP_KM
    visit_price_code: Optional[str] = None

    # Для BUSINESS_TRIP_KM
    visit_km: Optional[float] = None

    # Для диагностики
    has_power_restore: bool = False

    vehicles: list[CalculateRequestVehicle] = []

    # Ручные строки калькулятора
    manual_lines: list[CalculateManualLine] = []

class RequestPriceLineInput(BaseModel):
    line_key: Optional[str] = None
    vehicle_index: Optional[int] = None
    code: Optional[str] = None
    label: str
    quantity: float = 1
    unit: str = "шт"
    unit_price: float = 0
    total_price: float = 0
    source: str = "base"
    is_manual: bool = False


class RequestPriceInput(BaseModel):
    total_price: float = 0
    lines: list["RequestPriceLineInput"] = []
    
class NotificationTypeOut(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    category: str
    default_enabled: bool
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class NotificationOut(BaseModel):
    id: int
    user_id: int
    type_code: str
    title: str
    message: str
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    actor_user_id: Optional[int] = None
    is_read: bool
    read_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class NotificationSettingOut(BaseModel):
    type_code: str
    name: str
    description: Optional[str] = None
    category: str
    is_enabled: bool


class NotificationSettingUpdate(BaseModel):
    type_code: str
    is_enabled: bool


class NotificationSettingsBulkUpdate(BaseModel):
    settings: list[NotificationSettingUpdate]

class NotificationIgnoredCitiesUpdate(BaseModel):
    city_ids: list[int] = []

class UserCityAccessOut(BaseModel):
    id: int
    user_id: int
    city_id: int
    city_name: str
    can_view_requests: bool
    can_receive_notifications: bool


class UserCityAccessUpdateItem(BaseModel):
    city_id: int
    can_view_requests: bool = True
    can_receive_notifications: bool = True


class UserCityAccessBulkUpdate(BaseModel):
    user_id: int
    cities: list[UserCityAccessUpdateItem]

class AttachmentOut(BaseModel):
    id: int
    entity_type: str
    entity_id: int

    original_filename: str
    display_name: str
    stored_filename: str
    file_path: str

    content_type: Optional[str] = None
    file_size: int = 0

    uploaded_by: Optional[int] = None
    uploaded_by_name: Optional[str] = None
    uploaded_at: Optional[datetime] = None

    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[int] = None


class AttachmentUpdate(BaseModel):
    display_name: str

class RoleCreate(BaseModel):
    code: str
    name: str
    description: str | None = None
    badge_color: str = "#64748B"
    data_scope: str = "NONE"
    is_active: bool = True
    can_be_request_executor: bool = False
    can_be_responsible_manager: bool = False
    sort_order: int = 100
    permission_codes: list[str] = []
    reason: str | None = None


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    badge_color: str | None = None
    data_scope: str | None = None
    is_active: bool | None = None
    can_be_request_executor: bool | None = None
    can_be_responsible_manager: bool | None = None
    sort_order: int | None = None
    reason: str | None = None


class RolePermissionsUpdate(BaseModel):
    permission_codes: list[str]
    reason: str | None = None


class UserPermissionOverrideInput(BaseModel):
    permission_code: str
    effect: str


class UserPermissionOverridesUpdate(BaseModel):
    overrides: list[UserPermissionOverrideInput] = []
    reason: str | None = None


class UserSecurityFlagsUpdate(BaseModel):
    is_super_admin: bool | None = None
    reason: str | None = None


class UserRoleUpdate(BaseModel):
    role: str
    city: str | None = None
    reason: str | None = None