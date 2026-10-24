-- Runs once, when the database volume is first created.
-- The dev database (personal_os) is created by POSTGRES_DB; this adds the test database.
-- Extensions are created by migrations, not here.
CREATE DATABASE personal_os_test OWNER personal_os;
