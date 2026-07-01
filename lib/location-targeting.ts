import type { BusinessLocationTarget, TargetIntentModel } from "@/lib/site-state";

const DEFAULT_LOCATION = {
  country: "Australia",
  countryCode: "AU",
  region: "New South Wales",
  city: "Sydney",
  timezone: "Australia/Sydney"
} as const;

export const BUSINESS_LOCATION_OPTIONS: BusinessLocationTarget[] = [
  { id: "country-au", label: "Australia", type: "country", country: "Australia", countryCode: "AU", timezone: "Australia/Sydney" },
  { id: "state-nsw-au", label: "New South Wales", type: "state", country: "Australia", countryCode: "AU", region: "New South Wales", timezone: "Australia/Sydney" },
  { id: "state-vic-au", label: "Victoria", type: "state", country: "Australia", countryCode: "AU", region: "Victoria", timezone: "Australia/Melbourne" },
  { id: "state-qld-au", label: "Queensland", type: "state", country: "Australia", countryCode: "AU", region: "Queensland", timezone: "Australia/Brisbane" },
  { id: "state-wa-au", label: "Western Australia", type: "state", country: "Australia", countryCode: "AU", region: "Western Australia", timezone: "Australia/Perth" },
  { id: "state-sa-au", label: "South Australia", type: "state", country: "Australia", countryCode: "AU", region: "South Australia", timezone: "Australia/Adelaide" },
  { id: "state-tas-au", label: "Tasmania", type: "state", country: "Australia", countryCode: "AU", region: "Tasmania", timezone: "Australia/Hobart" },
  { id: "town-sydney-nsw-au", label: "Sydney", type: "town", country: "Australia", countryCode: "AU", region: "New South Wales", city: "Sydney", timezone: "Australia/Sydney" },
  { id: "town-newcastle-nsw-au", label: "Newcastle", type: "town", country: "Australia", countryCode: "AU", region: "New South Wales", city: "Newcastle", timezone: "Australia/Sydney" },
  { id: "suburb-bondi-nsw-au", label: "Bondi", type: "suburb", country: "Australia", countryCode: "AU", region: "New South Wales", city: "Sydney", timezone: "Australia/Sydney" },
  { id: "suburb-parramatta-nsw-au", label: "Parramatta", type: "suburb", country: "Australia", countryCode: "AU", region: "New South Wales", city: "Sydney", timezone: "Australia/Sydney" },
  { id: "town-melbourne-vic-au", label: "Melbourne", type: "town", country: "Australia", countryCode: "AU", region: "Victoria", city: "Melbourne", timezone: "Australia/Melbourne" },
  { id: "town-geelong-vic-au", label: "Geelong", type: "town", country: "Australia", countryCode: "AU", region: "Victoria", city: "Geelong", timezone: "Australia/Melbourne" },
  { id: "suburb-richmond-vic-au", label: "Richmond", type: "suburb", country: "Australia", countryCode: "AU", region: "Victoria", city: "Melbourne", timezone: "Australia/Melbourne" },
  { id: "town-brisbane-qld-au", label: "Brisbane", type: "town", country: "Australia", countryCode: "AU", region: "Queensland", city: "Brisbane", timezone: "Australia/Brisbane" },
  { id: "town-gold-coast-qld-au", label: "Gold Coast", type: "town", country: "Australia", countryCode: "AU", region: "Queensland", city: "Gold Coast", timezone: "Australia/Brisbane" },
  { id: "town-perth-wa-au", label: "Perth", type: "town", country: "Australia", countryCode: "AU", region: "Western Australia", city: "Perth", timezone: "Australia/Perth" },
  { id: "town-adelaide-sa-au", label: "Adelaide", type: "town", country: "Australia", countryCode: "AU", region: "South Australia", city: "Adelaide", timezone: "Australia/Adelaide" },
  { id: "country-us", label: "United States", type: "country", country: "United States", countryCode: "US", timezone: "America/New_York" },
  { id: "state-california-us", label: "California", type: "state", country: "United States", countryCode: "US", region: "California", timezone: "America/Los_Angeles" },
  { id: "state-texas-us", label: "Texas", type: "state", country: "United States", countryCode: "US", region: "Texas", timezone: "America/Chicago" },
  { id: "state-new-york-us", label: "New York", type: "state", country: "United States", countryCode: "US", region: "New York", timezone: "America/New_York" },
  { id: "town-san-francisco-ca-us", label: "San Francisco", type: "town", country: "United States", countryCode: "US", region: "California", city: "San Francisco", timezone: "America/Los_Angeles" },
  { id: "town-los-angeles-ca-us", label: "Los Angeles", type: "town", country: "United States", countryCode: "US", region: "California", city: "Los Angeles", timezone: "America/Los_Angeles" },
  { id: "town-austin-tx-us", label: "Austin", type: "town", country: "United States", countryCode: "US", region: "Texas", city: "Austin", timezone: "America/Chicago" },
  { id: "town-new-york-ny-us", label: "New York City", type: "town", country: "United States", countryCode: "US", region: "New York", city: "New York", timezone: "America/New_York" },
  { id: "country-gb", label: "United Kingdom", type: "country", country: "United Kingdom", countryCode: "GB", timezone: "Europe/London" },
  { id: "state-england-gb", label: "England", type: "state", country: "United Kingdom", countryCode: "GB", region: "England", timezone: "Europe/London" },
  { id: "town-london-england-gb", label: "London", type: "town", country: "United Kingdom", countryCode: "GB", region: "England", city: "London", timezone: "Europe/London" },
  { id: "town-manchester-england-gb", label: "Manchester", type: "town", country: "United Kingdom", countryCode: "GB", region: "England", city: "Manchester", timezone: "Europe/London" },
  { id: "country-nz", label: "New Zealand", type: "country", country: "New Zealand", countryCode: "NZ", timezone: "Pacific/Auckland" },
  { id: "town-auckland-nz", label: "Auckland", type: "town", country: "New Zealand", countryCode: "NZ", region: "Auckland", city: "Auckland", timezone: "Pacific/Auckland" },
  { id: "town-wellington-nz", label: "Wellington", type: "town", country: "New Zealand", countryCode: "NZ", region: "Wellington", city: "Wellington", timezone: "Pacific/Auckland" },
  { id: "country-ca", label: "Canada", type: "country", country: "Canada", countryCode: "CA", timezone: "America/Toronto" },
  { id: "state-ontario-ca", label: "Ontario", type: "state", country: "Canada", countryCode: "CA", region: "Ontario", timezone: "America/Toronto" },
  { id: "state-british-columbia-ca", label: "British Columbia", type: "state", country: "Canada", countryCode: "CA", region: "British Columbia", timezone: "America/Vancouver" },
  { id: "town-toronto-on-ca", label: "Toronto", type: "town", country: "Canada", countryCode: "CA", region: "Ontario", city: "Toronto", timezone: "America/Toronto" },
  { id: "town-vancouver-bc-ca", label: "Vancouver", type: "town", country: "Canada", countryCode: "CA", region: "British Columbia", city: "Vancouver", timezone: "America/Vancouver" },
  { id: "country-sg", label: "Singapore", type: "country", country: "Singapore", countryCode: "SG", city: "Singapore", timezone: "Asia/Singapore" }
];

export function normalizeLocationTargets(targets: BusinessLocationTarget[] | undefined) {
  return Array.isArray(targets)
    ? targets
        .map((target) => BUSINESS_LOCATION_OPTIONS.find((option) => option.id === target.id) ?? normalizeAdHocLocation(target))
        .filter(Boolean)
    : [];
}

export function searchBusinessLocations(query: string, selectedIds: string[] = [], limit = 8) {
  const normalizedQuery = query.trim().toLowerCase();
  const selectedSet = new Set(selectedIds);

  return BUSINESS_LOCATION_OPTIONS.filter((option) => {
    if (selectedSet.has(option.id)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [option.label, option.type, option.country, option.region, option.city].filter(Boolean).join(" ").toLowerCase();
    return normalizedQuery.split(/\s+/g).every((term) => haystack.includes(term));
  }).slice(0, limit);
}

export function formatLocationLabel(location: BusinessLocationTarget) {
  const suffix = [location.region, location.country].filter(Boolean).join(", ");
  return suffix && suffix !== location.label ? `${location.label}, ${suffix}` : location.label;
}

export function getActiveLocationTargets(targetIntentModel?: TargetIntentModel | null) {
  if (!targetIntentModel?.isLocationSpecific) {
    return [];
  }

  return normalizeLocationTargets(targetIntentModel.locationTargets);
}

export function buildLocationScopePhrase(targetIntentModel?: TargetIntentModel | null, fallback = DEFAULT_LOCATION.country) {
  const activeTargets = getActiveLocationTargets(targetIntentModel);
  if (!activeTargets.length) {
    return fallback;
  }

  const labels = activeTargets.slice(0, 4).map((location) => formatLocationLabel(location));
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function buildLocationAwareContext(
  customer: string,
  category: string,
  targetIntentModel: TargetIntentModel | undefined,
  intentVerb: "looking for" | "evaluating"
) {
  const activeTargets = getActiveLocationTargets(targetIntentModel);
  if (!activeTargets.length) {
    return `${customer} ${intentVerb} ${category} options in ${DEFAULT_LOCATION.country}`;
  }

  return `${customer} ${intentVerb} ${category} options in ${buildLocationScopePhrase(targetIntentModel)}`;
}

export function buildLocationSearchTerms(targetIntentModel?: TargetIntentModel | null, fallback = DEFAULT_LOCATION.country) {
  const activeTargets = getActiveLocationTargets(targetIntentModel);
  if (!activeTargets.length) {
    return [fallback];
  }

  const terms = activeTargets.flatMap((location) => {
    const pieces = [location.label, location.region, location.country].filter(Boolean);
    return [pieces.join(" "), location.country];
  });

  return [...new Set(terms)].slice(0, 6);
}

export function buildWebSearchUserLocation(targetIntentModel?: TargetIntentModel | null) {
  const primary = getActiveLocationTargets(targetIntentModel)[0];
  if (!primary) {
    return {
      type: "approximate" as const,
      ...DEFAULT_LOCATION
    };
  }

  return {
    type: "approximate" as const,
    country: primary.countryCode,
    region: primary.region,
    city: primary.city,
    timezone: primary.timezone ?? DEFAULT_LOCATION.timezone
  };
}

function normalizeAdHocLocation(target: BusinessLocationTarget) {
  return {
    id: String(target.id ?? "").trim(),
    label: String(target.label ?? "").trim(),
    type: normalizeLocationType(target.type),
    country: String(target.country ?? "").trim(),
    countryCode: String(target.countryCode ?? "").trim().toUpperCase(),
    region: typeof target.region === "string" ? target.region.trim() : undefined,
    city: typeof target.city === "string" ? target.city.trim() : undefined,
    timezone: typeof target.timezone === "string" ? target.timezone.trim() : undefined
  };
}

function normalizeLocationType(value: unknown): BusinessLocationTarget["type"] {
  return value === "country" || value === "state" || value === "town" || value === "suburb" ? value : "town";
}
