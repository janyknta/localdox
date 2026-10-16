import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select";

export interface DropdownOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}
export interface DropdownGroup {
  label: string;
  options: DropdownOption[];
}
interface DropdownProps extends Omit<
  ComponentPropsWithoutRef<typeof SelectTrigger>,
  "value" | "onChange" | "children"
> {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly (DropdownOption | DropdownGroup)[];
  placeholder?: string;
  name?: string;
  required?: boolean;
}

/** The app's single-choice dropdown: themed, keyboard accessible and touch friendly. */
export const Dropdown = forwardRef<HTMLButtonElement, DropdownProps>(function Dropdown(
  { value, onValueChange, options, placeholder, disabled, name, required, className, ...props },
  ref,
) {
  // Prefix every value so an empty/default choice remains a real Radix item.
  const encoded = (value: string) => `value:${value}`;
  const item = (option: DropdownOption) => (
    <SelectItem key={option.value} value={encoded(option.value)} disabled={option.disabled}>
      {option.label}
    </SelectItem>
  );
  return (
    <Select
      value={encoded(value)}
      onValueChange={(next) => onValueChange(next.slice(6))}
      disabled={disabled}
      name={name}
      required={required}
    >
      <SelectTrigger ref={ref} className={className} {...props}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option, index) =>
          "options" in option ? (
            <SelectGroup key={`${option.label}:${index}`}>
              <SelectLabel>{option.label}</SelectLabel>
              {option.options.map(item)}
            </SelectGroup>
          ) : (
            item(option)
          ),
        )}
      </SelectContent>
    </Select>
  );
});
