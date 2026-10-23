const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = path.resolve(__dirname, "../../data/tocineta.db");
const localDbPath = path.resolve(__dirname, "./data/tocineta.db");
const targetDb = fs.existsSync(dbPath) ? dbPath : (fs.existsSync(localDbPath) ? localDbPath : "./data/tocineta.db");

console.log("Conectando a base de datos:", targetDb);
const db = new Database(targetDb);
db.prepare(`
  UPDATE printers SET name = 'DP58U-03', connection_type = 'SPOOLER_RAW_USB', address = 'DP58U-03' WHERE id = 'print_caja_usb';
`).run();
db.prepare(`
  UPDATE printers SET name = 'MP583', connection_type = 'SPOOLER_RAW_USB', address = 'MP583' WHERE id = 'print_cocina';
`).run();
console.log("Impresoras actualizadas en la BD:");
const rows = db.prepare("SELECT id, name, connection_type, address FROM printers").all();
console.log(rows);
db.close();
