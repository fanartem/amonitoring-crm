/*
  Этап 2: настоящая иерархия клиентов.

  Родитель перестаёт определяться совпадением строкового имени
  (source_parent_client_name) и переезжает в clients.parent_client_id.

  Строковые поля source_* остаются как след импорта из GLONASS Soft,
  но связь по ним больше не строится.

  Проверено на данных перед миграцией: 352 подклиента, у каждого ровно
  один родитель; потерянных и неоднозначных нет.
*/

-- 1. Колонка
ALTER TABLE clients
    ADD COLUMN parent_client_id INT NULL AFTER responsible_manager_id;

-- 2. Заполнение из строковых имён.
--    Технический корень «ТОО "Автопарк-Слежение"» родителем не становится —
--    так же, как его сегодня игнорирует TECHNICAL_ROOT_PARENT_NAMES в коде.
--    Вариант (B): уберите блок AND LOWER(TRIM(...)) NOT IN (...) целиком,
--    и 295 клиентов станут подклиентами этого клиента.
UPDATE clients c
INNER JOIN clients p
    ON p.is_deleted = 0
   AND p.id <> c.id
   AND LOWER(TRIM(COALESCE(
           NULLIF(p.source_client_name, ''),
           NULLIF(p.company_name, ''),
           NULLIF(p.name, '')
       ))) = LOWER(TRIM(c.source_parent_client_name))
SET c.parent_client_id = p.id
WHERE c.is_deleted = 0
  AND c.source_parent_client_name IS NOT NULL
  AND TRIM(c.source_parent_client_name) <> ''
  AND LOWER(TRIM(c.source_parent_client_name)) NOT IN (
      'тоо "автопарк-слежение"',
      'тоо «автопарк-слежение»',
      'автопарк-слежение',
      'автопарк слежение'
  );

-- 3. Индекс и внешний ключ.
--    ON DELETE SET NULL: клиенты удаляются мягко, физическое удаление —
--    аварийный сценарий, и оно не должно уносить с собой подклиентов.
ALTER TABLE clients
    ADD KEY idx_clients_parent_client (parent_client_id),
    ADD CONSTRAINT fk_clients_parent_client
        FOREIGN KEY (parent_client_id) REFERENCES clients (id) ON DELETE SET NULL;