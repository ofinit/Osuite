-- Year-end closing moves each year's profit here.
INSERT INTO "account_account" ("code", "name", "type", "key") VALUES ('3200', 'Reserves & surplus', 'equity', 'retained_earnings')
ON CONFLICT DO NOTHING;
