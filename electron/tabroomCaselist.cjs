const normalize = (value) => typeof value === 'string'
  ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
const id = (value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0
  ? String(Number(value)) : '';
function sameRoster(left, right) {
  if (!left.length || left.length !== right.length || !left.every(Boolean) || !right.every(Boolean)) return false;
  const sorted = [...right].sort();
  return new Set(left).size === left.length && [...left].sort().every((value, i) => value === sorted[i]);
}

function teamCodes(team) {
  const codes = new Set([normalize(team.code), normalize(team.name)].filter(Boolean));
  for (const value of [...codes]) {
    for (const prefix of [normalize(team.school), normalize(team.schoolCode)].filter(Boolean)) {
      if (value.startsWith(prefix + ' ')) codes.add(value.slice(prefix.length + 1));
    }
  }
  return codes;
}

async function resolveCaselistTeam({ caselist, team, list }) {
  if (typeof caselist !== 'string' || !caselist.trim() || caselist.length > 255 ||
    !team || typeof team !== 'object' || Array.isArray(team) ||
    (team.students !== undefined && (!Array.isArray(team.students) ||
      team.students.some((student) => !student || typeof student !== 'object' || Array.isArray(student)))))
    throw new Error('Invalid Tabroom team matching request.');
  const result = (status, reason, candidates = []) => ({ status, reason, candidates });
  if (typeof team.code === 'string' && team.code.trim().toUpperCase() === 'TBA')
    return result('insufficient-data', 'placeholder-team');
  if (team.hybrid) return result('insufficient-data', 'hybrid-team');
  const chapter = id(team.chapter);
  const schoolNames = [normalize(team.school), normalize(team.schoolCode)].filter(Boolean);
  if (!chapter && !schoolNames.length) return result('insufficient-data', 'school-identity-missing');
  if (!teamCodes(team).size && !team.students?.length) return result('insufficient-data', 'team-identity-missing');
  const caselists = await list('caselists');
  if (!caselists.some((item) => item.name === caselist)) throw new Error('Select an existing OpenCaselist season.');
  const schools = await list('schools', { caselist });
  const linkedSchools = chapter ? schools.filter((school) => id(school.chapter_id) === chapter) : [];
  const candidates = linkedSchools.length ? linkedSchools : schools.filter((school) => {
    if (chapter && id(school.chapter_id) && id(school.chapter_id) !== chapter) return false;
    return [normalize(school.name), normalize(school.display_name)].some((name) => name && schoolNames.includes(name));
  });
  if (!candidates.length) return result('unmatched', 'school-not-found');
  if (candidates.length > 1) return result('ambiguous', 'multiple-schools');
  const school = candidates[0];
  const teams = await list('teams', { caselist, school: school.name });
  const students = team.students || [];
  const studentIds = students.map((student) => id(student.id));
  const studentNames = students.map((student) => student.first && student.last
    ? normalize(`${student.first} ${student.last}`) : '');
  const codes = teamCodes(team);
  const matches = teams.flatMap((candidate) => {
    const roster = [1, 2, 3, 4].map((i) => ({
      id: id(candidate[`debater${i}_student_id`]),
      last: normalize(candidate[`debater${i}_last`]),
      name: candidate[`debater${i}_first`] && candidate[`debater${i}_last`]
        ? normalize(`${candidate[`debater${i}_first`]} ${candidate[`debater${i}_last`]}`) : '',
    })).filter((student) => student.id || student.name);
    const linked = sameRoster(studentIds, roster.map((student) => student.id));
    // Known, conflicting student IDs must not be overridden by reused team initials.
    if (studentIds.length && studentIds.every(Boolean) && roster.length &&
      roster.every((student) => student.id) && !linked) return [];
    const names = sameRoster(studentNames, roster.map((student) => student.name));
    // Tabroom often uses single surname initials; wiki slugs use two letters per surname.
    // Compare initials from real rosters, never manufacture a wiki URL from a tournament code.
    const initials = roster.length >= 2 && roster.every((student) => student.last)
      ? roster.map((student) => student.last[0]).join('') : '';
    const code = [normalize(candidate.name), normalize(candidate.display_name), initials,
      roster.length === 2 ? [...initials].reverse().join('') : '']
      .some((name) => name && codes.has(name));
    if (!linked && !names && !code) return [];
    return [{
      selection: { caselist, school: school.name, team: candidate.name },
      evidence: linked ? 'student-ids' : names ? 'student-names' : 'team-code',
      verified: linked && linkedSchools.length === 1,
    }];
  });
  const verified = matches.filter((candidate) => candidate.verified);
  if (verified.length === 1) return result('matched', 'chapter-and-student-ids', verified);
  if (verified.length > 1) return result('ambiguous', 'multiple-identity-matches', verified);
  if (!matches.length) return result('unmatched', 'team-not-found');
  return result(matches.length === 1 ? 'candidate' : 'ambiguous', 'confirmation-required', matches);
}

module.exports = { resolveCaselistTeam };
