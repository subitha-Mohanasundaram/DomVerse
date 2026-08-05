/**
 * One-time migration: hash all plaintext passwords in store.json using bcryptjs.
 * Run: node backend/migrate-passwords.js
 */
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "data", "store.json");
const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8").replace(/^\uFEFF/, ""));

let changed = 0;

store.students = store.students.map((s) => {
  if (!s.password.startsWith("$2")) {
    console.log(`  Hashing student: ${s.userId}`);
    s.password = bcrypt.hashSync(s.password, 10);
    changed++;
  }
  return s;
});

store.admins = store.admins.map((a) => {
  if (!a.password.startsWith("$2")) {
    console.log(`  Hashing admin: ${a.userId}`);
    a.password = bcrypt.hashSync(a.password, 10);
    changed++;
  }
  return a;
});

fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
console.log(`\nDone — ${changed} password(s) hashed.`);
