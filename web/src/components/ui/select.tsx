import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

// A native <select>, styled like the other inputs: it works with the keyboard
// and on phones without any extra machinery.
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn("h-10 w-full appearance-none rounded-md border border-input bg-card pl-3 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
  </div>
))
Select.displayName = "Select"

export { Select }
