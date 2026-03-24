import { type InputHTMLAttributes, type ReactNode } from "react";

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  /** Optional leading icon element */
  icon?: ReactNode;
  className?: string;
}

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  icon,
  className = "",
  ...rest
}: InputProps) {
  return (
    <div className={`relative flex items-center ${className}`}>
      {icon && (
        <span className="absolute left-3 text-[var(--atlas-text-tertiary)] pointer-events-none">
          {icon}
        </span>
      )}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={[
          "w-full",
          "bg-[var(--atlas-midnight)] text-[var(--atlas-text-primary)]",
          "border border-[var(--atlas-steel)]",
          "rounded-[var(--atlas-radius-md)]",
          "px-3 py-2 text-[var(--atlas-text-sm)]",
          "placeholder:text-[var(--atlas-text-tertiary)]",
          "outline-none",
          "transition-[border-color,box-shadow] duration-[var(--atlas-transition-normal)]",
          "focus:border-[var(--atlas-racing-green)]",
          "focus:shadow-[var(--atlas-glow-green)]",
          icon ? "pl-10" : "",
        ].join(" ")}
        style={{ caretColor: "var(--atlas-lime)" }}
        {...rest}
      />
    </div>
  );
}
