/**
 * British Columbia local governments for place tagging (places.ts).
 *
 * Source: BC Data Catalogue, Administrative Boundaries Management System (Ministry of Housing and Municipal
 * Affairs), layers WHSE_LEGAL_ADMIN_BOUNDARIES.ABMS_MUNICIPALITIES_SP (160 municipalities, each with its
 * ADMIN_AREA_GROUP_NAME = regional district) and ABMS_REGIONAL_DISTRICTS_SP (27 regional districts), read
 * through openmaps.gov.bc.ca WFS on 2026-10-03. Northern Rockies Regional Municipality belongs to no regional
 * district. The old sbcontest2 city.csv was not used as data: it mixes BC places with Ontario and US cities.
 * Communities and aliases below are hand-picked; each maps to the local government that contains it.
 */

export interface RegionalDistrict {
  id: string;
  name: string;
  /** Names used with "Regional District of X", "X Regional District" or "X RD". */
  cores: string[];
  /** Names that mean this regional district on their own (never a municipality or a broader region). */
  bare?: string[];
  /** Upper-case acronyms matched case-sensitively; ambiguous ones (CRD, CVRD, SRD) are left out on purpose. */
  acronyms?: string[];
}

export const REGIONAL_DISTRICTS: readonly RegionalDistrict[] = [
  { id: 'alberni-clayoquot', name: 'Regional District of Alberni-Clayoquot', cores: ['Alberni-Clayoquot'], bare: ['Alberni-Clayoquot'], acronyms: ['ACRD'] },
  { id: 'bulkley-nechako', name: 'Regional District of Bulkley-Nechako', cores: ['Bulkley-Nechako'], bare: ['Bulkley-Nechako'], acronyms: ['RDBN'] },
  { id: 'capital', name: 'Capital Regional District', cores: ['Capital'], bare: ['Greater Victoria'] },
  { id: 'cariboo', name: 'Cariboo Regional District', cores: ['Cariboo'] },
  { id: 'central-coast', name: 'Central Coast Regional District', cores: ['Central Coast'], acronyms: ['CCRD'] },
  { id: 'central-kootenay', name: 'Regional District of Central Kootenay', cores: ['Central Kootenay'], bare: ['Central Kootenay'], acronyms: ['RDCK'] },
  { id: 'central-okanagan', name: 'Regional District of Central Okanagan', cores: ['Central Okanagan'], bare: ['Central Okanagan'], acronyms: ['RDCO'] },
  { id: 'columbia-shuswap', name: 'Columbia Shuswap Regional District', cores: ['Columbia Shuswap', 'Columbia-Shuswap'], bare: ['Columbia Shuswap', 'Columbia-Shuswap'], acronyms: ['CSRD'] },
  { id: 'comox-valley', name: 'Comox Valley Regional District', cores: ['Comox Valley'], bare: ['Comox Valley'] },
  { id: 'cowichan-valley', name: 'Cowichan Valley Regional District', cores: ['Cowichan Valley'], bare: ['Cowichan Valley'] },
  { id: 'east-kootenay', name: 'Regional District of East Kootenay', cores: ['East Kootenay'], bare: ['East Kootenay'], acronyms: ['RDEK'] },
  { id: 'fraser-fort-george', name: 'Regional District of Fraser-Fort George', cores: ['Fraser-Fort George'], bare: ['Fraser-Fort George'], acronyms: ['RDFFG'] },
  // "Fraser Valley" alone also covers Langley (Metro Vancouver), so only the district's own name counts.
  { id: 'fraser-valley', name: 'Fraser Valley Regional District', cores: ['Fraser Valley'], acronyms: ['FVRD'] },
  { id: 'kitimat-stikine', name: 'Regional District of Kitimat-Stikine', cores: ['Kitimat-Stikine'], bare: ['Kitimat-Stikine'], acronyms: ['RDKS'] },
  { id: 'kootenay-boundary', name: 'Regional District of Kootenay Boundary', cores: ['Kootenay Boundary'], bare: ['Kootenay Boundary'], acronyms: ['RDKB'] },
  { id: 'metro-vancouver', name: 'Metro Vancouver Regional District', cores: ['Metro Vancouver', 'Greater Vancouver'], bare: ['Metro Vancouver', 'Greater Vancouver'], acronyms: ['MVRD', 'GVRD'] },
  { id: 'mount-waddington', name: 'Regional District of Mount Waddington', cores: ['Mount Waddington'], bare: ['Mount Waddington'], acronyms: ['RDMW'] },
  { id: 'nanaimo', name: 'Regional District of Nanaimo', cores: ['Nanaimo'], acronyms: ['RDN'] },
  { id: 'north-coast', name: 'North Coast Regional District', cores: ['North Coast', 'Skeena-Queen Charlotte'], bare: ['Haida Gwaii'], acronyms: ['NCRD'] },
  { id: 'north-okanagan', name: 'Regional District of North Okanagan', cores: ['North Okanagan'], bare: ['North Okanagan'], acronyms: ['RDNO'] },
  { id: 'okanagan-similkameen', name: 'Regional District of Okanagan-Similkameen', cores: ['Okanagan-Similkameen'], bare: ['Okanagan-Similkameen'], acronyms: ['RDOS'] },
  { id: 'peace-river', name: 'Peace River Regional District', cores: ['Peace River'], acronyms: ['PRRD'] },
  { id: 'qathet', name: 'qathet Regional District', cores: ['qathet', 'Powell River'], bare: ['qathet'] },
  { id: 'squamish-lillooet', name: 'Squamish-Lillooet Regional District', cores: ['Squamish-Lillooet'], bare: ['Squamish-Lillooet'], acronyms: ['SLRD'] },
  { id: 'strathcona', name: 'Strathcona Regional District', cores: ['Strathcona'] },
  { id: 'sunshine-coast', name: 'Sunshine Coast Regional District', cores: ['Sunshine Coast'], bare: ['Sunshine Coast'], acronyms: ['SCRD'] },
  { id: 'thompson-nicola', name: 'Thompson-Nicola Regional District', cores: ['Thompson-Nicola'], bare: ['Thompson-Nicola'], acronyms: ['TNRD'] },
];

/** [short name, regional district id (null: none), legal name]. Short names are what the UI and `region` show. */
export const MUNICIPALITIES: readonly (readonly [string, string | null, string])[] = [
  ["100 Mile House", "cariboo", "District of 100 Mile House"],
  ["Abbotsford", "fraser-valley", "City of Abbotsford"],
  ["Alert Bay", "mount-waddington", "The Corporation of the Village of Alert Bay"],
  ["Anmore", "metro-vancouver", "Village of Anmore"],
  ["Armstrong", "north-okanagan", "City of Armstrong"],
  ["Ashcroft", "thompson-nicola", "The Corporation of the Village of Ashcroft"],
  ["Barriere", "thompson-nicola", "District of Barriere"],
  ["Belcarra", "metro-vancouver", "Village of Belcarra"],
  ["Bowen Island", "metro-vancouver", "Bowen Island Municipality"],
  ["Burnaby", "metro-vancouver", "City of Burnaby"],
  ["Burns Lake", "bulkley-nechako", "The Corporation of the Village of Burns Lake"],
  ["Cache Creek", "thompson-nicola", "Village of Cache Creek"],
  ["Campbell River", "strathcona", "City of Campbell River"],
  ["Canal Flats", "east-kootenay", "Village of Canal Flats"],
  ["Castlegar", "central-kootenay", "City of Castlegar"],
  ["Central Saanich", "capital", "The Corporation of the District of Central Saanich"],
  ["Chase", "thompson-nicola", "Village of Chase"],
  ["Chetwynd", "peace-river", "District of Chetwynd"],
  ["Chilliwack", "fraser-valley", "City of Chilliwack"],
  ["Clearwater", "thompson-nicola", "District of Clearwater"],
  ["Clinton", "thompson-nicola", "Village of Clinton"],
  ["Coldstream", "north-okanagan", "The Corporation of the District of Coldstream"],
  ["Colwood", "capital", "City of Colwood"],
  ["Comox", "comox-valley", "Town of Comox"],
  ["Coquitlam", "metro-vancouver", "City of Coquitlam"],
  ["Courtenay", "comox-valley", "The Corporation of the City of Courtenay"],
  ["Cranbrook", "east-kootenay", "The Corporation of the City of Cranbrook"],
  ["Creston", "central-kootenay", "Town of Creston"],
  ["Cumberland", "comox-valley", "Village of Cumberland"],
  ["Daajing Giids", "north-coast", "Village of Daajing Giids"],
  ["Dawson Creek", "peace-river", "The Corporation of the City of Dawson Creek"],
  ["Delta", "metro-vancouver", "City of Delta"],
  ["Duncan", "cowichan-valley", "The Corporation of the City of Duncan"],
  ["Elkford", "east-kootenay", "District of Elkford"],
  ["Enderby", "north-okanagan", "The Corporation of the City of Enderby"],
  ["Esquimalt", "capital", "Corporation of the Township of Esquimalt"],
  ["Fernie", "east-kootenay", "The Corporation of the City of Fernie"],
  ["Fort St. James", "bulkley-nechako", "District of Fort St James"],
  ["Fort St. John", "peace-river", "City of Fort St John"],
  ["Fraser Lake", "bulkley-nechako", "Village of Fraser Lake"],
  ["Fruitvale", "kootenay-boundary", "The Corporation of the Village of Fruitvale"],
  ["Gibsons", "sunshine-coast", "Town of Gibsons"],
  ["Gold River", "strathcona", "Village of Gold River"],
  ["Golden", "columbia-shuswap", "Town of Golden"],
  ["Grand Forks", "kootenay-boundary", "City of Grand Forks"],
  ["Granisle", "bulkley-nechako", "Village of Granisle"],
  ["Greenwood", "kootenay-boundary", "City of Greenwood"],
  ["Harrison Hot Springs", "fraser-valley", "Village of Harrison Hot Springs"],
  ["Hazelton", "kitimat-stikine", "The Corporation of the Village of Hazelton"],
  ["Highlands", "capital", "District of Highlands"],
  ["Hope", "fraser-valley", "District of Hope"],
  ["Houston", "bulkley-nechako", "District of Houston"],
  ["Hudson's Hope", "peace-river", "District of Hudsons Hope"],
  ["Invermere", "east-kootenay", "District of Invermere"],
  ["Kamloops", "thompson-nicola", "City of Kamloops"],
  ["Kaslo", "central-kootenay", "Village of Kaslo"],
  ["Kelowna", "central-okanagan", "City of Kelowna"],
  ["Kent", "fraser-valley", "District of Kent"],
  ["Keremeos", "okanagan-similkameen", "Village of Keremeos"],
  ["Kimberley", "east-kootenay", "City of Kimberley"],
  ["Kitimat", "kitimat-stikine", "District of Kitimat"],
  ["Ladysmith", "cowichan-valley", "Town of Ladysmith"],
  ["Lake Country", "central-okanagan", "District of Lake Country"],
  ["Lake Cowichan", "cowichan-valley", "Town of Lake Cowichan"],
  ["Langford", "capital", "City of Langford"],
  ["Langley (City)", "metro-vancouver", "City of Langley"],
  ["Langley (Township)", "metro-vancouver", "The Corporation of the Township of Langley"],
  ["Lantzville", "nanaimo", "District of Lantzville"],
  ["Lillooet", "squamish-lillooet", "District of Lillooet"],
  ["Lions Bay", "metro-vancouver", "Village of Lions Bay"],
  ["Logan Lake", "thompson-nicola", "District of Logan Lake"],
  ["Lumby", "north-okanagan", "The Corporation of the Village of Lumby"],
  ["Lytton", "thompson-nicola", "Village of Lytton"],
  ["Mackenzie", "fraser-fort-george", "District of Mackenzie"],
  ["Maple Ridge", "metro-vancouver", "City of Maple Ridge"],
  ["Masset", "north-coast", "Village of Masset"],
  ["McBride", "fraser-fort-george", "The Corporation of the Village of McBride"],
  ["Merritt", "thompson-nicola", "City of Merritt"],
  ["Metchosin", "capital", "District of Metchosin"],
  ["Midway", "kootenay-boundary", "Village of Midway"],
  ["Mission", "fraser-valley", "City of Mission"],
  ["Montrose", "kootenay-boundary", "Village of Montrose"],
  ["Nakusp", "central-kootenay", "Village of Nakusp"],
  ["Nanaimo", "nanaimo", "City of Nanaimo"],
  ["Nelson", "central-kootenay", "The Corporation of the City of Nelson"],
  ["New Denver", "central-kootenay", "Village of New Denver"],
  ["New Hazelton", "kitimat-stikine", "District of New Hazelton"],
  ["New Westminster", "metro-vancouver", "City of New Westminster"],
  ["North Cowichan", "cowichan-valley", "The Corporation of the District of North Cowichan"],
  ["North Saanich", "capital", "District of North Saanich"],
  ["North Vancouver (City)", "metro-vancouver", "City of North Vancouver"],
  ["North Vancouver (District)", "metro-vancouver", "The Corporation of the District of North Vancouver"],
  ["Northern Rockies", null, "Northern Rockies Regional Municipality"],
  ["Oak Bay", "capital", "The Corporation of the District of Oak Bay"],
  ["Oliver", "okanagan-similkameen", "Town of Oliver"],
  ["Osoyoos", "okanagan-similkameen", "Town of Osoyoos"],
  ["Parksville", "nanaimo", "City of Parksville"],
  ["Peachland", "central-okanagan", "The Corporation of the District of Peachland"],
  ["Pemberton", "squamish-lillooet", "Village of Pemberton"],
  ["Penticton", "okanagan-similkameen", "The Corporation of the City of Penticton"],
  ["Pitt Meadows", "metro-vancouver", "City of Pitt Meadows"],
  ["Port Alberni", "alberni-clayoquot", "City of Port Alberni"],
  ["Port Alice", "mount-waddington", "Village of Port Alice"],
  ["Port Clements", "north-coast", "Village of Port Clements"],
  ["Port Coquitlam", "metro-vancouver", "City of Port Coquitlam"],
  ["Port Edward", "north-coast", "District of Port Edward"],
  ["Port Hardy", "mount-waddington", "District of Port Hardy"],
  ["Port McNeill", "mount-waddington", "Town of Port McNeill"],
  ["Port Moody", "metro-vancouver", "City of Port Moody"],
  ["Pouce Coupe", "peace-river", "The Corporation of the Village of Pouce Coupe"],
  ["Powell River", "qathet", "City of Powell River"],
  ["Prince George", "fraser-fort-george", "City of Prince George"],
  ["Prince Rupert", "north-coast", "City of Prince Rupert"],
  ["Princeton", "okanagan-similkameen", "Town of Princeton"],
  ["Qualicum Beach", "nanaimo", "Town of Qualicum Beach"],
  ["Quesnel", "cariboo", "City of Quesnel"],
  ["Radium Hot Springs", "east-kootenay", "Village of Radium Hot Springs"],
  ["Revelstoke", "columbia-shuswap", "City of Revelstoke"],
  ["Richmond", "metro-vancouver", "City of Richmond"],
  ["Rossland", "kootenay-boundary", "City of Rossland"],
  ["Saanich", "capital", "The Corporation of the District of Saanich"],
  ["Salmo", "central-kootenay", "The Corporation of the Village of Salmo"],
  ["Salmon Arm", "columbia-shuswap", "City of Salmon Arm"],
  ["Sayward", "strathcona", "Village of Sayward"],
  ["Sechelt", "sunshine-coast", "District of Sechelt"],
  ["Sicamous", "columbia-shuswap", "The Corporation of the District of Sicamous"],
  ["Sidney", "capital", "Town of Sidney"],
  ["Silverton", "central-kootenay", "The Corporation of the Village of Silverton"],
  ["Slocan", "central-kootenay", "Village of Slocan"],
  ["Smithers", "bulkley-nechako", "Town of Smithers"],
  ["Sooke", "capital", "District of Sooke"],
  ["Spallumcheen", "north-okanagan", "The Corporation of the Township of Spallumcheen"],
  ["Sparwood", "east-kootenay", "District of Sparwood"],
  ["Squamish", "squamish-lillooet", "District of Squamish"],
  ["Stewart", "kitimat-stikine", "District of Stewart"],
  ["Summerland", "okanagan-similkameen", "The Corporation of the District of Summerland"],
  ["Sun Peaks", "thompson-nicola", "Sun Peaks Mountain Resort Municipality"],
  ["Surrey", "metro-vancouver", "City of Surrey"],
  ["Tahsis", "strathcona", "Village of Tahsis"],
  ["Taylor", "peace-river", "District of Taylor"],
  ["Telkwa", "bulkley-nechako", "The Corporation of the Village of Telkwa"],
  ["Terrace", "kitimat-stikine", "City of Terrace"],
  ["Tofino", "alberni-clayoquot", "Corporation of the Village of Tofino"],
  ["Trail", "kootenay-boundary", "City of Trail"],
  ["Tumbler Ridge", "peace-river", "District of Tumbler Ridge"],
  ["Ucluelet", "alberni-clayoquot", "District of Ucluelet"],
  ["Valemount", "fraser-fort-george", "Village of Valemount"],
  ["Vancouver", "metro-vancouver", "City of Vancouver"],
  ["Vanderhoof", "bulkley-nechako", "District of Vanderhoof"],
  ["Vernon", "north-okanagan", "The Corporation of the City of Vernon"],
  ["Victoria", "capital", "The Corporation of the City of Victoria"],
  ["View Royal", "capital", "Town of View Royal"],
  ["Warfield", "kootenay-boundary", "Village of Warfield"],
  ["Wells", "cariboo", "District of Wells"],
  ["West Kelowna", "central-okanagan", "City of West Kelowna"],
  ["West Vancouver", "metro-vancouver", "District Municipality of West Vancouver"],
  ["Whistler", "squamish-lillooet", "Resort Municipality of Whistler"],
  ["White Rock", "metro-vancouver", "City of White Rock"],
  ["Williams Lake", "cariboo", "City of Williams Lake"],
  ["Zeballos", "strathcona", "The Corporation of the Village of Zeballos"],
];

/**
 * Municipal names that are also common words, surnames or places elsewhere ("Mission", "Hope", "Golden",
 * "Nelson", "Houston"). They count only with a qualifier: "City of Mission", "Mission, BC", "Mission RD"…
 */
export const QUALIFIED_ONLY: ReadonlySet<string> = new Set([
  'Armstrong', 'Chase', 'Clearwater', 'Clinton', 'Cumberland', 'Delta', 'Duncan', 'Golden', 'Greenwood', 'Highlands',
  'Hope', 'Houston', 'Kent', 'Kimberley', 'Mackenzie', 'McBride', 'Merritt', 'Midway', 'Mission', 'Montrose', 'Nelson',
  'Oliver', 'Pemberton', 'Princeton', 'Sidney', 'Silverton', 'Slocan', 'Stewart', 'Taylor', 'Terrace', 'Trail', 'Vernon',
  'Warfield', 'Wells',
]);

/**
 * Two municipalities share a name: the bare name gives only their common regional district; the qualifier word
 * ("City of", "District of", "Township of") picks the municipality.
 */
export const SHARED_NAMES: Readonly<Record<string, { regionalDistrict: string; byQualifier: Record<string, string> }>> = {
  'Langley': { regionalDistrict: 'metro-vancouver', byQualifier: { city: 'Langley (City)', township: 'Langley (Township)' } },
  'North Vancouver': { regionalDistrict: 'metro-vancouver', byQualifier: { city: 'North Vancouver (City)', district: 'North Vancouver (District)' } },
};

/** Other spellings and communities inside one municipality: [name, municipality short name]. */
export const MUNICIPAL_ALIASES: readonly (readonly [string, string])[] = [
  ['Fort St John', 'Fort St. John'], ['Fort Saint John', 'Fort St. John'], ['Fort St James', 'Fort St. James'], ['Fort Saint James', 'Fort St. James'],
  ['Hudsons Hope', "Hudson's Hope"], ['One Hundred Mile House', '100 Mile House'], ['Queen Charlotte', 'Daajing Giids'],
  ['Northern Rockies Regional Municipality', 'Northern Rockies'], ['Fort Nelson', 'Northern Rockies'],
  ['Ladner', 'Delta'], ['Tsawwassen', 'Delta'], ['Steveston', 'Richmond'], ['Cloverdale', 'Surrey'],
  ['Aldergrove', 'Langley (Township)'], ['Fort Langley', 'Langley (Township)'], ['Walnut Grove', 'Langley (Township)'], ['Murrayville', 'Langley (Township)'],
  ['Chemainus', 'North Cowichan'], ['Crofton', 'North Cowichan'], ['Saanichton', 'Central Saanich'], ['Brentwood Bay', 'Central Saanich'],
  ['Oyama', 'Lake Country'], ['Agassiz', 'Kent'], ['Westbank', 'West Kelowna'],
];

/** Unincorporated communities that lie wholly in one regional district: [name, regional district id]. */
export const COMMUNITIES: readonly (readonly [string, string])[] = [
  ['Salt Spring Island', 'capital'], ['Ganges', 'capital'], ['Galiano Island', 'capital'], ['Mayne Island', 'capital'], ['Pender Island', 'capital'],
  ['Saturna Island', 'capital'], ['Port Renfrew', 'capital'], ['University of Victoria', 'capital'],
  ['Cobble Hill', 'cowichan-valley'], ['Mill Bay', 'cowichan-valley'], ['Shawnigan Lake', 'cowichan-valley'], ['Cowichan Bay', 'cowichan-valley'],
  ['Youbou', 'cowichan-valley'], ['Honeymoon Bay', 'cowichan-valley'], ['Mesachie Lake', 'cowichan-valley'], ['Thetis Island', 'cowichan-valley'],
  ['Gabriola Island', 'nanaimo'], ['Nanoose Bay', 'nanaimo'], ['Errington', 'nanaimo'], ['Coombs', 'nanaimo'], ['Bowser', 'nanaimo'],
  ['Merville', 'comox-valley'], ['Royston', 'comox-valley'], ['Union Bay', 'comox-valley'], ['Fanny Bay', 'comox-valley'], ['Denman Island', 'comox-valley'], ['Hornby Island', 'comox-valley'],
  ['Quadra Island', 'strathcona'], ['Cortes Island', 'strathcona'],
  ['Roberts Creek', 'sunshine-coast'], ['Halfmoon Bay', 'sunshine-coast'], ['Pender Harbour', 'sunshine-coast'], ['Madeira Park', 'sunshine-coast'],
  ['Sproat Lake', 'alberni-clayoquot'], ['Bamfield', 'alberni-clayoquot'], ['Bella Coola', 'central-coast'], ['Sointula', 'mount-waddington'],
  ['Naramata', 'okanagan-similkameen'], ['Okanagan Falls', 'okanagan-similkameen'], ['Kaleden', 'okanagan-similkameen'],
  ['Christina Lake', 'kootenay-boundary'], ['Dease Lake', 'kitimat-stikine'], ['Sandspit', 'north-coast'],
];

/**
 * Phrases that contain a place name but are not that place (or span several). They are consumed and tag nothing:
 * "Vancouver Island" is not Vancouver, "Saanich Peninsula" is three municipalities.
 */
export const NOT_A_PLACE: readonly string[] = [
  'Vancouver Island', 'Vancouver Coastal', 'Port of Vancouver', 'Vancouver Fraser Port', 'Vancouver Airport', 'Vancouver International Airport',
  'Vancouver, WA', 'Vancouver, Washington', 'Lower Mainland', 'Saanich Peninsula', 'Queen Charlotte Islands', 'Queen Charlotte Sound',
  'Queen Charlotte Strait', 'Old Masset', 'Richmond Hill', 'North York', 'Prince George County', "Prince George's County", 'Victoria Day',
];

/**
 * BC school districts by number whose area lies in one regional district. A district named after one municipality
 * that it alone serves also gives that municipality. Districts spanning regional districts (6, 20, 58, 68, 74, 83)
 * and province-wide 93 are left out, so their buyers fall back to name matching.
 */
export const SCHOOL_DISTRICTS: Readonly<Record<number, readonly [string, string | null]>> = {
  5: ['east-kootenay', null], 8: ['central-kootenay', null], 10: ['central-kootenay', null], 19: ['columbia-shuswap', 'Revelstoke'],
  22: ['north-okanagan', null], 23: ['central-okanagan', null], 27: ['cariboo', null], 28: ['cariboo', null],
  33: ['fraser-valley', 'Chilliwack'], 34: ['fraser-valley', 'Abbotsford'], 35: ['metro-vancouver', null], 36: ['metro-vancouver', null],
  37: ['metro-vancouver', 'Delta'], 38: ['metro-vancouver', 'Richmond'], 39: ['metro-vancouver', 'Vancouver'], 40: ['metro-vancouver', 'New Westminster'],
  41: ['metro-vancouver', 'Burnaby'], 42: ['metro-vancouver', null], 43: ['metro-vancouver', null], 44: ['metro-vancouver', null],
  45: ['metro-vancouver', null], 46: ['sunshine-coast', null], 47: ['qathet', null], 48: ['squamish-lillooet', null],
  49: ['central-coast', null], 50: ['north-coast', null], 51: ['kootenay-boundary', null], 52: ['north-coast', null],
  53: ['okanagan-similkameen', null], 54: ['bulkley-nechako', null], 57: ['fraser-fort-george', null], 59: ['peace-river', null],
  60: ['peace-river', null], 61: ['capital', null], 62: ['capital', null], 63: ['capital', null], 64: ['capital', null],
  67: ['okanagan-similkameen', null], 69: ['nanaimo', null], 70: ['alberni-clayoquot', null], 71: ['comox-valley', null],
  72: ['strathcona', null], 73: ['thompson-nicola', null], 75: ['fraser-valley', null], 78: ['fraser-valley', null],
  79: ['cowichan-valley', null], 82: ['kitimat-stikine', null], 84: ['strathcona', null], 85: ['mount-waddington', null],
  91: ['bulkley-nechako', null], 92: ['kitimat-stikine', null],
};
