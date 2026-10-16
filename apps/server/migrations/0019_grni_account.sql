-- Goods receipts bring stock in before the vendor's bill; this holds their value until it is billed.
INSERT INTO "account_account" ("code", "name", "type", "key") VALUES ('2150', 'Goods received, not billed', 'liability', 'grni')
ON CONFLICT DO NOTHING;
