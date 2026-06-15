-- 1. Найти city_id Алматы из таблицы cities
SELECT id, name FROM cities WHERE name = 'Алматы';

-- 2. Добавить новый столбец city_id в таблицу warehouse_items
ALTER TABLE warehouse_items
ADD COLUMN city_id INT NULL AFTER quantity;
ALTER TABLE warehouse_items
ADD INDEX idx_warehouse_items_city_id (city_id);

-- 3. Обновить существующие записи, установив city_id для Алматы
UPDATE warehouse_items
SET city_id = 1
WHERE city_id IS NULL;

-- 4. Сделать поле обязательным
ALTER TABLE warehouse_items
MODIFY city_id INT NOT NULL;

-- 5. Создаем историю перемещений
CREATE TABLE warehouse_item_movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    warehouse_item_id INT NOT NULL,
    action VARCHAR(50) NOT NULL,

    from_city_id INT NULL,
    to_city_id INT NULL,

    quantity INT NULL,
    reason TEXT NULL,

    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_warehouse_item_id (warehouse_item_id),
    INDEX idx_from_city_id (from_city_id),
    INDEX idx_to_city_id (to_city_id),
    INDEX idx_created_by (created_by)
);