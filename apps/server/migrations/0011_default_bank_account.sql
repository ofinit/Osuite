-- Every install starts with one bank account booked to the seeded Bank account (1200).
INSERT INTO "account_bank_account" ("name", "ledger_account_id")
SELECT 'Main bank account', "id" FROM "account_account" WHERE "key" = 'bank'
ON CONFLICT DO NOTHING;
