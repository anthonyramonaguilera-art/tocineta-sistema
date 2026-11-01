-- 0038_r2_perf_indexes.sql (M17a / SEV-209)
-- Solo índices. Reversible con DROP INDEX. Columnas verificadas en el esquema:
-- orders.created_at_ms, orders.cash_session_id, orders.location_id.
CREATE INDEX IF NOT EXISTS idx_orders_created_at_ms ON orders(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_orders_cash_session_id ON orders(cash_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_location_id ON orders(location_id);
