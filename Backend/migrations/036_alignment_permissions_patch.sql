/*
  Alignment patch for access-control permissions.
  Adds missing aliases used by backend/frontend after role/permissions refactor.
*/

INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
-- Requests trash / restore
('requests.deleted.view', 'Просмотр корзины заявок', 'Позволяет видеть удалённые заявки в корзине.', 'REQUESTS', 1, 250),
('requests.trash.view', 'Просмотр удалённых заявок', 'Алиас доступа для просмотра корзины заявок.', 'REQUESTS', 1, 251),
('trash.requests.view', 'Просмотр заявок в корзине', 'Позволяет видеть удалённые заявки в общем разделе корзины.', 'REQUESTS', 1, 252),
('requests.restore', 'Восстановление заявок', 'Позволяет восстанавливать заявки из корзины.', 'REQUESTS', 1, 253),
('requests.deleted.restore', 'Восстановление удалённых заявок', 'Алиас доступа для восстановления заявок из корзины.', 'REQUESTS', 1, 254),
('trash.requests.restore', 'Восстановление заявок из корзины', 'Позволяет восстанавливать удалённые заявки из общего раздела корзины.', 'REQUESTS', 1, 255),

-- Request calendar
('calendar.view', 'Просмотр календаря', 'Позволяет открывать раздел календаря заявок.', 'REQUESTS', 1, 260),
('calendar.view_all', 'Просмотр всего календаря', 'Позволяет видеть общий календарь заявок и фильтровать по городам.', 'REQUESTS', 1, 261),
('requests.calendar.view', 'Календарь заявок', 'Позволяет просматривать календарь заявок.', 'REQUESTS', 1, 262),
('requests.calendar.view_all', 'Общий календарь заявок', 'Позволяет просматривать общий календарь заявок.', 'REQUESTS', 1, 263),

-- Request schedule / status aliases
('requests.schedule.bypass', 'Обход ограничений времени заявки', 'Позволяет назначать заявки в прошлом и обходить минимальный запас времени.', 'REQUESTS', 1, 270),
('requests.schedule.bypass_limits', 'Обход лимитов расписания заявки', 'Алиас доступа для обхода ограничений расписания заявки.', 'REQUESTS', 1, 271),
('requests.schedule_approval.decide', 'Согласование времени заявки', 'Позволяет согласовывать или отклонять нерабочее время заявки.', 'REQUESTS', 1, 272),
('requests.schedule.approve', 'Подтверждение времени заявки', 'Алиас доступа для согласования времени заявки.', 'REQUESTS', 1, 273),
('requests.status.override', 'Принудительное изменение статуса заявки', 'Позволяет обходить стандартные переходы статусов заявки.', 'REQUESTS', 1, 274),
('requests.status.override_transitions', 'Обход переходов статуса заявки', 'Алиас доступа для принудительного изменения статуса заявки.', 'REQUESTS', 1, 275),
('requests.assign_executors', 'Назначение исполнителей', 'Алиас доступа для назначения исполнителей заявки.', 'REQUESTS', 1, 276),
('requests.executors.assign', 'Назначение исполнителей заявки', 'Позволяет назначать и изменять исполнителей заявки.', 'REQUESTS', 1, 277),

-- Reports aliases
('reports.requests.view_own', 'Отчёты по своим заявкам', 'Позволяет видеть отчёты по своим клиентам и созданным заявкам.', 'REPORTS', 1, 520),

-- Notifications
('notifications.view', 'Просмотр уведомлений', 'Позволяет просматривать пользовательские уведомления.', 'NOTIFICATIONS', 1, 610),
('notifications.manage', 'Управление уведомлениями', 'Позволяет управлять типами и настройками уведомлений.', 'NOTIFICATIONS', 1, 611),

-- Client aliases used by frontend/backend helpers
('clients.status.edit', 'Изменение статуса клиента', 'Алиас для изменения статуса клиента.', 'CLIENTS', 1, 125),
('clients.update_status', 'Изменение статуса клиента', 'Алиас для изменения статуса клиента.', 'CLIENTS', 1, 126),
('clients.edit_status', 'Изменение статуса клиента', 'Алиас для изменения статуса клиента.', 'CLIENTS', 1, 127),
('clients.responsible.manage', 'Переназначение ответственного клиента', 'Алиас для переназначения ответственного менеджера клиента.', 'CLIENTS', 1, 135),
('clients.assign_responsible', 'Переназначение ответственного менеджера', 'Алиас доступа для назначения ответственного менеджера клиента.', 'CLIENTS', 1, 136),
('clients.edit_responsible', 'Переназначение ответственного менеджера', 'Алиас доступа для изменения ответственного менеджера клиента.', 'CLIENTS', 1, 137),
('clients.responsible_manager.set', 'Назначение ответственного менеджера', 'Алиас доступа для назначения ответственного менеджера клиента.', 'CLIENTS', 1, 138),
('clients.payment_type.manage', 'Изменение типа оплаты клиента', 'Позволяет менять тип оплаты клиента: предоплата или постоплата.', 'CLIENTS', 1, 145),
('clients.payment.manage', 'Управление оплатой клиента', 'Алиас для управления типом оплаты клиента.', 'CLIENTS', 1, 146),
('clients.edit_payment', 'Изменение оплаты клиента', 'Алиас для управления типом оплаты клиента.', 'CLIENTS', 1, 147),
('clients.monitoring_credentials.manage', 'Просмотр доступов мониторинга клиента', 'Позволяет видеть и задавать логин/пароль мониторинга клиента.', 'CLIENTS', 1, 155),
('clients.credentials.manage', 'Управление доступами клиента', 'Алиас для управления доступами мониторинга клиента.', 'CLIENTS', 1, 156),
('clients.monitoring_password.manage', 'Просмотр пароля мониторинга клиента', 'Позволяет видеть и задавать пароль платформы мониторинга в карточке клиента.', 'CLIENTS', 1, 157),
('clients.edit_monitoring_credentials', 'Изменение доступов мониторинга клиента', 'Алиас для управления доступами мониторинга клиента.', 'CLIENTS', 1, 158)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM (
    SELECT 'requests.deleted.restore' AS permission_code, 'requests.restore' AS required_code UNION ALL
    SELECT 'trash.requests.restore', 'requests.restore' UNION ALL
    SELECT 'requests.restore', 'requests.deleted.view' UNION ALL
    SELECT 'requests.trash.view', 'requests.deleted.view' UNION ALL
    SELECT 'trash.requests.view', 'requests.deleted.view' UNION ALL
    SELECT 'requests.calendar.view_all', 'requests.calendar.view' UNION ALL
    SELECT 'calendar.view_all', 'calendar.view' UNION ALL
    SELECT 'calendar.view', 'requests.calendar.view' UNION ALL
    SELECT 'requests.schedule.bypass_limits', 'requests.schedule.bypass' UNION ALL
    SELECT 'requests.schedule.approve', 'requests.schedule_approval.decide' UNION ALL
    SELECT 'requests.status.override_transitions', 'requests.status.override' UNION ALL
    SELECT 'requests.assign_executors', 'requests.executors.assign' UNION ALL
    SELECT 'requests.executors.assign', 'requests.executors.manage' UNION ALL
    SELECT 'reports.requests.view_own', 'reports.requests.view' UNION ALL
    SELECT 'notifications.manage', 'notifications.view' UNION ALL
    SELECT 'clients.status.edit', 'clients.status.manage' UNION ALL
    SELECT 'clients.update_status', 'clients.status.manage' UNION ALL
    SELECT 'clients.edit_status', 'clients.status.manage' UNION ALL
    SELECT 'clients.responsible.manage', 'clients.responsible_manager.manage' UNION ALL
    SELECT 'clients.assign_responsible', 'clients.responsible_manager.manage' UNION ALL
    SELECT 'clients.edit_responsible', 'clients.responsible_manager.manage' UNION ALL
    SELECT 'clients.responsible_manager.set', 'clients.responsible_manager.manage' UNION ALL
    SELECT 'clients.payment.manage', 'clients.payment_type.manage' UNION ALL
    SELECT 'clients.edit_payment', 'clients.payment_type.manage' UNION ALL
    SELECT 'clients.credentials.manage', 'clients.monitoring_credentials.manage' UNION ALL
    SELECT 'clients.monitoring_password.manage', 'clients.monitoring_credentials.manage' UNION ALL
    SELECT 'clients.edit_monitoring_credentials', 'clients.monitoring_credentials.manage'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions required ON required.code = dep.required_code;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
    SELECT 'ADMIN' AS role_code, 'requests.restore' AS permission_code UNION ALL
    SELECT 'ADMIN', 'requests.deleted.view' UNION ALL
    SELECT 'ADMIN', 'requests.calendar.view_all' UNION ALL
    SELECT 'ADMIN', 'requests.schedule.bypass' UNION ALL
    SELECT 'ADMIN', 'requests.schedule_approval.decide' UNION ALL
    SELECT 'ADMIN', 'requests.status.override' UNION ALL
    SELECT 'ADMIN', 'notifications.manage' UNION ALL
    SELECT 'ADMIN', 'clients.payment_type.manage' UNION ALL
    SELECT 'ADMIN', 'clients.monitoring_credentials.manage' UNION ALL

    SELECT 'ROP', 'requests.restore' UNION ALL
    SELECT 'ROP', 'requests.deleted.view' UNION ALL
    SELECT 'ROP', 'requests.calendar.view_all' UNION ALL
    SELECT 'ROP', 'requests.schedule_approval.decide' UNION ALL
    SELECT 'ROP', 'requests.status.override' UNION ALL
    SELECT 'ROP', 'notifications.manage' UNION ALL
    SELECT 'ROP', 'clients.payment_type.manage' UNION ALL
    SELECT 'ROP', 'clients.monitoring_credentials.manage' UNION ALL

    SELECT 'MANAGER', 'requests.calendar.view' UNION ALL
    SELECT 'MANAGER', 'notifications.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'requests.calendar.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'notifications.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'clients.monitoring_credentials.manage' UNION ALL
    SELECT 'ACCOUNTANT', 'requests.calendar.view' UNION ALL
    SELECT 'ACCOUNTANT', 'notifications.view' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'requests.calendar.view' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'notifications.view' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'requests.calendar.view' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'notifications.view' UNION ALL
    SELECT 'TECHNICIAN', 'requests.calendar.view' UNION ALL
    SELECT 'TECHNICIAN', 'notifications.view'
) grants
INNER JOIN roles r ON r.code = grants.role_code
INNER JOIN permissions p ON p.code = grants.permission_code;
