-- Reviewed: fictional migration integration fixture
-- Explicitly approved: update only the isolated fictional test record and remove its obsolete test column
UPDATE fictional_shareholders SET reviewed = true WHERE display_name = 'Fictional Shareholder Alpha';
ALTER TABLE fictional_shareholders DROP COLUMN obsolete_test_flag;
