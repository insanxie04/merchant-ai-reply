"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import {
  SelectItem,
  SelectLabel,
  SelectGroup,
  SelectScrollDownButton,
  SelectScrollUpButton,
} from "@/components/ui/select";
import { CATEGORY_GROUPS } from "@/lib/merchant-categories";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";

const popupClassName =
  "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

export type GroupedCategorySelectProps = {
  id?: string;
  disabled?: boolean;
  sentinelValue: string;
  lastOptionLabel: string;
  value: string;
  onValueChange: (next: string) => void;
  customText: string;
  onCustomTextChange: (text: string) => void;
  placeholder: string;
  maxLength: number;
};

export function GroupedCategorySelect({
  id,
  disabled = false,
  sentinelValue,
  lastOptionLabel,
  value,
  onValueChange,
  customText,
  onCustomTextChange,
  placeholder,
  maxLength,
}: GroupedCategorySelectProps) {
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [inputFocused, setInputFocused] = React.useState(false);

  const isCustom = value === sentinelValue;
  const showPlaceholder = !inputFocused && customText.length === 0;

  return (
    <SelectPrimitive.Root
      value={value}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(v) => {
        if (v == null) return;
        onValueChange(v as string);
      }}
    >
      <span className="sr-only">
        <SelectPrimitive.Value />
      </span>
      <div
        ref={anchorRef}
        className={cn(
          "flex h-10 w-full min-w-0 overflow-hidden rounded-lg border border-input bg-transparent text-sm transition-colors outline-none select-none",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          "dark:bg-input/30",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        {isCustom ? (
          <input
            id={id}
            type="text"
            disabled={disabled}
            value={customText}
            maxLength={maxLength}
            placeholder={showPlaceholder ? placeholder : ""}
            onChange={(e) => onCustomTextChange(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            className={cn(
              "min-w-0 flex-1 border-0 bg-transparent px-2.5 py-2 text-sm text-foreground outline-none",
              "placeholder:text-[#999999]",
              "focus-visible:ring-0"
            )}
            autoComplete="off"
          />
        ) : (
          <button
            id={id}
            type="button"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className={cn(
              "flex min-w-0 flex-1 items-center px-2.5 py-2 text-left text-sm text-foreground outline-none",
              "disabled:cursor-not-allowed"
            )}
          >
            <span className="truncate">{value}</span>
          </button>
        )}
        <SelectPrimitive.Trigger
          type="button"
          data-slot="select-trigger"
          disabled={disabled}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-none border-0 border-l border-input bg-transparent py-0 outline-none transition-colors select-none",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-input"
          )}
        >
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        </SelectPrimitive.Trigger>
      </div>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          sideOffset={4}
          align="center"
          alignOffset={0}
          alignItemWithTrigger
          anchor={anchorRef}
          className="isolate z-50"
        >
          <SelectPrimitive.Popup
            data-slot="select-content"
            className={cn(popupClassName)}
          >
            <SelectScrollUpButton />
            <SelectPrimitive.List>
              {CATEGORY_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel className="pointer-events-none cursor-default font-medium text-muted-foreground">
                    {group.label}
                  </SelectLabel>
                  {group.items.map((p) => (
                    <SelectItem key={p} value={p} className="pl-6">
                      {p}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
              <SelectGroup>
                <SelectLabel className="pointer-events-none cursor-default font-medium text-muted-foreground">
                  其他
                </SelectLabel>
                <SelectItem value={sentinelValue} className="pl-6">
                  {lastOptionLabel}
                </SelectItem>
              </SelectGroup>
            </SelectPrimitive.List>
            <SelectScrollDownButton />
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
