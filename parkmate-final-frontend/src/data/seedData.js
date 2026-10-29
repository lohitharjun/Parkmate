const confirmedRecently = () => new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

const weeklyOpen = [];

function sampleListing({ id, title, description, rules, address, latitude, longitude, price, vehicle, distance, illustration, owner }) {
  return {
    id,
    title,
    description,
    rules,
    address,
    latitude,
    longitude,
    price_per_hour: price,
    vehicle_type: vehicle,
    is_active: true,
    status: 'approved',
    availability: weeklyOpen,
    distance_km: distance,
    last_confirmed_at: confirmedRecently(),
    is_demo: true,
    illustration,
    owner_id: owner,
  };
}

export const SAMPLE_LISTINGS = [
  sampleListing({
    id: 'sample-guindy-metro', title: 'Guindy Metro Courtyard',
    description: 'A straightforward off-street space near the metro and Race Course Road.',
    rules: 'Park within the marked bay. Keep the shared driveway clear.', address: 'Race Course Road, Guindy, Chennai',
    latitude: 13.0067, longitude: 80.2206, price: 45, vehicle: 'Hatchback, sedan', distance: 0.6,
    illustration: 'sage', owner: 'demo-neighbour-01',
  }),
  sampleListing({
    id: 'sample-adyar-lane', title: 'Adyar Garden Lane',
    description: 'A quiet, open-air spot tucked behind a leafy residential lane.',
    rules: 'Compact vehicles only. Please do not block the gate.', address: 'LB Road, Adyar, Chennai',
    latitude: 13.0012, longitude: 80.2565, price: 55, vehicle: 'Compact, hatchback', distance: 1.2,
    illustration: 'clay', owner: 'demo-neighbour-02',
  }),
  sampleListing({
    id: 'sample-mylapore-courtyard', title: 'Mylapore Temple Street Bay',
    description: 'An easy-to-find paved bay close to local shops and the temple district.',
    rules: 'Open-air parking. Arrive within your selected booking window.', address: 'Temple Street, Mylapore, Chennai',
    latitude: 13.0338, longitude: 80.2674, price: 40, vehicle: 'Two-wheeler, hatchback', distance: 2.1,
    illustration: 'blue', owner: 'demo-neighbour-03',
  }),
  sampleListing({
    id: 'sample-alwarpet-covered', title: 'Alwarpet Covered Bay',
    description: 'A shaded space in a small residential complex with a wide entrance.',
    rules: 'Covered parking. Please check host instructions before arrival.', address: 'T.T.K. Road, Alwarpet, Chennai',
    latitude: 13.0332, longitude: 80.2518, price: 75, vehicle: 'Sedan, SUV', distance: 2.5,
    illustration: 'sand', owner: 'demo-neighbour-04',
  }),
  sampleListing({
    id: 'sample-tnagar-market', title: 'T. Nagar Market-side Slot',
    description: 'A simple sample bay a short walk from Pondy Bazaar.',
    rules: 'Compact cars and hatchbacks only. Keep the entry clear.', address: 'Pondy Bazaar, T. Nagar, Chennai',
    latitude: 13.0418, longitude: 80.2341, price: 35, vehicle: 'Compact, hatchback', distance: 2.9,
    illustration: 'clay', owner: 'demo-neighbour-05',
  }),
  sampleListing({
    id: 'sample-nungambakkam-office', title: 'Nungambakkam Office Court',
    description: 'A quiet paved courtyard sample near Sterling Road.',
    rules: 'Sedan-sized vehicles only. Arrive during your selected time.', address: 'Sterling Road, Nungambakkam, Chennai',
    latitude: 13.0602, longitude: 80.2443, price: 90, vehicle: 'Sedan', distance: 3.8,
    illustration: 'forest', owner: 'demo-neighbour-06',
  }),
  sampleListing({
    id: 'sample-besant-beach', title: 'Besant Nagar Beach Lane',
    description: 'An open sample space near the Elliot’s Beach promenade.',
    rules: 'Two-wheelers and compact cars only. Do not block neighbouring access.', address: 'Elliot’s Beach Road, Besant Nagar, Chennai',
    latitude: 12.9995, longitude: 80.2707, price: 60, vehicle: 'Two-wheeler, compact', distance: 4.2,
    illustration: 'blue', owner: 'demo-neighbour-07',
  }),
  sampleListing({
    id: 'sample-velachery-covered', title: 'Velachery Covered Garage',
    description: 'A shaded sample bay off the 100 Feet Bypass Road.',
    rules: 'Sedans and SUVs fit. Please follow the building access notes.', address: '100 Feet Bypass Road, Velachery, Chennai',
    latitude: 12.9815, longitude: 80.2180, price: 80, vehicle: 'Sedan, SUV', distance: 6.1,
    illustration: 'sand', owner: 'demo-neighbour-08',
  }),
  sampleListing({
    id: 'sample-anna-nagar-garden', title: 'Anna Nagar Garden Drive',
    description: 'A residential driveway sample close to 2nd Avenue.',
    rules: 'Park inside the marked boundary and keep the gate accessible.', address: '2nd Avenue, Anna Nagar, Chennai',
    latitude: 13.0850, longitude: 80.2101, price: 55, vehicle: 'Hatchback, sedan', distance: 7.3,
    illustration: 'sage', owner: 'demo-neighbour-09',
  }),
  sampleListing({
    id: 'sample-thiruvanmiyur-shade', title: 'Thiruvanmiyur Shaded Drive',
    description: 'A leafy driveway sample near the East Coast Road junction.',
    rules: 'Compact cars and sedans only. Confirm the gate access instructions.', address: 'East Coast Road, Thiruvanmiyur, Chennai',
    latitude: 12.9871, longitude: 80.2594, price: 65, vehicle: 'Compact, sedan', distance: 4.9,
    illustration: 'forest', owner: 'demo-neighbour-10',
  }),
  sampleListing({
    id: 'demo-provider-driveway', title: 'Your Demo Driveway',
    description: 'A fictional provider-owned space used to preview the host dashboard.',
    rules: 'Sample host listing. No real access is offered.', address: 'Anna Salai, Chennai',
    latitude: 13.0604, longitude: 80.2496, price: 70, vehicle: 'Hatchback, sedan', distance: 1.8,
    illustration: 'forest', owner: 'demo-provider',
  }),
  sampleListing({
    id: 'demo-provider-garden-bay', title: 'Your Demo Garden Bay',
    description: 'A fictional, provider-owned sample space near a residential garden.',
    rules: 'Sample host listing. Check all access details in a real marketplace.', address: 'Adyar, Chennai',
    latitude: 13.0050, longitude: 80.2560, price: 60, vehicle: 'Compact, hatchback', distance: 1.5,
    illustration: 'sage', owner: 'demo-provider',
  }),
  sampleListing({
    id: 'demo-provider-covered-garage', title: 'Your Demo Covered Garage',
    description: 'A fictional provider-owned covered bay for previewing reservations.',
    rules: 'Sample host listing. No real access is offered.', address: 'Nungambakkam, Chennai',
    latitude: 13.0576, longitude: 80.2435, price: 85, vehicle: 'Sedan, SUV', distance: 3.5,
    illustration: 'sand', owner: 'demo-provider',
  }),
];

function futureSampleStart(daysAhead, hour) {
  const start = new Date();
  start.setDate(start.getDate() + daysAhead);
  start.setHours(hour, 0, 0, 0);
  return start;
}

function sampleReservation({ id, listingId, listingTitle, address, consumerName, daysAhead, hour, hours, total }) {
  const start = futureSampleStart(daysAhead, hour);
  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  return {
    id,
    listing_id: listingId,
    user_id: `sample-consumer-${id}`,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    total_price: total,
    status: 'confirmed',
    listing: { id: listingId, title: listingTitle, address },
    consumer: { display_name: `${consumerName} (sample)` },
    is_demo: true,
    is_sample: true,
  };
}

export const SAMPLE_PROVIDER_RESERVATIONS = [
  sampleReservation({
    id: 'sample-reservation-001', listingId: 'demo-provider-driveway', listingTitle: 'Your Demo Driveway',
    address: 'Anna Salai, Chennai', consumerName: 'Nila', daysAhead: 1, hour: 15, hours: 2, total: 140,
  }),
  sampleReservation({
    id: 'sample-reservation-002', listingId: 'demo-provider-garden-bay', listingTitle: 'Your Demo Garden Bay',
    address: 'Adyar, Chennai', consumerName: 'Arjun', daysAhead: 2, hour: 11, hours: 2, total: 120,
  }),
  sampleReservation({
    id: 'sample-reservation-003', listingId: 'demo-provider-covered-garage', listingTitle: 'Your Demo Covered Garage',
    address: 'Nungambakkam, Chennai', consumerName: 'Mira', daysAhead: 3, hour: 16, hours: 2, total: 170,
  }),
];
