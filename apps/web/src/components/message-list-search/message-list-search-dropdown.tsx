"use client";

import type { ReactNode } from "react";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Folder01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@quietr/ui";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import type { GmailLabelListItem } from "~/lib/gmail/gmail";
import {
  SEARCH_CATEGORY_FILTER_OPTIONS,
  normalizeLabelSelectionKey,
  selectCategoryFilterInSearchState,
  toggleUserLabelInSearchState,
  type SearchDropdownSectionId,
  type StructuredSearchState,
} from "./message-list-search-state";

const fadeTransition = {
  opacity: { duration: 0.14, ease: "easeOut" as const },
};

const SECTION_META: Record<SearchDropdownSectionId, { icon: IconSvgElement; label: string }> = {
  categories: { icon: Folder01Icon, label: "Categories" },
  labels: { icon: Tag01Icon, label: "Labels" },
};

type SearchStateUpdater = (
  updater: StructuredSearchState | ((current: StructuredSearchState) => StructuredSearchState),
) => void;

const SearchAccordionTrigger = ({
  children,
  icon,
  onClick,
  open,
}: {
  children: string;
  icon: IconSvgElement;
  onClick: () => void;
  open: boolean;
}) => (
  <button
    aria-expanded={open}
    className={cn(
      "flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted",
      { "bg-muted/80 font-medium": open },
    )}
    onClick={onClick}
    type="button"
  >
    <HugeiconsIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" icon={icon} />
    <span className="min-w-0 flex-1 truncate">{children}</span>
    <HugeiconsIcon
      aria-hidden
      className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", {
        "rotate-90": open,
        "rotate-0": !open,
      })}
      icon={open ? Cancel01Icon : ArrowRight01Icon}
    />
  </button>
);

const SearchIndentedButton = ({
  children,
  onClick,
  pressed = false,
}: {
  children: string;
  onClick: () => void;
  pressed?: boolean;
}) => (
  <button
    aria-pressed={pressed}
    className={cn(
      "flex min-h-8 w-full items-center rounded-md px-2.5 py-1.5 pl-9 text-left text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted",
      { "bg-muted ring-1 ring-border ring-inset": pressed },
    )}
    onClick={onClick}
    type="button"
  >
    <span className="min-w-0 flex-1 truncate">{children}</span>
  </button>
);

const SearchCategoriesBody = ({
  categoryFilter,
  updateSearchState,
}: {
  categoryFilter: StructuredSearchState["categoryFilter"];
  updateSearchState: SearchStateUpdater;
}) => (
  <div className="space-y-0.5">
    {SEARCH_CATEGORY_FILTER_OPTIONS.map((option) => (
      <SearchIndentedButton
        key={option.id}
        onClick={() =>
          updateSearchState((current) => selectCategoryFilterInSearchState(current, option.id))
        }
        pressed={categoryFilter === option.id}
      >
        {option.label}
      </SearchIndentedButton>
    ))}
  </div>
);

const SearchLabelsBody = ({
  draftSearchState,
  labelsErrorMessage,
  updateSearchState,
  userLabels,
}: {
  draftSearchState: StructuredSearchState;
  labelsErrorMessage: string | null;
  updateSearchState: SearchStateUpdater;
  userLabels: readonly GmailLabelListItem[];
}) => {
  const selectedUserLabelKeys = new Set(
    draftSearchState.userLabels.map((value) => normalizeLabelSelectionKey(value)),
  );

  return (
    <div className="space-y-1">
      {labelsErrorMessage ? (
        <div className="px-2.5 py-2 text-[13px] text-foreground">{labelsErrorMessage}</div>
      ) : userLabels.length > 0 ? (
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {userLabels.map((label) => (
            <SearchIndentedButton
              key={label.id}
              onClick={() =>
                updateSearchState((current) => toggleUserLabelInSearchState(current, label.name))
              }
              pressed={selectedUserLabelKeys.has(normalizeLabelSelectionKey(label.name))}
            >
              {label.name}
            </SearchIndentedButton>
          ))}
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[13px] text-muted-foreground">No custom labels.</div>
      )}
    </div>
  );
};

const AccordionSection = ({
  children,
  icon,
  label,
  onToggle,
  open,
  sectionId,
}: {
  children: ReactNode;
  icon: IconSvgElement;
  label: string;
  onToggle: (id: SearchDropdownSectionId) => void;
  open: boolean;
  sectionId: SearchDropdownSectionId;
}) => (
  <AccordionSectionInner
    icon={icon}
    label={label}
    onToggle={onToggle}
    open={open}
    sectionId={sectionId}
  >
    {children}
  </AccordionSectionInner>
);

const AccordionSectionInner = ({
  children,
  icon,
  label,
  onToggle,
  open,
  sectionId,
}: {
  children: ReactNode;
  icon: IconSvgElement;
  label: string;
  onToggle: (id: SearchDropdownSectionId) => void;
  open: boolean;
  sectionId: SearchDropdownSectionId;
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div>
      <SearchAccordionTrigger icon={icon} onClick={() => onToggle(sectionId)} open={open}>
        {label}
      </SearchAccordionTrigger>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            key={sectionId}
            animate={{ opacity: 1, height: "auto" }}
            className="overflow-hidden"
            exit={{ opacity: 0, height: 0 }}
            initial={{ opacity: 0, height: 0 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : {
                    height: { duration: 0.2, ease: "easeOut" },
                    ...fadeTransition,
                  }
            }
          >
            <div className="pt-1">{children}</div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export const MessageListSearchDropdown = ({
  draftSearchState,
  labelsErrorMessage,
  onOpenSectionChange,
  openSection,
  updateSearchState,
  userLabels,
}: {
  draftSearchState: StructuredSearchState;
  labelsErrorMessage: string | null;
  onOpenSectionChange: (value: SearchDropdownSectionId | null) => void;
  openSection: SearchDropdownSectionId | null;
  updateSearchState: SearchStateUpdater;
  userLabels: readonly GmailLabelListItem[];
}) => {
  const handleSectionToggle = (sectionId: SearchDropdownSectionId) => {
    onOpenSectionChange(openSection === sectionId ? null : sectionId);
  };

  return (
    <LazyMotion features={domAnimation}>
      <div className="space-y-1">
        <AccordionSection
          icon={SECTION_META.categories.icon}
          label={SECTION_META.categories.label}
          onToggle={handleSectionToggle}
          open={openSection === "categories"}
          sectionId="categories"
        >
          <SearchCategoriesBody
            categoryFilter={draftSearchState.categoryFilter}
            updateSearchState={updateSearchState}
          />
        </AccordionSection>

        <AccordionSection
          icon={SECTION_META.labels.icon}
          label={SECTION_META.labels.label}
          onToggle={handleSectionToggle}
          open={openSection === "labels"}
          sectionId="labels"
        >
          <SearchLabelsBody
            draftSearchState={draftSearchState}
            labelsErrorMessage={labelsErrorMessage}
            updateSearchState={updateSearchState}
            userLabels={userLabels}
          />
        </AccordionSection>
      </div>
    </LazyMotion>
  );
};
