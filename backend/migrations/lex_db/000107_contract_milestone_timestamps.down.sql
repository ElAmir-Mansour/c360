ALTER TABLE contracts
    ALTER COLUMN effective_date TYPE DATE USING effective_date::date,
    ALTER COLUMN expiry_date TYPE DATE USING expiry_date::date,
    ALTER COLUMN renewal_date TYPE DATE USING renewal_date::date,
    ALTER COLUMN signed_date TYPE DATE USING signed_date::date;
