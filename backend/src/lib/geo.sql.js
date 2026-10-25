// Haversine distance in km as a SQL expression. $latParam/$lngParam are placeholders like '$1'.
const distanceSql = (latParam, lngParam, alias = 'l') => `
  ROUND((6371 * 2 * ASIN(SQRT(
    POWER(SIN(RADIANS(${alias}.latitude - ${latParam}::float8) / 2), 2) +
    COS(RADIANS(${latParam}::float8)) * COS(RADIANS(${alias}.latitude)) *
    POWER(SIN(RADIANS(${alias}.longitude - ${lngParam}::float8) / 2), 2)
  )))::numeric, 2)`;

// listing is free of confirmed bookings AND inside its opening hours for [start,end)
const freeSql = (startParam, endParam, alias = 'l') => `
  NOT EXISTS (SELECT 1 FROM bookings b WHERE b.listing_id = ${alias}.id AND b.status = 'confirmed'
              AND tstzrange(b.start_time, b.end_time) && tstzrange(${startParam}::timestamptz, ${endParam}::timestamptz))
  AND public.listing_is_open(${alias}.id, ${startParam}::timestamptz, ${endParam}::timestamptz)`;

module.exports = { distanceSql, freeSql };
