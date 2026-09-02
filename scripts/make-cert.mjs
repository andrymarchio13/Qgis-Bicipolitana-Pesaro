/**
 * Genera i certificati per il dev server HTTPS.
 *
 * Crea due cose:
 *   1. una CA locale (certs/rootCA.crt) — da installare una volta sola fra le
 *      autorità attendibili con `npm run cert:trust`;
 *   2. il certificato del server (certs/dev.crt), firmato da quella CA.
 *
 * Serve una CA e non un certificato singolo self-signed perché i browser basati
 * su Chromium rifiutano un certificato foglia anche se importato fra le radici.
 *
 * I SAN includono localhost e gli IP di rete locale rilevati al momento della
 * generazione, così il sito è raggiungibile in HTTPS anche da telefono con
 * `npm run dev:lan` (la geolocalizzazione richiede un contesto sicuro).
 *
 * Richiede `openssl` nel PATH (incluso in Git for Windows).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const certDir = join(root, 'certs');
const f = (name) => join(certDir, name);
const openssl = (...args) => execFileSync('openssl', args, { stdio: 'inherit' });

const force = process.argv.includes('--force');
if (existsSync(f('dev.crt')) && existsSync(f('rootCA.crt')) && !force) {
  console.log('Certificati già presenti in certs/. Usa `npm run cert -- --force` per rigenerarli.');
  process.exit(0);
}

const ips = ['127.0.0.1', '::1'];
for (const addrs of Object.values(networkInterfaces())) {
  for (const addr of addrs ?? []) {
    if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
  }
}

mkdirSync(certDir, { recursive: true });

// --- 1. CA locale -----------------------------------------------------------
// Rigenerarla invalida quella già installata fra le radici: si rifà `cert:trust`.
writeFileSync(
  f('ca.cnf'),
  `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no

[dn]
CN = Bicipolitana Pesaro Local CA
O = Sviluppo locale

[ext]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
`,
);
openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
  '-keyout', f('rootCA.key'), '-out', f('rootCA.crt'), '-config', f('ca.cnf'));

// --- 2. Certificato del server, firmato dalla CA ----------------------------
writeFileSync(
  f('dev.cnf'),
  `[req]
distinguished_name = dn
prompt = no

[dn]
CN = localhost

[ext]
subjectAltName = @alt
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt]
DNS.1 = localhost
${ips.map((ip, i) => `IP.${i + 1} = ${ip}`).join('\n')}
`,
);
openssl('req', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', f('dev.key'), '-out', f('dev.csr'), '-config', f('dev.cnf'));
// 825 giorni: limite massimo accettato dai browser per un certificato server.
openssl('x509', '-req', '-in', f('dev.csr'), '-days', '825',
  '-CA', f('rootCA.crt'), '-CAkey', f('rootCA.key'), '-CAcreateserial',
  '-out', f('dev.crt'), '-extfile', f('dev.cnf'), '-extensions', 'ext');

console.log(`\nCertificato creato per: localhost, ${ips.join(', ')}`);
console.log('Ora esegui `npm run cert:trust` per installare la CA locale.');
