-- Reviewed: fictional migration integration fixture
ALTER TABLE fictional_shareholders ADD COLUMN reviewed boolean NOT NULL DEFAULT false;
CREATE INDEX fictional_shareholders_reviewed_idx ON fictional_shareholders (reviewed);
