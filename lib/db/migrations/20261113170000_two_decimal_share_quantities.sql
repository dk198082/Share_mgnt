-- Reviewed: Two-decimal Common and Preferred share quantities, preserving existing values.
-- Explicitly approved: User requested two-decimal app support; lossless widening and equivalent quantity-check replacement.
-- Production execution remains a separate authorized release operation.
ALTER TABLE certificates
  ALTER COLUMN quantity TYPE numeric(15,2) USING quantity::numeric(15,2),
  ALTER COLUMN transferred_quantity TYPE numeric(15,2) USING transferred_quantity::numeric(15,2);
ALTER TABLE share_transfers
  ALTER COLUMN quantity TYPE numeric(15,2) USING quantity::numeric(15,2);

-- Rebuild the same bounds after widening: PostgreSQL otherwise retains casts
-- tied to the former bigint types, which disagree with the reviewed numeric model.
ALTER TABLE certificates
  DROP CONSTRAINT certificate_quantity_positive,
  DROP CONSTRAINT certificate_transferred_range,
  ADD CONSTRAINT certificate_quantity_positive CHECK (quantity > 0::numeric AND quantity <= 1000000000000::numeric),
  ADD CONSTRAINT certificate_transferred_range CHECK (transferred_quantity >= 0::numeric AND transferred_quantity <= quantity);
ALTER TABLE share_transfers
  DROP CONSTRAINT transfer_positive_quantity,
  ADD CONSTRAINT transfer_positive_quantity CHECK (quantity > 0::numeric AND quantity <= 1000000000000::numeric);
