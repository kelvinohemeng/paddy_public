import { cn } from "@/lib/utils";

export default function SignUpCardSelect({
  role,
  setRole,
  value,
}: {
  role: string;
  setRole: (role: string) => void;
  value: string;
}) {
  const inputId = `role-${value}`;

  return (
    // The label itself is now the whole clickable card — not a small
    // text element inside it. Every pixel inside this element toggles
    // the input, since that's what a <label> wrapping its <input>
    // natively does in HTML, no onClick handler required.
    <label
      htmlFor={inputId}
      className={cn(
        "relative flex flex-col items-start justify-end gap-1",
        "cursor-pointer min-w-[120px] w-full aspect-3/2",
        "border-2 rounded-md p-3 transition-colors",
        role === value
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
      )}
    >
      <input
        type="radio"
        name="role"
        id={inputId}
        value={value}
        checked={role === value}
        onChange={(e) => setRole(e.target.value)}
        className="sr-only"
      />
      <span className={cn("capitalize", "text-sm", "font-medium")}>
        {value}
      </span>
      <p className="text-xs text-muted-foreground">Sign up as a {value}</p>
    </label>
  );
}
