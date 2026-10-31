const text = (value) => typeof value === 'string' ? value.trim() : '';
const identifier = (value) => (typeof value === 'string' || Number.isSafeInteger(value)) && String(value).trim()
  ? String(value).trim() : '';
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0
  ? String(Number(value)) : '';

function normalizeSnapshot(data) {
  const warnings = new Set();
  const placeholderTeams = new Set();
  const collections = Object.fromEntries(['schools', 'events', 'judges', 'teams']
    .map((kind) => [kind, { available: false, rows: [] }]));
  const maps = Object.fromEntries(Object.keys(collections).map((kind) => [kind, new Map()]));
  const items = (parent, key, collection) => {
    if (parent[key] == null) return [];
    if (!Array.isArray(parent[key])) {
      warnings.add(key);
      return [];
    }
    if (collection) collections[collection].available = true;
    if (parent[key].some((item) => !record(item))) warnings.add(key);
    return parent[key].filter(record);
  };
  const add = (kind, row) => {
    const key = row.id ? `id:${row.id}` : `row:${maps[kind].size}`;
    const previous = maps[kind].get(key);
    if (previous) {
      for (const [key, value] of Object.entries(row)) {
        if (!previous[key] || (Array.isArray(previous[key]) && !previous[key].length)) previous[key] = value;
      }
      if (kind === 'judges') previous.categories = [...new Set([...previous.categories, ...row.categories])];
      return previous;
    }
    maps[kind].set(key, row);
    return row;
  };
  const schoolRecords = items(data, 'schools', 'schools');
  for (const school of schoolRecords) add('schools', {
    id: identifier(school.id), name: text(school.name), code: text(school.code),
    chapter: identifier(school.chapter), state: text(school.state),
  });
  const findSchool = (id) => maps.schools.get(`id:${identifier(id)}`);
  const studentsFor = (entry, school) => {
    if (entry.students == null) return [];
    if (!Array.isArray(entry.students)) {
      warnings.add('students');
      return [];
    }
    return entry.students.map((student) => {
      if (!record(student)) student = (Array.isArray(school?.students) ? school.students : []).find((item) => record(item) &&
        identifier(item.id) && identifier(item.id) === identifier(student)) || { id: student };
      const id = identifier(student.id);
      return {
        id, first: text(student.first), last: text(student.last),
        recordUrl: positiveId(id) ? `https://www.tabroom.com/index/results/team_lifetime_record.mhtml?id1=${positiveId(id)}` : ''
      };
    });
  };
  const addTeam = (entry, event, school) => {
    if (text(entry.code).toUpperCase() === 'TBA') {
      if (identifier(entry.id)) placeholderTeams.add(identifier(entry.id));
      return;
    }
    const schoolId = identifier(entry.school) || identifier(school?.id);
    const info = findSchool(schoolId);
    const sourceSchool = school || schoolRecords.find((item) => identifier(item.id) === schoolId);
    add('teams', {
      id: identifier(entry.id), name: text(entry.name), code: text(entry.code),
      recordUrl: positiveId(data.id) && positiveId(entry.id)
        ? `https://www.tabroom.com/index/tourn/postings/entry_record.mhtml?tourn_id=${positiveId(data.id)}&entry_id=${positiveId(entry.id)}` : '',
      eventId: identifier(entry.event) || event?.id || '', event: event?.name || '',
      schoolId, school: info?.name || '', schoolCode: info?.code || '',
      chapter: identifier(entry.chapter) || info?.chapter || '',
      hybrid: identifier(entry.hybrid), students: studentsFor(entry, sourceSchool),
    });
  };
  const addJudge = (judge, category, school) => {
    const schoolId = identifier(judge.school) || identifier(school?.id);
    add('judges', {
      id: identifier(judge.id), personId: identifier(judge.person),
      name: [text(judge.first), text(judge.middle), text(judge.last)].filter(Boolean).join(' '),
      code: text(judge.code), schoolId, school: findSchool(schoolId)?.name || '',
      categories: category ? [text(category.name) || text(category.abbr)].filter(Boolean) : [],
    });
  };
  const addEvent = (event) => {
    const row = add('events', {
      id: identifier(event.id), name: text(event.name), code: text(event.abbr), type: text(event.type),
    });
    for (const entry of items(event, 'entries', 'teams')) addTeam(entry, row);
  };
  for (const event of items(data, 'events', 'events')) addEvent(event);
  for (const judge of items(data, 'judges', 'judges')) addJudge(judge);
  for (const category of items(data, 'categories')) {
    for (const event of items(category, 'events', 'events')) addEvent(event);
    for (const judge of items(category, 'judges', 'judges')) addJudge(judge, category);
  }
  for (const school of schoolRecords) {
    for (const entry of items(school, 'entries', 'teams')) {
      addTeam(entry, maps.events.get(`id:${identifier(entry.event)}`), school);
    }
    for (const judge of items(school, 'judges', 'judges')) addJudge(judge, null, school);
  }
  for (const [kind, map] of Object.entries(maps)) collections[kind].rows = [...map.values()]
    .filter((row) => kind !== 'teams' || !placeholderTeams.has(row.id));
  return {
    metadata: {
      location: [text(data.city), text(data.state), text(data.country)].filter(Boolean).join(', '),
      timezone: text(data.timezone), backupCreated: text(data.backup_created),
    },
    warnings: [...warnings],
    collections,
  };
}

function snapshotRecords(snapshot, kind, page = 0, query = '') {
  if (typeof kind !== 'string' || !Object.hasOwn(snapshot.collections, kind)) throw new Error('Invalid Tabroom data section.');
  if (!Number.isSafeInteger(page) || page < 0 || typeof query !== 'string' || query.length > 200)
    throw new Error('Invalid Tabroom table request.');
  const collection = snapshot.collections[kind];
  const search = query.trim().toLocaleLowerCase();
  const rows = search ? collection.rows.filter((row) =>
    [row.id, row.name, row.code, row.school, row.schoolCode, row.event, ...(row.categories || [])]
      .some((value) => value?.toLocaleLowerCase().includes(search))) : collection.rows;
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  if (page >= pages) throw new Error('Invalid Tabroom table page.');
  return { available: collection.available, total: rows.length, pages, page, rows: rows.slice(page * 50, (page + 1) * 50) };
}

module.exports = { normalizeSnapshot, snapshotRecords };
