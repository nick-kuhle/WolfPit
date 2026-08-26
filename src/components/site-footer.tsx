import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-4 py-8 pb-24 lg:pb-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
        <p className="tracking-[0.18em]">WOLFPIT · term markets · never naked</p>
        <nav className="flex flex-wrap gap-4">
          <Link to="/trade" className="hover:text-fg">
            Desk
          </Link>
          <Link to="/games" className="hover:text-fg">
            Racetrack
          </Link>
          <Link to="/pools" className="hover:text-fg">
            Farms
          </Link>
          <Link to="/stake" className="hover:text-fg">
            Pools
          </Link>
          <Link to="/learn" className="hover:text-fg">
            Learn
          </Link>
          <Link to="/terms" className="hover:text-fg">
            Terms
          </Link>
          <Link to="/plan" className="hover:text-fg">
            Plan
          </Link>
          <Link to="/admin" className="hover:text-fg">
            Ops
          </Link>
        </nav>
      </div>
    </footer>
  );
}
