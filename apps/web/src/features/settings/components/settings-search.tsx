"use client";

import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { Input } from "@quieter/ui/input";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";

import { isDemoModeAvailable } from "#/features/settings/domain/demo-mode-setting";
import { settingsDestinationSearch } from "#/features/settings/domain/settings-destination";
import {
  matchSettingsEntries,
  SETTINGS_SEARCH_ENTRIES,
} from "#/features/settings/domain/settings-search";
import type { SettingsSearchEntry } from "#/features/settings/domain/settings-search";
import { mailboxesQueryOptions } from "#/lib/mailboxes-query";

import { useSettingsTeam } from "./use-settings-team";

export const SettingsSearch = ({
  children,
  onSelect,
}: {
  children: (search: {
    input: ReactNode;
    results: ReactNode;
    searching: boolean;
  }) => ReactNode;
  onSelect: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [includeOtherTeams, setIncludeOtherTeams] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate({ from: "/settings" });
  const { teamId, organizations } = useSettingsTeam();
  const { data } = useQuery(mailboxesQueryOptions());
  const teams = organizations.filter(
    (team) => includeOtherTeams || team.id === teamId
  );
  const entries = SETTINGS_SEARCH_ENTRIES.flatMap(
    (entry): SettingsSearchEntry[] => {
      if (entry.scope === "personal") {
        return [entry];
      }
      if (entry.scope === "team") {
        return teams.map((team) => ({
          ...entry,
          description: `${team.name} / ${entry.description}`,
          id: `${entry.id}-${team.id}`,
          keywords: `${entry.keywords} ${team.name}`,
          organizationId: team.id,
        }));
      }
      return (data?.groups ?? []).flatMap((group) =>
        group.mailboxes.flatMap((mailbox) => {
          const accessible =
            teams.some((team) => team.id === mailbox.organizationId) &&
            (mailbox.provider === "gmail" ||
              (mailbox.provider === "managed" &&
                mailbox.grantRole === "manager"));
          if (!accessible) {
            return [];
          }
          return [
            {
              ...entry,
              description: `${group.name} / Mailboxes / ${mailbox.displayName || mailbox.emailAddress} / ${entry.title}`,
              id: `${entry.id}-${mailbox.id}`,
              keywords: `${entry.keywords} ${mailbox.displayName ?? ""} ${mailbox.emailAddress} ${group.name}`,
              mailboxId: mailbox.id,
              organizationId: mailbox.organizationId,
            },
          ];
        })
      );
    }
  );
  const results = matchSettingsEntries(query, {
    entries,
    includeDevelopment: isDemoModeAvailable(),
  });
  const select = (entry: SettingsSearchEntry) => {
    setQuery("");
    setActiveIndex(0);
    onSelect();
    void navigate({
      search: (previous) => ({
        ...previous,
        ...settingsDestinationSearch(entry, teamId),
      }),
      to: ".",
    });
  };
  const searching = query.trim().length > 0;
  const input = (
    <Input
      aria-label="Search settings"
      className="h-7 px-2.5 text-caption"
      placeholder="Search settings"
      type="search"
      autoComplete="off"
      value={query}
      onChange={(event) => {
        setQuery(event.target.value);
        setActiveIndex(0);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setQuery("");
        }
        if (!results.length) {
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % results.length);
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex(
            (index) => (index - 1 + results.length) % results.length
          );
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const entry = results[Math.min(activeIndex, results.length - 1)];
          if (entry !== undefined) {
            select(entry);
          }
        }
      }}
    />
  );
  const resultContent = searching ? (
    <section aria-label="Search results" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-body-lg">Search results</h1>
        <label
          htmlFor="settings-search-other-teams"
          className="flex items-center gap-2 text-caption"
        >
          <Checkbox
            id="settings-search-other-teams"
            checked={includeOtherTeams}
            onCheckedChange={(checked) => {
              setIncludeOtherTeams(checked);
              setActiveIndex(0);
            }}
          >
            <CheckboxIndicator />
          </Checkbox>
          Include other teams
        </label>
      </div>
      <output className="text-caption text-muted-fg">
        {results.length
          ? `${results.length} results`
          : "No settings match. Try a different word or include other teams."}
      </output>
      <div className="divide-y divide-border">
        {results.map((entry, index) => (
          <Button
            key={entry.id}
            variant="ghost"
            className={cn(
              "h-auto w-full justify-start py-4 text-left font-normal whitespace-normal",
              {
                "bg-accent":
                  index === Math.min(activeIndex, results.length - 1),
              }
            )}
            onClick={() => {
              select(entry);
            }}
          >
            <span>
              <span className="block text-body">{entry.title}</span>
              <span className="mt-1 block text-caption text-muted-fg">
                {entry.scope === "personal" ? "Personal / " : ""}
                {entry.description}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </section>
  ) : null;
  return <>{children({ input, results: resultContent, searching })}</>;
};
