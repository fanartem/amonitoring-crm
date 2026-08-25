-- Backend/app/migrations/20260821_seed_request_equipment_permissions.sql
-- Добавляет недостающие permissions для оборудования заявок и инвентарей сотрудников.
-- Безопасно запускать повторно: все INSERT защищены NOT EXISTS.

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT
    'requests.equipment.view',
    'Просмотр оборудования в заявках',
    'Позволяет видеть вкладку оборудования внутри заявки.',
    'requests',
    610,
    1
WHERE NOT EXISTS (
    SELECT 1 FROM permissions WHERE code = 'requests.equipment.view'
);

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT
    'requests.equipment.attach',
    'Привязка оборудования к заявкам',
    'Позволяет привязывать оборудование к автомобилям внутри заявки.',
    'requests',
    620,
    1
WHERE NOT EXISTS (
    SELECT 1 FROM permissions WHERE code = 'requests.equipment.attach'
);

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT
    'requests.equipment.manage',
    'Управление оборудованием в заявках',
    'Позволяет просматривать, привязывать и управлять оборудованием внутри заявок.',
    'requests',
    630,
    1
WHERE NOT EXISTS (
    SELECT 1 FROM permissions WHERE code = 'requests.equipment.manage'
);

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT
    'warehouse.employee_equipment.manage',
    'Управление оборудованием у сотрудников',
    'Позволяет использовать инвентарь сотрудников при привязке оборудования к заявкам.',
    'warehouse',
    350,
    1
WHERE NOT EXISTS (
    SELECT 1 FROM permissions WHERE code = 'warehouse.employee_equipment.manage'
);

-- requests.equipment.attach требует просмотра оборудования в заявке
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code = 'requests.equipment.view'
WHERE p.code = 'requests.equipment.attach'
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );

-- requests.equipment.manage включает просмотр и привязку
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code IN (
    'requests.equipment.view',
    'requests.equipment.attach'
)
WHERE p.code = 'requests.equipment.manage'
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );

-- Управление оборудованием у сотрудников автоматически даёт доступ к вкладке и привязке в заявке,
-- но НЕ даёт warehouse.manage и НЕ открывает прямое управление складом.
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code IN (
    'requests.equipment.view',
    'requests.equipment.attach'
)
WHERE p.code = 'warehouse.employee_equipment.manage'
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );