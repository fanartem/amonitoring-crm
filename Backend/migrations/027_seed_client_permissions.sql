-- Backend/app/migrations/20260821_seed_client_permissions.sql
-- Добавляет/дополняет permissions для клиентов.
-- Безопасно запускать повторно: все INSERT защищены NOT EXISTS.

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.view', 'Просмотр клиентов', 'Позволяет открывать раздел клиентов с учётом data_scope роли.', 'clients', 100, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.view_all', 'Просмотр всех клиентов', 'Позволяет видеть и открывать всех клиентов без ограничения только на ответственных.', 'clients', 110, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.view_all');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.view_own', 'Просмотр своих клиентов', 'Позволяет видеть и открывать клиентов, где пользователь создатель или ответственный.', 'clients', 120, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.view_own');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.create', 'Создание клиентов', 'Позволяет создавать новых клиентов.', 'clients', 130, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.create');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.edit_all', 'Редактирование всех клиентов', 'Позволяет редактировать карточки всех клиентов.', 'clients', 140, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.edit_all');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.edit_own', 'Редактирование своих клиентов', 'Позволяет редактировать клиентов, где пользователь создатель или ответственный.', 'clients', 150, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.edit_own');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.manage_own', 'Управление своими клиентами', 'Позволяет управлять клиентами, где пользователь создатель или ответственный.', 'clients', 160, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.manage_own');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.status.manage', 'Изменение статуса клиента', 'Позволяет менять статус клиента: активный, должник, заблокирован.', 'clients', 170, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.status.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.change_status', 'Изменение статуса клиента', 'Алиас для изменения статуса клиента.', 'clients', 171, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.change_status');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.reassign', 'Переназначение ответственного клиента', 'Позволяет менять ответственного менеджера клиента.', 'clients', 180, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.reassign');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.responsible_manager.manage', 'Управление ответственными клиентами', 'Алиас для переназначения ответственных менеджеров клиентов.', 'clients', 181, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.responsible_manager.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.payment_type.manage', 'Изменение типа оплаты клиента', 'Позволяет менять тип оплаты клиента: предоплата или постоплата.', 'clients', 190, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.payment_type.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.payment.manage', 'Управление оплатой клиента', 'Алиас для управления типом оплаты клиента.', 'clients', 191, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.payment.manage');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.delete', 'Удаление клиентов', 'Позволяет перемещать клиентов в корзину.', 'clients', 200, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.delete');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.restore', 'Восстановление клиентов', 'Позволяет восстанавливать клиентов из корзины.', 'clients', 210, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.restore');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.trash.view', 'Просмотр корзины клиентов', 'Позволяет видеть удалённых клиентов.', 'clients', 220, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.trash.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.deleted.view', 'Просмотр удалённых клиентов', 'Алиас для просмотра корзины клиентов.', 'clients', 221, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.deleted.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.monitoring_password.view', 'Просмотр пароля мониторинга клиента', 'Позволяет видеть и задавать пароль платформы мониторинга в карточке клиента.', 'clients', 230, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.monitoring_password.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.credentials.view', 'Просмотр доступов мониторинга клиента', 'Алиас для просмотра логина/пароля мониторинга клиента.', 'clients', 231, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.credentials.view');

INSERT INTO permissions (code, name, description, category, sort_order, is_active)
SELECT 'clients.manage', 'Полное управление клиентами', 'Позволяет просматривать, создавать, редактировать, удалять и администрировать клиентов.', 'clients', 300, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'clients.manage');

-- clients.manage включает основные действия по клиентам.
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code IN (
    'clients.view',
    'clients.view_all',
    'clients.create',
    'clients.edit_all',
    'clients.status.manage',
    'clients.reassign',
    'clients.payment_type.manage',
    'clients.delete',
    'clients.restore',
    'clients.trash.view',
    'clients.monitoring_password.view'
)
WHERE p.code = 'clients.manage'
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );

-- Управление своими клиентами включает просмотр/редактирование только своих клиентов.
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code IN (
    'clients.view_own',
    'clients.edit_own'
)
WHERE p.code = 'clients.manage_own'
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );

-- Частные действия требуют базового просмотра клиентов.
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required ON required.code = 'clients.view'
WHERE p.code IN (
    'clients.create',
    'clients.edit_all',
    'clients.status.manage',
    'clients.change_status',
    'clients.reassign',
    'clients.responsible_manager.manage',
    'clients.payment_type.manage',
    'clients.payment.manage',
    'clients.delete',
    'clients.restore',
    'clients.trash.view',
    'clients.deleted.view',
    'clients.monitoring_password.view',
    'clients.credentials.view'
)
  AND NOT EXISTS (
      SELECT 1
      FROM permission_dependencies pd
      WHERE pd.permission_id = p.id
        AND pd.required_permission_id = required.id
  );