export const GAME_CATALOG = [
  {
    name: 'The Legend of Zelda: Breath of the Wild',
    platform: 'Nintendo Switch',
    price: 49.99,
    metacriticScore: 97,
    image: 'https://upload.wikimedia.org/wikipedia/en/c/c6/The_Legend_of_Zelda_Breath_of_the_Wild.jpg',
    description: 'A beloved open-world adventure with a strong collector demand.',
    developer: 'Nintendo',
    tags: ['Adventure', 'Open World', 'Nintendo']
  },
  {
    name: 'Cyberpunk 2077',
    platform: 'PC / PlayStation / Xbox',
    price: 39.99,
    metacriticScore: 86,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1091500/header.jpg',
    description: 'A futuristic RPG with broad platform support and shifting value.',
    developer: 'CD PROJEKT RED',
    tags: ['RPG', 'Sci-Fi', 'Cyberpunk']
  },
  {
    name: 'Spider-Man 2',
    platform: 'PlayStation 5',
    price: 69.99,
    metacriticScore: 90,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1544020/header.jpg',
    description: 'High-demand PS5 action title with strong resale interest.',
    developer: 'Insomniac Games',
    tags: ['Action', 'Superhero', 'Open World']
  },
  {
    name: 'Final Fantasy VII Rebirth',
    platform: 'PlayStation 5',
    price: 59.99,
    metacriticScore: 93,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/2507950/header.jpg',
    description: 'A premium RPG title that remains popular with collectors.',
    developer: 'Square Enix',
    tags: ['RPG', 'Fantasy', 'Story-rich']
  },
  {
    name: 'Mario Kart 8 Deluxe',
    platform: 'Nintendo Switch',
    price: 44.99,
    metacriticScore: 92,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1363080/header.jpg',
    description: 'A long-running Switch favorite with steady value.',
    developer: 'Nintendo',
    tags: ['Racing', 'Family', 'Nintendo']
  },
  {
    name: 'Elden Ring',
    platform: 'PC / PlayStation / Xbox',
    price: 54.99,
    metacriticScore: 95,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1245620/header.jpg',
    description: 'A major fantasy release with strong critical and collector appeal.',
    developer: 'FromSoftware',
    tags: ['RPG', 'Fantasy', 'Soulslike']
  }
];

export const PREMIUM_RELEASE_FALLBACK = [
  {
    title: 'The Witcher 4',
    release: '2026-10-01',
    genre: 'Action RPG',
    platform: 'PC / Console',
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1245620/header.jpg',
    blurb: 'A cinematic fantasy reboot with a polished open-world focus and a strong follow-up audience.'
  },
  {
    title: 'Resident Evil Requiem',
    release: '2026-08-15',
    genre: 'Survival Horror',
    platform: 'PC / Console',
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1544020/header.jpg',
    blurb: 'A tense survival-horror entry built around atmosphere, tension, and collector anticipation.'
  },
  {
    title: 'Dragon Age: Dreadwolf',
    release: '2027-01-15',
    genre: 'RPG',
    platform: 'PC / Console',
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/2507950/header.jpg',
    blurb: 'A returning franchise installment with a highly anticipated launch and massive RPG fanbase.'
  },
  {
    title: 'Hades II',
    release: '2026-09-05',
    genre: 'Action Roguelike',
    platform: 'PC',
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1145350/header.jpg',
    blurb: 'A fast, stylish follow-up with excellent replay value and broad reach among action fans.'
  }
];

export function normalizeReleaseEntry(entry) {
  const item = entry || {};
  return {
    title: String(item.title || item.name || 'Upcoming release').trim(),
    release: String(item.release || item.release_date || item.date || 'Upcoming').trim() || 'Upcoming',
    genre: String(item.genre || item.category || 'Game').trim() || 'Game',
    platform: String(item.platform || 'PC / Console').trim() || 'PC / Console',
    image: String(item.image || item.header_image || '').trim(),
    blurb: String(item.blurb || item.description || item.short_description || item.title || 'Featured release').trim()
  };
}

export function parseReleaseDate(dateText) {
  const raw = String(dateText || '').trim();
  if (!raw || /coming soon|tba|upcoming/i.test(raw)) {
    return Number.MAX_SAFE_INTEGER;
  }

  const explicitMatch = /^([A-Za-z]+)\s+(\d{4})$/i.exec(raw);
  if (explicitMatch) {
    const seasonMap = {
      winter: 0,
      spring: 2,
      summer: 5,
      autumn: 8,
      fall: 8,
      late: 9
    };
    const season = (explicitMatch[1] || '').toLowerCase();
    const year = Number(explicitMatch[2]);
    const month = seasonMap[season] ?? 0;
    return Date.UTC(year, month, 1);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return Number.MAX_SAFE_INTEGER;
  }

  return parsed.getTime();
}

export function sortReleaseDataChronologically(items) {
  return [...items].sort((left, right) => {
    const leftTime = parseReleaseDate(left?.release);
    const rightTime = parseReleaseDate(right?.release);
    return leftTime - rightTime;
  });
}

export function mergeReleaseCalendar(liveItems = [], fallbackItems = PREMIUM_RELEASE_FALLBACK) {
  const merged = new Map();

  fallbackItems.forEach((item) => {
    const normalized = normalizeReleaseEntry(item);
    merged.set(normalized.title, normalized);
  });

  liveItems.forEach((item) => {
    const normalized = normalizeReleaseEntry(item);
    if (!normalized.title) {
      return;
    }

    if (!merged.has(normalized.title)) {
      merged.set(normalized.title, normalized);
    } else {
      merged.set(normalized.title, {
        ...merged.get(normalized.title),
        ...normalized,
        release: normalized.release || merged.get(normalized.title).release
      });
    }
  });

  return sortReleaseDataChronologically([...merged.values()]);
}
