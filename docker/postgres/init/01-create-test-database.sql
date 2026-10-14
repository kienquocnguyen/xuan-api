-- Runs only when the data volume is first initialized (empty volume).
-- The image already creates xuan_dev (POSTGRES_DB) owned by xuan_app (POSTGRES_USER).
-- Local development only; never used for production.
CREATE DATABASE xuan_test OWNER xuan_app;
