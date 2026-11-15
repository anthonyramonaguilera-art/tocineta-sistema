-- Migración 0046: "DIOS" siempre en mayúscula en campos de texto configurables
UPDATE business_settings
SET slogan = REPLACE(slogan, 'Dios', 'DIOS')
WHERE slogan LIKE '%Dios%';

UPDATE business_settings
SET ticket_footer_message = REPLACE(ticket_footer_message, 'Dios', 'DIOS')
WHERE ticket_footer_message LIKE '%Dios%';

UPDATE business_settings
SET ticket_header_message = REPLACE(ticket_header_message, 'Dios', 'DIOS')
WHERE ticket_header_message LIKE '%Dios%';
