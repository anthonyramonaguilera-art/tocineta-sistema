ALTER TABLE business_settings ADD COLUMN print_delivery_note INTEGER NOT NULL DEFAULT 1 CHECK (print_delivery_note IN (0,1));
ALTER TABLE business_settings ADD COLUMN print_flow TEXT NOT NULL DEFAULT 'manual' CHECK (print_flow IN ('manual','auto'));
