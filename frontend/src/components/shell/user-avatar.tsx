import { useMe } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function UserAvatar() {
  const { data: identity, isLoading } = useMe();

  if (isLoading || !identity) {
    return <Skeleton className={cn("h-10", "w-10", "rounded-full")} />;
  }

  // Backend payload: { email, role, profile: { full_name, ... } } — no
  // avatar field, so initials from the name/email, always.
  const fullName =
    identity.profile?.full_name || identity.email || "";
  const avatar: string | undefined = undefined;

  return (
    <Avatar className={cn("h-10", "w-10")}>
      {avatar && <AvatarImage src={avatar} alt={fullName} />}
      <AvatarFallback>{getInitials(fullName)}</AvatarFallback>
    </Avatar>
  );
}

const getInitials = (name = "") => {
  const names = name.split(" ");
  let initials = names[0].substring(0, 1).toUpperCase();

  if (names.length > 1) {
    initials += names[names.length - 1].substring(0, 1).toUpperCase();
  }
  return initials;
};

UserAvatar.displayName = "UserAvatar";
