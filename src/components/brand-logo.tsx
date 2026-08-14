import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandLogo({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo/logo.png"
      alt="Marimar Inn"
      width={1540}
      height={1021}
      priority={priority}
      className={cn("h-auto w-auto max-w-none object-contain", className)}
    />
  );
}
