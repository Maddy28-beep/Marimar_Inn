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
      width={480}
      height={173}
      sizes="160px"
      quality={70}
      priority={priority}
      className={cn("h-auto w-auto max-w-none bg-transparent object-contain", className)}
    />
  );
}
