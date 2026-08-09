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

          <div className="text-[12px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">AutoPilot Geo Ltd</p>
            <p>Suite 4, Piccadilly House</p>
            <p>Manchester, M1 1AB</p>
            <p>United Kingdom</p>
            <p className="mt-1">
              <a href="mailto:support@autopilotgeo.com" className="hover:text-foreground">
                support@autopilotgeo.com
              </a>
            </p>
          </div>

          <p className="text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} AutopilotGEO — generative search, on autopilot.
          </p>
        </div>
      </div>
    </footer>
  );
}
