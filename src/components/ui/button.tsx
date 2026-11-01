import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "tw-inline-flex tw-items-center tw-justify-center tw-gap-1 tw-whitespace-nowrap tw-rounded-md tw-text-sm tw-font-medium tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring disabled:tw-pointer-events-none disabled:tw-opacity-50 group-[]/settings:!tw-shadow-none [&_svg]:tw-shrink-0",
  {
    variants: {
      variant: {
        default:
          "mod-cta tw-bg-interactive-accent tw-text-on-accent tw-shadow hover:tw-bg-interactive-accent-hover group-[]/settings:!tw-border-0 group-[]/settings:group-[]/extension-actions:!tw-border group-[]/settings:group-[]/extension-actions:!tw-border-solid group-[]/settings:group-[]/extension-actions:!tw-border-border group-[]/settings:!tw-bg-transparent group-[]/settings:group-[]/extension-actions:!tw-bg-[var(--text-normal)] group-[]/settings:!tw-text-normal group-[]/settings:group-[]/extension-actions:!tw-text-[var(--background-primary)] group-[]/settings:hover:!tw-bg-modifier-hover group-[]/settings:group-[]/extension-actions:hover:tw-opacity-80",
        destructive:
          "clickable-icon tw-bg-modifier-error tw-text-on-accent hover:tw-bg-modifier-error hover:tw-text-on-accent group-[]/settings:group-[]/extension-actions:!tw-border group-[]/settings:group-[]/extension-actions:!tw-border-solid group-[]/settings:group-[]/extension-actions:!tw-border-error",
        secondary:
          "tw-bg-secondary tw-text-normal tw-shadow-sm hover:tw-bg-interactive-hover group-[]/settings:!tw-border-0 group-[]/settings:group-[]/extension-actions:!tw-border group-[]/settings:group-[]/extension-actions:!tw-border-solid group-[]/settings:group-[]/extension-actions:!tw-border-border group-[]/settings:!tw-bg-transparent group-[]/settings:group-[]/extension-actions:!tw-bg-primary group-[]/settings:group-[]/extension-actions:!tw-text-normal group-[]/settings:tw-text-muted group-[]/settings:group-[]/extension-actions:hover:!tw-bg-interactive-hover group-[]/settings:hover:!tw-bg-modifier-hover group-[]/settings:hover:!tw-text-normal",
        ghost:
          "clickable-icon tw-bg-transparent hover:tw-bg-interactive-accent hover:tw-text-on-accent group-[]/settings:group-[]/extension-actions:!tw-border group-[]/settings:group-[]/extension-actions:!tw-border-solid group-[]/settings:group-[]/extension-actions:!tw-border-border group-[]/settings:!tw-bg-transparent group-[]/settings:group-[]/extension-actions:!tw-bg-primary group-[]/settings:group-[]/extension-actions:!tw-text-normal group-[]/settings:tw-text-muted group-[]/settings:group-[]/extension-actions:hover:!tw-bg-interactive-hover group-[]/settings:hover:!tw-bg-modifier-hover group-[]/settings:hover:!tw-text-normal",
        link: "tw-text-accent tw-underline-offset-4 hover:tw-underline",
        success:
          "clickable-icon tw-bg-modifier-success tw-text-on-accent hover:tw-bg-modifier-success hover:tw-text-on-accent",
        ghost2:
          "clickable-icon tw-bg-transparent tw-text-faint tw-outline-none hover:tw-bg-transparent hover:tw-bg-opacity-100 hover:tw-text-normal focus-visible:tw-text-normal focus-visible:tw-outline-none focus-visible:tw-ring-0",
      },
      size: {
        default: "tw-h-9 tw-px-4 tw-py-2",
        sm: "tw-h-6 tw-rounded-md tw-px-3 tw-text-xs",
        lg: "tw-h-10 tw-rounded-md tw-px-8",
        icon: "tw-size-7",
        fit: "tw-gap-1 tw-px-1 tw-text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
