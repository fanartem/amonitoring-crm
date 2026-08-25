-- Backend/app/migrations/20260823_seed_vehicle_permissions.sql
-- Добавляет permissions для машин/техники.
-- Безопасно запускать повторно: все INSERT защищены NOT EXISTS.

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.view', 'Просмотр машин', 'Позволяет просматривать машины внутри доступных клиентов.', 'vehicles', 100, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.view_all', 'Просмотр всех машин', 'Позволяет просматривать машины всех клиентов.', 'vehicles', 110, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.view_all');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.view_own', 'Просмотр машин своих клиентов', 'Позволяет просматривать машины клиентов, доступных пользователю по зоне ответственности.', 'vehicles', 120, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.view_own');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.create', 'Создание машин', 'Позволяет добавлять машины клиентам, доступным пользователю.', 'vehicles', 200, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.create');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.import', 'Импорт машин из Excel', 'Позволяет скачивать шаблон и проверять Excel-файл для импорта машин.', 'vehicles', 210, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.import');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.edit', 'Редактирование машин', 'Позволяет редактировать машины.', 'vehicles', 300, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.edit');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.edit_all', 'Редактирование всех машин', 'Позволяет редактировать машины всех клиентов.', 'vehicles', 310, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.edit_all');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.edit_own', 'Редактирование машин своих клиентов', 'Позволяет редактировать машины только у доступных пользователю клиентов.', 'vehicles', 320, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.edit_own');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.transfer', 'Перенос машин между клиентами', 'Позволяет переносить машину от одного клиента к другому.', 'vehicles', 400, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.transfer');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.transfer_client', 'Смена клиента у машины', 'Алиас доступа для переноса машины между клиентами.', 'vehicles', 410, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.transfer_client');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.transfer_history.view', 'Просмотр истории переноса машин', 'Позволяет смотреть историю переноса машины между клиентами.', 'vehicles', 420, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.transfer_history.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.vin_history.view', 'Просмотр истории VIN', 'Позволяет смотреть историю переиспользования VIN.', 'vehicles', 430, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.vin_history.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.trash.view', 'Просмотр корзины машин', 'Позволяет видеть удалённые машины.', 'vehicles', 500, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.trash.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.deleted.view', 'Просмотр удалённых машин', 'Алиас доступа для просмотра корзины машин.', 'vehicles', 510, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.deleted.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.delete', 'Удаление машин', 'Позволяет перемещать машины в корзину.', 'vehicles', 600, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.delete');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.restore', 'Восстановление машин', 'Позволяет восстанавливать машины из корзины.', 'vehicles', 610, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.restore');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.equipment.manage', 'Управление оборудованием машины', 'Позволяет напрямую привязывать оборудование к машине вне заявки.', 'vehicles', 700, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.equipment.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.vehicle_equipment.manage', 'Прямая привязка оборудования к машине', 'Позволяет напрямую привязывать складское оборудование к автомобилю.', 'warehouse', 360, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.vehicle_equipment.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'vehicles.manage', 'Управление машинами', 'Полный доступ к управлению машинами.', 'vehicles', 900, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'vehicles.manage');

-- dependencies

INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code = 'vehicles.view'
WHERE p.code IN (
    'vehicles.view_all',
    'vehicles.view_own',
    'vehicles.create',
    'vehicles.import',
    'vehicles.edit',
    'vehicles.edit_all',
    'vehicles.edit_own',
    'vehicles.transfer',
    'vehicles.transfer_client',
    'vehicles.transfer_history.view',
    'vehicles.vin_history.view',
    'vehicles.trash.view',
    'vehicles.deleted.view',
    'vehicles.delete',
    'vehicles.restore',
    'vehicles.equipment.manage',
    'warehouse.vehicle_equipment.manage'
)
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );

INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code IN (
    'vehicles.view',
    'vehicles.create',
    'vehicles.import',
    'vehicles.edit',
    'vehicles.edit_all',
    'vehicles.transfer',
    'vehicles.transfer_history.view',
    'vehicles.vin_history.view',
    'vehicles.trash.view',
    'vehicles.delete',
    'vehicles.restore',
    'vehicles.equipment.manage'
)
WHERE p.code = 'vehicles.manage'
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );

INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code = 'vehicles.transfer'
WHERE p.code = 'vehicles.transfer_client'
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );

INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code = 'vehicles.trash.view'
WHERE p.code IN ('vehicles.deleted.view', 'vehicles.restore')
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );

INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code IN ('warehouse.view', 'warehouse.items.view')
WHERE p.code = 'warehouse.vehicle_equipment.manage'
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );