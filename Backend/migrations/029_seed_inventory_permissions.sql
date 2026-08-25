-- Backend/app/migrations/20260824_seed_inventory_permissions.sql
-- Добавляет permissions для страницы инвентаря сотрудников.
-- Безопасно запускать повторно: все INSERT защищены NOT EXISTS.

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.view', 'Просмотр инвентаря сотрудников', 'Позволяет открывать раздел инвентаря сотрудников.', 'warehouse', 360, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.view_all', 'Просмотр всего инвентаря сотрудников', 'Позволяет видеть инвентарь всех сотрудников.', 'warehouse', 361, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.view_all');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.employee_inventory.view', 'Просмотр инвентаря сотрудников', 'Алиас доступа для просмотра инвентаря сотрудников.', 'warehouse', 362, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.employee_inventory.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.manage', 'Управление инвентарём сотрудников', 'Позволяет управлять инвентарём сотрудников.', 'warehouse', 370, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.manage_all', 'Полное управление инвентарём сотрудников', 'Позволяет управлять инвентарём всех сотрудников.', 'warehouse', 371, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.manage_all');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.employee_inventory.manage', 'Управление инвентарём сотрудников', 'Алиас доступа для управления инвентарём сотрудников.', 'warehouse', 372, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.employee_inventory.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.manual_add', 'Ручное добавление инвентаря сотруднику', 'Позволяет вручную добавлять предметы в инвентарь сотрудника.', 'warehouse', 380, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.manual_add');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.assign', 'Выдача инвентаря сотруднику', 'Позволяет выдавать или назначать инвентарь сотрудникам.', 'warehouse', 381, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.assign');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.transfer', 'Перенос инвентаря', 'Позволяет переносить предметы между сотрудниками или возвращать их на склад.', 'warehouse', 382, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.transfer');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.transfer_to_stock', 'Возврат инвентаря на склад', 'Позволяет возвращать предметы из инвентаря сотрудника на склад.', 'warehouse', 383, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.transfer_to_stock');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.return_to_stock', 'Возврат инвентаря на склад', 'Алиас доступа для возврата инвентаря сотрудника на склад.', 'warehouse', 384, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.return_to_stock');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.edit', 'Редактирование инвентаря сотрудника', 'Позволяет редактировать предметы в инвентаре сотрудника.', 'warehouse', 390, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.edit');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.inventory.delete', 'Удаление инвентаря сотрудника', 'Позволяет перемещать предметы из инвентаря сотрудника в корзину.', 'warehouse', 391, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.inventory.delete');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.consumable_thresholds.manage', 'Пороги расходников', 'Позволяет менять минимальные пороги расходников.', 'warehouse', 400, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.consumable_thresholds.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.thresholds.manage', 'Пороги склада', 'Алиас доступа для управления порогами склада.', 'warehouse', 401, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.thresholds.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.history.view', 'Просмотр истории склада', 'Позволяет смотреть историю движений оборудования и инвентаря.', 'warehouse', 410, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.history.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'warehouse.items.history.view', 'Просмотр истории оборудования', 'Алиас доступа для просмотра истории оборудования.', 'warehouse', 411, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'warehouse.items.history.view');

-- Управляющие доступы автоматически требуют просмотр инвентаря.
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code = 'warehouse.inventory.view'
WHERE p.code IN (
    'warehouse.inventory.manage',
    'warehouse.inventory.manage_all',
    'warehouse.employee_inventory.manage',
    'warehouse.inventory.manual_add',
    'warehouse.inventory.assign',
    'warehouse.inventory.transfer',
    'warehouse.inventory.transfer_to_stock',
    'warehouse.inventory.return_to_stock',
    'warehouse.inventory.edit',
    'warehouse.inventory.delete',
    'warehouse.consumable_thresholds.manage'
)
AND NOT EXISTS (
    SELECT 1
    FROM permission_dependencies pd
    WHERE pd.permission_id = p.id
      AND pd.required_permission_id = required.id
);