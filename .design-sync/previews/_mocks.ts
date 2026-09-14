// Shared realistic mock data for authored previews. Not itself a preview
// (no matching component name), just plain data other previews import.
// Shapes follow src/types/models.ts and services/repository.ts#PersonView.

export const evidencePrecise = [
  {
    id: 'ev-1', sourceId: 'S001', entityType: 'position', entityId: 'pos-1',
    fieldName: 'title', sourceUrl: 'https://www.parliament.lk/en/members-of-parliament/member/view/123',
    documentTitle: 'Members of Parliament — 10th Parliament', publishedAt: '2024-11',
    retrievedAt: '2026-08-20T09:00:00.000Z', locator: 'Member profile page',
    sourceRecordId: '123', contentHash: null, notes: null,
  },
];

export const evidenceInstitutionOnly = [
  {
    id: 'ev-2', sourceId: 'S002', entityType: 'position', entityId: 'pos-2',
    fieldName: 'title', sourceUrl: null, documentTitle: null, publishedAt: null,
    retrievedAt: '2026-07-01T00:00:00.000Z', locator: null,
    sourceRecordId: null, contentHash: null, notes: null,
  },
];

const claim = (state) => ({ verification: state, evidenceIds: [], verifiedAt: '2026-08-01T00:00:00.000Z' });

function person({ id, canonicalName, dateOfBirth = '1968-11-24', portrait = null, profession = 'Attorney-at-Law' }) {
  return {
    id, slug: id, canonicalName,
    names: { en: canonicalName, si: null, ta: null },
    aliases: [], dateOfBirth, dateOfDeath: null, gender: null, portrait,
    biography: null, profession,
    externalIds: { parliament: id },
    claim: claim('verified'),
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function position({ id, personId, title, roleType, institution = 'Parliament of Sri Lanka', ministry = null, startDate, endDate = null, endStatus = 'ongoing', precedence = 10 }) {
  return {
    id, personId, title, roleType, institution, ministry,
    districtId: 'colombo', constituency: null,
    startDate, endDate, currentAsOf: endDate ? null : '2026-08-28',
    endStatus, appointmentType: 'elected', precedence,
    claim: claim('verified'),
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** A sitting Cabinet Minister — the primary "everything present" sample. */
export const currentMinisterView = {
  person: person({ id: 'p-001', canonicalName: 'Anura Kumara Dissanayake' }),
  positions: [
    position({ id: 'pos-001', personId: 'p-001', title: 'President of the Democratic Socialist Republic of Sri Lanka', roleType: 'president', institution: 'Executive', startDate: '2024-09-23', precedence: 1 }),
    position({ id: 'pos-000', personId: 'p-001', title: 'Member of Parliament for Colombo District', roleType: 'member-of-parliament', startDate: '2000-10-10', precedence: 15 }),
  ],
  qualifications: [], education: [], examResults: [], employment: [], publicService: [], legalChallenges: [], events: [], affiliations: [],
  partyId: 'npp', districtId: 'colombo', partyLabel: 'National People’s Power', districtLabel: 'Colombo',
  headline: null, serving: true, status: 'current', statusId: 'serving',
  roleTypes: ['president', 'member-of-parliament'], verification: 'verified',
};
currentMinisterView.headline = currentMinisterView.positions[0];

/** A source-linked MP with a ministry portfolio — mid-confidence sample. */
export const cabinetMinisterView = {
  person: person({ id: 'p-002', canonicalName: 'Vijitha Herath', profession: 'Politician' }),
  positions: [
    position({ id: 'pos-002', personId: 'p-002', title: 'Minister of Foreign Affairs, Foreign Employment and Tourism', roleType: 'cabinet-minister', ministry: 'Ministry of Foreign Affairs', startDate: '2024-09-24', precedence: 5 }),
  ],
  qualifications: [], education: [], examResults: [], employment: [], publicService: [], legalChallenges: [], events: [], affiliations: [],
  partyId: 'npp', districtId: 'gampaha', partyLabel: 'National People’s Power', districtLabel: 'Gampaha',
  headline: null, serving: true, status: 'current', statusId: 'serving',
  roleTypes: ['cabinet-minister'], verification: 'source-linked',
};
cabinetMinisterView.headline = cabinetMinisterView.positions[0];

/** A former MP whose term has closed — exercises the "Former" / ended paths. */
export const formerMemberView = {
  person: person({ id: 'p-003', canonicalName: 'Ranil Wickremesinghe', dateOfBirth: '1949-03-24' }),
  positions: [
    position({ id: 'pos-003', personId: 'p-003', title: 'President of the Democratic Socialist Republic of Sri Lanka', roleType: 'president', institution: 'Executive', startDate: '2022-07-21', endDate: '2024-09-23', endStatus: 'dated', precedence: 1 }),
  ],
  qualifications: [], education: [], examResults: [], employment: [], publicService: [], legalChallenges: [], events: [], affiliations: [],
  partyId: 'uxp', districtId: 'colombo', partyLabel: 'United National Party', districtLabel: 'Colombo',
  headline: null, serving: false, status: 'former', statusId: 'former',
  roleTypes: ['president'], verification: 'secondary-corroborated',
};
formerMemberView.headline = formerMemberView.positions[0];

export const searchResultViews = [currentMinisterView, cabinetMinisterView, formerMemberView];

export const filterOptions = {
  parties: [
    { id: 'npp', name: 'National People’s Power', count: 159 },
    { id: 'sjb', name: 'Samagi Jana Balawegaya', count: 88 },
    { id: 'uxp', name: 'United National Party', count: 12 },
  ],
  districts: [
    { id: 'colombo', name: 'Colombo', count: 19 },
    { id: 'gampaha', name: 'Gampaha', count: 18 },
    { id: 'kandy', name: 'Kandy', count: 12 },
  ],
  roles: [
    { id: 'member-of-parliament', name: 'Member of Parliament', count: 225 },
    { id: 'cabinet-minister', name: 'Cabinet Minister', count: 26 },
  ],
  statuses: [
    { id: 'current', name: 'Current', count: 225 },
    { id: 'former', name: 'Former', count: 612 },
  ],
  verification: [
    { id: 'verified', name: 'Verified', count: 480 },
    { id: 'source-linked', name: 'Source-linked', count: 210 },
  ],
};

export const activeFacets = { parties: ['npp'], districts: [], roles: ['cabinet-minister'], statuses: [], verification: [] };
export const emptyFacets = { parties: [], districts: [], roles: [], statuses: [], verification: [] };

export const verificationStates = [
  'demonstration', 'unverified', 'source-linked', 'verified',
  'secondary-corroborated', 'conflicting', 'pending-review', 'unavailable',
];
