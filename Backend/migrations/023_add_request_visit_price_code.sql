ALTER TABLE requests
ADD COLUMN visit_price_code ENUM(
    'ON_SITE_CITY',
    'ON_SITE_OUTSIDE_CITY',
    'BUSINESS_TRIP_KM'
) NULL AFTER visit_type;

-- Сначала переносим городской выезд, затем более специфичные варианты.
-- Если в заявке по ошибке окажется несколько кодов, победит самый строгий:
-- командировка > выезд за город > выезд в черте города.
UPDATE requests r
JOIN request_price_lines rpl ON rpl.request_id = r.id
SET r.visit_price_code = 'ON_SITE_CITY'
WHERE r.visit_type = 'ON_SITE'
  AND rpl.code = 'ON_SITE_CITY';

UPDATE requests r
JOIN request_price_lines rpl ON rpl.request_id = r.id
SET r.visit_price_code = 'ON_SITE_OUTSIDE_CITY'
WHERE r.visit_type = 'ON_SITE'
  AND rpl.code = 'ON_SITE_OUTSIDE_CITY';

UPDATE requests r
JOIN request_price_lines rpl ON rpl.request_id = r.id
SET r.visit_price_code = 'BUSINESS_TRIP_KM'
WHERE r.visit_type = 'ON_SITE'
  AND rpl.code = 'BUSINESS_TRIP_KM';

-- Старый калькулятор считал городской выезд вариантом по умолчанию.
UPDATE requests
SET visit_price_code = 'ON_SITE_CITY'
WHERE visit_type = 'ON_SITE'
  AND visit_price_code IS NULL;

UPDATE requests
SET visit_price_code = NULL
WHERE visit_type = 'IN_OFFICE';