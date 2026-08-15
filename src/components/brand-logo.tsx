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
      src="/logo/logo.jpg"
      alt="Marimar Inn"
      width={1422}
      height={818}
      priority={priority}
      className={cn("h-auto w-auto max-w-none object-contain", className)}
    />
  );
}
