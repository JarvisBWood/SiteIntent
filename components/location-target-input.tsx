"use client";

import { useMemo, useState } from "react";
import { MapPin, X } from "lucide-react";

import {
  formatLocationLabel,
  searchBusinessLocations
} from "@/lib/location-targeting";
import type { BusinessLocationTarget } from "@/lib/site-state";

type LocationTargetInputProps = {
  selected: BusinessLocationTarget[];
  onChange: (next: BusinessLocationTarget[]) => void;
  placeholder?: string;
};

export function LocationTargetInput({
  selected,
  onChange,
  placeholder = "Search countries, states, towns, or suburbs"
}: LocationTargetInputProps) {
  const [query, setQuery] = useState("");
  const suggestions = useMemo(
    () => searchBusinessLocations(query, selected.map((location) => location.id)),
    [query, selected]
  );

  function addLocation(location: BusinessLocationTarget) {
    onChange([...selected, location]);
    setQuery("");
  }

  function removeLocation(locationId: string) {
    onChange(selected.filter((location) => location.id !== locationId));
  }

  return (
    <div className="location-target-input">
      <div className="location-target-input__box">
        <MapPin size={16} />
        <input
          className="location-target-input__field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label="Search business locations"
        />
      </div>

      {query.trim() ? (
        <div className="location-target-input__results" role="listbox" aria-label="Location suggestions">
          {suggestions.length ? (
            suggestions.map((location) => (
              <button
                key={location.id}
                className="location-target-input__option"
                type="button"
                onClick={() => addLocation(location)}
              >
                <span>{location.label}</span>
                <span className="location-target-input__meta">
                  {location.type} · {[location.region, location.country].filter(Boolean).join(", ")}
                </span>
              </button>
            ))
          ) : (
            <div className="location-target-input__empty">No matching locations found in the built-in list yet.</div>
          )}
        </div>
      ) : null}

      {selected.length ? (
        <div className="location-target-input__pills">
          {selected.map((location) => (
            <span key={location.id} className="location-pill">
              {formatLocationLabel(location)}
              <button type="button" onClick={() => removeLocation(location.id)} aria-label={`Remove ${location.label}`}>
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
