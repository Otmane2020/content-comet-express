import { Link } from "@tanstack/react-router";
import { BrandLockup } from "@/components/BrandMark";


export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <BrandLockup />

          <div className="flex flex-wrap items-center justify-center gap-4 text-[12px] text-muted-foreground">
            <Link to="/blog" className="hover:text-foreground">
              Blog
            </Link>
            <span className="text-border">·</span>
            <Link to="/about" className="hover:text-foreground">
              About us
            </Link>
            <span className="text-border">·</span>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <span className="text-border">·</span>
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </div>

          <p className="text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} Ranki.ai — generative search, on autopilot.
          </p>
        </div>
      </div>
    </footer>
  );
}
