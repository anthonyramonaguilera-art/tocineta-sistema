-- ============================================================================
-- HITO M20: SESIONES PERSISTENTES, STAFF Y MATRIZ DE PERMISOS
-- ============================================================================

-- 1. Campos de auto-registro y credenciales extendidas para trabajadores
ALTER TABLE users ADD COLUMN cedula TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]';

-- 2. Asegurar que los usuarios iniciales del seed queden como APPROVED y con permisos vacíos válidos
UPDATE users SET approval_status = 'APPROVED' WHERE approval_status IS NULL;
UPDATE users SET permissions_json = '[]' WHERE permissions_json IS NULL;

-- 3. Índices para búsqueda rápida por cédula y estado de aprobación
CREATE INDEX IF NOT EXISTS idx_users_cedula ON users(cedula);
CREATE INDEX IF NOT EXISTS idx_users_approval_status ON users(approval_status);
