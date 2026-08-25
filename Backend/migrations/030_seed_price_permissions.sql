INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
('prices.view', 'Просмотр цен', 'Позволяет просматривать раздел цен и базовые цены', 'PRICES', 1, 500),
('prices.calculate', 'Расчёт стоимости заявки', 'Позволяет рассчитывать стоимость заявки через калькулятор цен', 'PRICES', 1, 501),
('prices.manage', 'Полное управление ценами', 'Позволяет управлять базовыми и индивидуальными ценами клиентов', 'PRICES', 1, 502),

('base_prices.view', 'Просмотр базовых цен', 'Позволяет просматривать базовый прайс-лист', 'PRICES', 1, 510),
('base_prices.create', 'Создание базовых цен', 'Позволяет создавать позиции базового прайс-листа', 'PRICES', 1, 511),
('base_prices.edit', 'Редактирование базовых цен', 'Позволяет редактировать позиции базового прайс-листа', 'PRICES', 1, 512),
('base_prices.delete', 'Отключение базовых цен', 'Позволяет отключать позиции базового прайс-листа', 'PRICES', 1, 513),
('base_prices.restore', 'Восстановление базовых цен', 'Позволяет включать ранее отключённые позиции базового прайс-листа', 'PRICES', 1, 514),
('base_prices.manage', 'Управление базовыми ценами', 'Позволяет создавать, редактировать, отключать и восстанавливать базовые цены', 'PRICES', 1, 515),

('client_prices.view', 'Просмотр индивидуальных цен клиентов', 'Позволяет просматривать индивидуальные цены клиентов', 'PRICES', 1, 520),
('client_prices.view_all', 'Просмотр индивидуальных цен всех клиентов', 'Позволяет просматривать индивидуальные цены всех клиентов', 'PRICES', 1, 521),
('client_prices.view_own', 'Просмотр индивидуальных цен своих клиентов', 'Позволяет просматривать индивидуальные цены клиентов, где пользователь является ответственным или создателем', 'PRICES', 1, 522),
('client_prices.manage', 'Управление индивидуальными ценами клиентов', 'Позволяет управлять индивидуальными ценами клиентов', 'PRICES', 1, 523),
('client_prices.manage_all', 'Управление индивидуальными ценами всех клиентов', 'Позволяет изменять индивидуальные цены всех клиентов', 'PRICES', 1, 524),
('client_prices.manage_own', 'Управление индивидуальными ценами своих клиентов', 'Позволяет изменять индивидуальные цены клиентов, где пользователь является ответственным или создателем', 'PRICES', 1, 525),

('requests.price.calculate', 'Расчёт стоимости в заявках', 'Позволяет рассчитывать стоимость при создании или редактировании заявки', 'REQUESTS', 1, 526),
('requests.prices.calculate', 'Расчёт цен в заявках', 'Алиас доступа для расчёта цен в заявках', 'REQUESTS', 1, 527),
('requests.price.view', 'Просмотр стоимости заявки', 'Позволяет видеть стоимость заявки', 'REQUESTS', 1, 528),
('requests.prices.view', 'Просмотр цен заявки', 'Алиас доступа для просмотра цен заявки', 'REQUESTS', 1, 529)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM (
    SELECT 'prices.manage' AS permission_code, 'prices.view' AS required_code UNION ALL
    SELECT 'prices.manage', 'prices.calculate' UNION ALL
    SELECT 'prices.manage', 'base_prices.manage' UNION ALL
    SELECT 'prices.manage', 'client_prices.manage_all' UNION ALL

    SELECT 'base_prices.manage', 'base_prices.view' UNION ALL
    SELECT 'base_prices.manage', 'base_prices.create' UNION ALL
    SELECT 'base_prices.manage', 'base_prices.edit' UNION ALL
    SELECT 'base_prices.manage', 'base_prices.delete' UNION ALL
    SELECT 'base_prices.manage', 'base_prices.restore' UNION ALL

    SELECT 'client_prices.view_all', 'client_prices.view' UNION ALL
    SELECT 'client_prices.view_own', 'client_prices.view' UNION ALL
    SELECT 'client_prices.manage', 'client_prices.view' UNION ALL
    SELECT 'client_prices.manage_all', 'client_prices.manage' UNION ALL
    SELECT 'client_prices.manage_all', 'client_prices.view_all' UNION ALL
    SELECT 'client_prices.manage_own', 'client_prices.manage' UNION ALL
    SELECT 'client_prices.manage_own', 'client_prices.view_own' UNION ALL

    SELECT 'requests.price.calculate', 'prices.calculate' UNION ALL
    SELECT 'requests.prices.calculate', 'prices.calculate' UNION ALL
    SELECT 'requests.price.view', 'prices.view' UNION ALL
    SELECT 'requests.prices.view', 'prices.view'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions required ON required.code = dep.required_code;

INSERT IGNORE INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM (
    SELECT 'ADMIN' AS role_code, 'prices.manage' AS permission_code UNION ALL
    SELECT 'ADMIN', 'prices.view' UNION ALL
    SELECT 'ADMIN', 'prices.calculate' UNION ALL
    SELECT 'ADMIN', 'base_prices.manage' UNION ALL
    SELECT 'ADMIN', 'client_prices.manage_all' UNION ALL
    SELECT 'ADMIN', 'requests.price.view' UNION ALL
    SELECT 'ADMIN', 'requests.price.calculate' UNION ALL

    SELECT 'ROP', 'prices.manage' UNION ALL
    SELECT 'ROP', 'prices.view' UNION ALL
    SELECT 'ROP', 'prices.calculate' UNION ALL
    SELECT 'ROP', 'base_prices.manage' UNION ALL
    SELECT 'ROP', 'client_prices.manage_all' UNION ALL
    SELECT 'ROP', 'requests.price.view' UNION ALL
    SELECT 'ROP', 'requests.price.calculate' UNION ALL

    SELECT 'MANAGER', 'prices.view' UNION ALL
    SELECT 'MANAGER', 'prices.calculate' UNION ALL
    SELECT 'MANAGER', 'base_prices.manage' UNION ALL
    SELECT 'MANAGER', 'client_prices.view_own' UNION ALL
    SELECT 'MANAGER', 'client_prices.manage_own' UNION ALL
    SELECT 'MANAGER', 'requests.price.view' UNION ALL
    SELECT 'MANAGER', 'requests.price.calculate' UNION ALL

    SELECT 'TECH_SUPPORT', 'prices.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'prices.calculate' UNION ALL
    SELECT 'TECH_SUPPORT', 'client_prices.view_all' UNION ALL
    SELECT 'TECH_SUPPORT', 'requests.price.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'requests.price.calculate' UNION ALL

    SELECT 'ACCOUNTANT', 'prices.view' UNION ALL
    SELECT 'ACCOUNTANT', 'prices.calculate' UNION ALL
    SELECT 'ACCOUNTANT', 'client_prices.view_all' UNION ALL
    SELECT 'ACCOUNTANT', 'requests.price.view' UNION ALL
    SELECT 'ACCOUNTANT', 'requests.price.calculate'
) rp_seed
INNER JOIN roles r ON r.code = rp_seed.role_code
INNER JOIN permissions p ON p.code = rp_seed.permission_code;

SELECT 'price permissions seed applied' AS result;