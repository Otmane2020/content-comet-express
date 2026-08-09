export function BrandMark({ className = "size-9" }: { className?: string }) {
  return (
    <span
      className={`deep-plate inline-flex items-center justify-center rounded-xl ring-1 ring-gold/40 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-1/2" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path
          d="M12 2.5 13.9 9.3 20.5 11.5 13.9 13.7 12 20.5 10.1 13.7 3.5 11.5 10.1 9.3Z"
          strokeLinejoin="round"
          className="text-gold"
        />
        <path d="M18.5 3.5 19.3 6 21.5 6.8 19.3 7.6 18.5 10 17.7 7.6 15.5 6.8 17.7 6Z" className="text-gold" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function BrandLockup({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="leading-none">
        <span className="block text-[9.5px] font-bold tracking-[0.18em] text-gold">GENERATIVE SEARCH</span>
        <span
          className={`block font-display text-[17px] font-bold ${dark ? "text-background" : "text-foreground"}`}
        >
          Ranki.ai
        </span>
      </span>
    </span>
  );
}