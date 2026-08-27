INSERT INTO permissions
    (code, name, description, category, is_dangerous, is_system, is_active, sort_order)
VALUES
    ('vehicles.trash.view_all',
     'Просмотр корзины машин всех клиентов',
     'Позволяет видеть удалённые машины всех клиентов.',
     'VEHICLES', 1, 0, 1, 100),
    ('vehicles.trash.view_own',
     'Просмотр корзины машин своих клиентов',
     'Позволяет видеть удалённые машины только тех клиентов, где пользователь создатель или ответственный.',
     'VEHICLES', 0, 0, 1, 101)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    is_active = 1;