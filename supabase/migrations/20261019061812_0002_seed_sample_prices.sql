/*
# Seed sample price_matrix data

Adds BAR / PEAK / BREAKFAST rate codes for each room type so Pages 1, 4, 5
have data to display on first load. Numbers are realistic VND rates.
No schema changes. Idempotent — only inserts rows that do not already exist.
*/

INSERT INTO price_matrix (hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, 'BAR 1', 990000, 841500, 760000
FROM hotels h JOIN room_types rt ON rt.hotel_id = h.id
WHERE rt.name IN ('Superior Double','Standard Double','Cosy Room')
AND NOT EXISTS (SELECT 1 FROM price_matrix pm WHERE pm.hotel_id=h.id AND pm.room_type_id=rt.id AND pm.rate_code='BAR 1');

INSERT INTO price_matrix (hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, 'BAR 3', 1100000, 935000, 850000
FROM hotels h JOIN room_types rt ON rt.hotel_id = h.id
WHERE rt.name IN ('Deluxe Twin','Deluxe Double','Grand Room')
AND NOT EXISTS (SELECT 1 FROM price_matrix pm WHERE pm.hotel_id=h.id AND pm.room_type_id=rt.id AND pm.rate_code='BAR 3');

INSERT INTO price_matrix (hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, 'PEAK 1', 2150000, 1827500, 1650000
FROM hotels h JOIN room_types rt ON rt.hotel_id = h.id
WHERE rt.name = 'Executive Suite'
AND NOT EXISTS (SELECT 1 FROM price_matrix pm WHERE pm.hotel_id=h.id AND pm.room_type_id=rt.id AND pm.rate_code='PEAK 1');

INSERT INTO price_matrix (hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, 'BREAKFAST', 150000, 127500, 110000
FROM hotels h JOIN room_types rt ON rt.hotel_id = h.id
WHERE NOT EXISTS (SELECT 1 FROM price_matrix pm WHERE pm.hotel_id=h.id AND pm.room_type_id=rt.id AND pm.rate_code='BREAKFAST');

-- Seed a few daily_rates for the next 14 days for D'Lecia Superior Double BAR 1
INSERT INTO daily_rates (hotel_id, room_type_id, date, rate_code, selling_price, net_price, cms_price)
SELECT '1fc7d9da-ef9f-4171-8a8b-ee9d44b9fe93', 'c839e309-f48b-4c0e-8298-8773ac9a8df4',
       d::date, 'BAR 1', 990000, 841500, 760000
FROM generate_series(
  date_trunc('day', now())::date,
  (date_trunc('day', now())::date + interval '13 days')::date,
  interval '1 day'
) AS t(d)
WHERE NOT EXISTS (
  SELECT 1 FROM daily_rates dr
  WHERE dr.hotel_id='1fc7d9da-ef9f-4171-8a8b-ee9d44b9fe93'
    AND dr.room_type_id='c839e309-f48b-4c0e-8298-8773ac9a8df4'
    AND dr.date = d::date
    AND dr.rate_code='BAR 1'
);
