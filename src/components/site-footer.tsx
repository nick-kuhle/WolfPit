import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-4 py-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>WolfPit · paper desk · never naked</p>
        <nav className="flex flex-wrap gap-4">
          <Link to="/trade" className="hover:text-fg">
            Desk
          </Link>
          <Link to="/pools" className="hover:text-fg">
            Pools
          </Link>
          <Link to="/stake" className="hover:text-fg">
            Stake
          </Link>
          <Link to="/plan" className="hover:text-fg">
            Plan
          </Link>
        </nav>
      </div>
    </footer>
  );
}
