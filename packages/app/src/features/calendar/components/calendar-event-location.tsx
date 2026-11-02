"use client";

import { Location01Icon } from "@hugeicons/core-free-icons";
import { Autocomplete } from "@quieter/ui/autocomplete";
import { Button } from "@quieter/ui/button";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";

export const CalendarEventLocation = ({
  disabled,
  onValueChange,
  suggestions,
  value,
}: {
  disabled: boolean;
  onValueChange: (value: string) => void;
  suggestions: readonly string[];
  value: string;
}) => {
  const locations = new Map<string, string>();
  for (const suggestion of suggestions) {
    const location = suggestion.trim();
    if (location && !locations.has(location.toLocaleLowerCase())) {
      locations.set(location.toLocaleLowerCase(), location);
    }
  }
  const location = value.trim();
  return (
    <Field>
      <div className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2">
        <Icon icon={Location01Icon} tone="muted" />
        <FieldLabel className="sr-only" htmlFor="calendar-event-location">
          Location
        </FieldLabel>
        <Autocomplete
          chrome="ghost"
          disabled={disabled}
          emptyMessage="No matching calendar locations. Enter any room or address."
          id="calendar-event-location"
          maxLength={2000}
          onValueChange={onValueChange}
          options={[...locations.values()]}
          placeholder="Add location"
          value={value}
        />
      </div>
      {location ? (
        <div className="ml-6">
          <Button
            disabled={disabled}
            nativeButton={false}
            render={
              <a
                aria-label="View location in Maps"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
                rel="noopener noreferrer"
                target="_blank"
              />
            }
            size="sm"
            variant="ghost"
          >
            View in Maps
          </Button>
        </div>
      ) : null}
    </Field>
  );
};
