INSERT INTO price_items (
    code,
    name,
    category,
    default_price,
    unit,
    is_active
)
SELECT
    'REFLASHING_BASE',
    'Перепрошивка',
    'REFLASHING_SERVICE',
    5000,
    'шт',
    1
WHERE NOT EXISTS (
    SELECT 1
    FROM price_items
    WHERE code = 'REFLASHING_BASE'
);