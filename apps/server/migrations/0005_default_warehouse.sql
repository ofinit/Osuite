-- Every install starts with one warehouse so stock can be posted immediately.
INSERT INTO "stock_warehouse" ("name", "code") VALUES ('Main warehouse', 'MAIN') ON CONFLICT DO NOTHING;
