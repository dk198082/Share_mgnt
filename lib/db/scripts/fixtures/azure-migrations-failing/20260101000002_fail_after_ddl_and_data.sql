-- Reviewed: fictional rollback integration fixture
-- Explicitly approved: exercise rollback of DDL and fictional data changes in the disposable cluster
CREATE TABLE fictional_rollback_probe (id integer PRIMARY KEY);
ALTER TABLE fictional_shareholders ADD COLUMN rollback_probe text;
UPDATE fictional_shareholders SET display_name = 'Fictional Rolled Back Name';
INSERT INTO fictional_shareholders (display_name, shares) VALUES ('Fictional Invalid Shares', -1);
