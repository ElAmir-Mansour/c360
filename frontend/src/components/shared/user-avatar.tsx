"use client";
import { User } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getInitials, getAvatarColor } from "@/lib/format";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  user: {
    first_name: string;
    last_name: string;
    email?: string;
    /** Optional profile picture (data URL or remote URL). Falls back to initials. */
    avatar_url?: string | null;
  } | null;
  size?: "sm" | "md" | "lg";
  showTooltip?: boolean;
  className?: string;
}

const sizeClasses = { sm: "h-6 w-6 text-xs", md: "h-8 w-8 text-sm", lg: "h-10 w-10 text-base" };

export function UserAvatar({ user, size = "md", showTooltip = false, className }: UserAvatarProps) {
  const sizeClass = sizeClasses[size];

  if (!user) {
    return (
      <Avatar className={cn(sizeClass, "bg-muted", className)}>
        <AvatarFallback className="bg-muted">
          <User className="h-4 w-4 text-muted-foreground" />
        </AvatarFallback>
      </Avatar>
    );
  }

  const initials = getInitials(user.first_name, user.last_name);
  const colorClass = getAvatarColor(`${user.first_name} ${user.last_name}`);
  const fullName = `${user.first_name} ${user.last_name}`.trim();

  const avatar = (
    <Avatar className={cn(sizeClass, className)}>
      {/* Radix AvatarImage auto-hides (revealing the fallback) when src is empty
          or fails to load, so initials remain the graceful default. */}
      {user.avatar_url ? (
        <AvatarImage src={user.avatar_url} alt={fullName || user.email || "User avatar"} />
      ) : null}
      <AvatarFallback className={cn(colorClass, "text-white font-medium")}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );

  if (!showTooltip) return avatar;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{avatar}</TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{user.first_name} {user.last_name}</p>
          {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
