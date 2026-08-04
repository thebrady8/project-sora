import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'catalog.json');
const PUBLIC_CATALOG_PATH = path.join(ROOT, 'public', 'catalog-data.js');
const REPORT_DIR = path.join(ROOT, 'reports');
const ENDPOINT = 'https://query.wikidata.org/sparql';

export function normalizeTitle(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizePlatform(value = '') {
  const s = normalizeTitle(value);
  const aliases = new Map([
    ['ps5', 'playstation 5'], ['ps4', 'playstation 4'], ['ps3', 'playstation 3'],
    ['ps2', 'playstation 2'], ['ps1', 'playstation'], ['psp', 'playstation portable'],
    ['ps vita', 'playstation vita'], ['x360', 'xbox 360'], ['xbone', 'xbox one'],
    ['switch', 'nintendo switch'], ['wii u', 'nintendo wii u'], ['wii', 'nintendo wii'],
    ['nds', 'nintendo ds'], ['3ds', 'nintendo 3ds'], ['gba', 'game boy advance'],
    ['gbc', 'game boy color'], ['gb', 'game boy'], ['nes', 'nintendo entertainment system'],
    ['snes', 'super nintendo entertainment system'], ['n64', 'nintendo 64']
  ]);
  return aliases.get(s) || s;
}

export function isValidGtin(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.at(-1));
  let sum = 0;
  for (let i = body.length - 1, pos = 1; i >= 0; i--, pos++) {
    sum += Number(body[i]) * (pos % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

function buildQuery() {
  return `SELECT ?item ?itemLabel ?itemDescription ?gtin ?platformLabel WHERE {
    ?item wdt:P3962 ?gtin .
    OPTIONAL { ?item wdt:P400 ?platform . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
}

async function fetchWikidata() {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(buildQuery())}`;
  const response = await fetch(url, {
    headers: {
      'accept': 'application/sparql-results+json',
      'user-agent': 'ProjectSoraBarcodeImporter/1.0 (public beta catalog enrichment)'
    }
  });
  if (!response.ok) throw new Error(`Wikidata request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

function exactCandidates(catalog, title, platform) {
  const nt = normalizeTitle(title);
  const np = normalizePlatform(platform);
  return catalog.filter((game) => {
    if (normalizeTitle(game.name) !== nt) return false;
    if (!np) return true;
    const gp = normalizePlatform(game.platform);
    return gp === np || gp.includes(np) || np.includes(gp);
  });
}

function writeCatalog(catalog) {
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(PUBLIC_CATALOG_PATH, `export const GAME_CATALOG = ${JSON.stringify(catalog)};\n`);
}

export async function runImport() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const data = await fetchWikidata();
  const rows = data?.results?.bindings ?? [];
  const added = [];
  const ambiguous = [];
  const rejected = [];

  for (const row of rows) {
    const barcode = String(row.gtin?.value ?? '').replace(/\D/g, '');
    const title = row.itemLabel?.value ?? '';
    const platform = row.platformLabel?.value ?? '';
    const sourceId = row.item?.value ?? '';
    if (!isValidGtin(barcode)) {
      rejected.push({ barcode, title, platform, sourceId, reason: 'invalid GTIN checksum or length' });
      continue;
    }
    const candidates = exactCandidates(catalog, title, platform);
    if (candidates.length !== 1) {
      ambiguous.push({ barcode, title, platform, sourceId, candidateIds: candidates.map((g) => g.id) });
      continue;
    }
    const game = candidates[0];
    game.barcodes = Array.isArray(game.barcodes) ? game.barcodes : [];
    if (game.barcodes.some((entry) => (typeof entry === 'string' ? entry : entry.code) === barcode)) continue;
    game.barcodes.push({
      code: barcode,
      format: `GTIN-${barcode.length}`,
      platform: platform || game.platform,
      region: '',
      edition: '',
      source: 'Wikidata P3962',
      sourceId,
      verifiedAt: new Date().toISOString()
    });
    added.push({ gameId: game.id, gameName: game.name, platform: game.platform, barcode, sourceId });
  }

  writeCatalog(catalog);
  const summary = {
    source: 'Wikidata P3962 (CC0 structured data)',
    endpoint: ENDPOINT,
    retrievedAt: new Date().toISOString(),
    sourceRows: rows.length,
    verifiedBarcodesAdded: added.length,
    gamesMatched: new Set(added.map((x) => x.gameId)).size,
    ambiguous: ambiguous.length,
    rejected: rejected.length,
    matchingPolicy: 'Exact normalized title plus compatible platform; exactly one catalog candidate required.'
  };
  fs.writeFileSync(path.join(REPORT_DIR, 'open-barcode-import-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'open-barcode-import-added.json'), `${JSON.stringify(added, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'open-barcode-import-ambiguous.json'), `${JSON.stringify(ambiguous, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'open-barcode-import-rejected.json'), `${JSON.stringify(rejected, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runImport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
