ALTER TABLE user_security_flags
    ADD COLUMN super_admin_granted_by INT NULL AFTER is_super_admin;

-- Бэкфилл: всех действующих Супер-Админов считаем поднятыми Main Admin (id = 1).
-- У самого владельца остаётся NULL — он корень цепочки и защищён отдельной проверкой.
UPDATE user_security_flags
SET super_admin_granted_by = 1
WHERE is_super_admin = 1
  AND is_owner = 0
  AND super_admin_granted_by IS NULL;

ALTER TABLE user_security_flags
    ADD CONSTRAINT fk_usf_super_admin_granted_by
    FOREIGN KEY (super_admin_granted_by) REFERENCES users(id)
    ON DELETE SET NULL;