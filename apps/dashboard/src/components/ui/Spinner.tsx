import { LoaderCircle } from "lucide-react";

export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={`animate-spin text-accent ${className}`} />;
}
