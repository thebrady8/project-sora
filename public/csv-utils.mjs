function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeStatusValue(value) {
  const candidate = String(value || '').trim();
  const statuses = ['Backlog', 'Playing', 'Paused', 'Completed', 'Dropped'];
  return statuses.includes(candidate) ? candidate : 'Backlog';
}

export function parseCsvGames(csvText) {
  const trimmed = String(csvText || '').trim();
  if (!trimmed) {
    return [];
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const titleIndex = headers.indexOf('title');
  const platformIndex = headers.indexOf('platform');
  const conditionIndex = headers.indexOf('condition');
  const purchasePriceIndex = headers.indexOf('purchase price');
  const currentValueIndex = headers.indexOf('current value');
  const metacriticScoreIndex = headers.indexOf('metacritic score');
  const notesIndex = headers.indexOf('notes');
  const statusIndex = headers.indexOf('status');
  const completedAtIndex = headers.indexOf('completed at');

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const title = values[titleIndex] || values[0] || '';
    const platform = values[platformIndex] || values[1] || '';
    const condition = values[conditionIndex] || values[2] || 'Good';
    const purchasePrice = values[purchasePriceIndex] || values[3] || '0';
    const currentValue = values[currentValueIndex] || values[4] || '0';
    const metacriticScore = values[metacriticScoreIndex] || values[5] || '0';
    const notes = values[notesIndex] || values[6] || '';
    const status = statusIndex >= 0 ? values[statusIndex] : 'Backlog';
    const completedAt = completedAtIndex >= 0 ? values[completedAtIndex] : '';

    return {
      title: String(title || '').trim(),
      platform: String(platform || '').trim(),
      condition: String(condition || 'Good').trim() || 'Good',
      purchasePrice: Number(purchasePrice || 0),
      currentValue: Number(currentValue || 0),
      metacriticScore: Number(metacriticScore || 0),
      notes: String(notes || '').trim(),
      status: normalizeStatusValue(status),
      completedAt: status === 'Completed' && completedAt ? String(completedAt) : null,
      comments: []
    };
  }).filter((game) => game.title);
}

function formatCsvCell(value) {
  const text = String(value ?? '');
  if (!text) {
    return '';
  }

  if (/[",\n]/.test(text) || text.startsWith(' ') || text.endsWith(' ')) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function serializeLibraryCsv(games) {
  const rows = [
    ['Title', 'Platform', 'Condition', 'Purchase Price', 'Current Value', 'Metacritic Score', 'Notes', 'Status', 'Completed At'],
    ...games.map((game) => [
      game.title,
      game.platform,
      game.condition,
      game.purchasePrice,
      game.currentValue,
      game.metacriticScore ?? '',
      game.notes,
      game.status || 'Backlog',
      game.status === 'Completed' ? (game.completedAt || '') : ''
    ])
  ];

  return rows.map((row) => row.map(formatCsvCell).join(',')).join('\n');
}
