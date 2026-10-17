  // Spec section 2. Changing a course id breaks its history: ids are permanent.
  const VENUES = [{
    id: 'redmond', name: 'Flatstick Redmond',
    address: '7530 164th Ave NE, Suite A108, Redmond, WA 98052',
    location: { lat: 47.67199, lng: -122.12129 },
    courses: [
      { id: 'redmond-mini', name: 'Mini Golf', holes: 9, par: [3, 3, 3, 3, 3, 3, 3, 3, 3],
        lowerIsBetter: true, keys: [1, 2, 3, 4, 5, 6, 7, 8] },
      { id: 'redmond-aces', name: 'Aces', holes: 8, par: null,
        lowerIsBetter: true, keys: [1, 2, 3, 4, 5, 6, 7, 8] },
      { id: 'redmond-duff', name: 'Duffleboard', holes: 9, par: null,
        lowerIsBetter: true, keys: [1, 2, 3, 4, 5, 6, 7, 8] },
    ],
  }, {
    id: 'flatstick-kirkland', name: 'Flatstick Kirkland',
    address: '15 Lake St, Suite 100, Kirkland, WA 98033',
    location: { lat: 47.67594, lng: -122.20730 },
    courses: [],
  }, {
    id: 'flatstick-pioneer-square', name: 'Flatstick Pioneer Square',
    address: '240 2nd Ave S, Seattle, WA 98104',
    location: { lat: 47.60016, lng: -122.33101 },
    courses: [],
  }, {
    id: 'flatstick-slu', name: 'Flatstick South Lake Union',
    address: '609 Westlake Ave N, Seattle, WA 98109',
    location: { lat: 47.62502, lng: -122.33877 },
    courses: [],
  }, {
    id: 'flatstick-woodinville', name: 'Flatstick Woodinville',
    address: '13205 NE 175th St, Woodinville, WA 98072',
    location: { lat: 47.75422, lng: -122.16296 }, // TODO verify: OSM address point, not a tagged Flatstick POI
    courses: [],
  }, {
    id: 'flatstick-spokane', name: 'Flatstick Spokane',
    address: '618 W Main Ave, Spokane, WA 99201',
    location: { lat: 47.65923, lng: -117.42185 },
    courses: [],
  }, {
    id: 'willows-run', name: 'Willows Run (Rainbow Run)',
    address: '10402 Willows Rd NE, Redmond, WA 98052',
    location: { lat: 47.69019, lng: -122.14915 }, // TODO verify: clubhouse coords; putting course itself is not mapped
    courses: [],
  }, {
    id: 'desert-canyon', name: 'Desert Canyon',
    address: '1201 Desert Canyon Blvd, Orondo, WA 98843',
    location: { lat: 47.72039, lng: -120.18549 }, // TODO verify: clubhouse building coords; putting course itself is not mapped
    courses: [],
  }];
