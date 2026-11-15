-- Migración 0044: Añadir columna payment_method a la tabla purchases
ALTER TABLE purchases ADD COLUMN payment_method TEXT;
CREATE INDEX IF NOT EXISTS idx_purchases_payment_method ON purchases(payment_method);
