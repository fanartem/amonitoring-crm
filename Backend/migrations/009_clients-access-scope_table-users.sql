-- 1 Добавление столбца доступа к клиентам
ALTER TABLE users
ADD COLUMN client_access_scope VARCHAR(30) NOT NULL DEFAULT 'DEFAULT';

-- 2 Ограничение конкретно для Максима
UPDATE users
SET client_access_scope = 'RESPONSIBLE_ONLY'
WHERE email = 'maksim.anyushin@amonitoring.kz';