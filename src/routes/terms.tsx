import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { TERMS_VERSION } from "@/lib/wolfpit/terms";

export const Route = createFileRoute("/terms")({ component: TermsPage });

function TermsPage() {
  return (
    <Shell>
      <article className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-muted">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Legal · clickwrap</p>
        <h1 className="mt-2 font-display text-4xl font-medium tracking-tight text-fg">Terms of Use</h1>
        <p className="mt-2 text-xs">WolfPit Labs · Effective and last revised {TERMS_VERSION} · Version {TERMS_VERSION}</p>

        <P>
          These Terms of Use (the “Terms”) constitute a legally binding agreement between you (“you,” “user”) and
          WolfPit Labs and its affiliates (the “Company,” “we,” “us”) governing access to and use of the WolfPit
          websites, applications, smart-contract interfaces, documentation, and related services (collectively, the
          “Platform”). By clicking “I agree,” checking a box, creating a session, or using the desk, pools, farms, or
          stake features, you execute these Terms as an electronic signature under the U.S. Electronic Signatures in
          Global and National Commerce Act and comparable law.
        </P>

        <H>1. Eligibility</H>
        <P>
          You represent that you are at least eighteen (18) years of age and have the legal capacity to enter a
          binding contract. You will not access the Platform if you are a person or entity on any sanctions list
          administered by OFAC, the UN, the EU, or the UK, or if you are located in a comprehensively sanctioned
          jurisdiction. The Company may geo-fence products. You will not use a VPN or other means to circumvent
          access controls.
        </P>

        <H>2. Simulation; paper funds; no real-money venue (v1)</H>
        <P>
          THE PLATFORM IS PRESENTLY A SIMULATION AND EDUCATIONAL INTERFACE. Paper balances (including without
          limitation one thousand (1,000) units of ETH and one hundred thousand (100,000) units of USDC), fills,
          marks, options premia, futures P&L, farm emissions, staking APR, insurance, and liquidations are
          simulated, may be reset, and do not represent custody of, title to, or a claim on any real digital asset,
          fiat currency, or security. Test tokens (including WPIT, WOLFPIT-USDC-TEST, and WOLFPIT-ETH-TEST) have no
          cash value. Simulated performance is not an indicator of future live-market results. When the Company, if
          ever, enables live settlement, additional terms, licenses, and disclosures will be required; these Terms do
          not constitute an offer to provide a live derivatives exchange.
        </P>

        <H>3. Not advice; no fiduciary</H>
        <P>
          Nothing on the Platform is investment, legal, tax, or trading advice, or a recommendation to buy, sell, or
          hold any instrument. The Company is not your broker, dealer, CFTC-registered DCM or SEF, NFA member,
          investment adviser, or fiduciary. You alone are responsible for your decisions.
        </P>

        <H>4. Products</H>
        <P>
          Spot interfaces display constant-product automated market maker (“AMM”) logic. “Mini” futures are dated,
          inventory-backed, cash-settled contracts with expiry, not perpetual swaps. “Mini” options are European,
          cash-settled calls and puts. The protocol does not sell uncovered (“naked”) short options. Quotes may
          blank, widen, or halt when inventory, utilization, insurance, or circuit-breaker rules so require. Farms
          and staking, if shown, describe simulated emissions and a junior first-loss relationship to an insurance
          account; they are not deposits, notes, or guaranteed yield.
        </P>

        <H>5. Prohibited use</H>
        <P>
          You will not: (a) violate law; (b) manipulate marks, oracles, or the paper engine; (c) attack, scrape
          beyond reasonable use, or reverse engineer except as allowed by law; (d) impersonate the Company; (e)
          use the Platform to advertise live trading of unregistered securities; (f) interfere with other users.
        </P>

        <H>6. Intellectual property</H>
        <P>
          The Platform, WolfPit name, pit seal, and documentation are owned by the Company or its licensors. You
          receive a limited, revocable, non-exclusive, non-transferable license to use the Platform for personal,
          lawful, non-commercial simulation. You retain rights in content you submit; you grant us a license to
          operate the service.
        </P>

        <H>7. Assumption of risk</H>
        <P>
          Digital assets and derivatives are volatile. Smart contracts may contain bugs. Oracles and public price
          feeds may fail, lag, or be manipulated. You may lose the entire value of any live funds you later choose
          to deploy. Simulated APYs can be reduced, taxed, or set to zero. You assume all risk of use.
        </P>

        <H>8. No warranty</H>
        <P>
          THE PLATFORM IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
          INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT
          WARRANT UNINTERRUPTED, ERROR-FREE, OR SECURE OPERATION, OR THAT SIMULATED MARKS MATCH ANY EXCHANGE.
        </P>

        <H>9. Limitation of liability</H>
        <P>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE COMPANY AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND SUPPLIERS
          SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES,
          OR ANY LOSS OF PROFITS, DATA, OR GOODWILL. THE COMPANY’S AGGREGATE LIABILITY ARISING OUT OF THE PLATFORM
          SHALL NOT EXCEED ONE HUNDRED U.S. DOLLARS (US $100) OR THE AMOUNT YOU PAID US IN THE TWELVE MONTHS BEFORE
          THE CLAIM, WHICHEVER IS GREATER. SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS; IN THOSE
          JURISDICTIONS, OUR LIABILITY IS LIMITED TO THE FULLEST EXTENT PERMITTED.
        </P>

        <H>10. Indemnity</H>
        <P>
          You will indemnify and hold harmless the Company from any claim, damage, or expense (including reasonable
          attorneys’ fees) arising out of your use of the Platform, your violation of these Terms, or your violation
          of any third-party right.
        </P>

        <H>11. Privacy</H>
        <P>
          We collect account identifiers, device data, and simulation state as needed to operate the Platform.
          Wallet addresses you later connect are public blockchain data. Do not send us sensitive personal
          information through the desk.
        </P>

        <H>12. Dispute resolution; arbitration; class waiver</H>
        <P>
          You and the Company agree that any dispute arising out of these Terms or the Platform shall be resolved by
          binding individual arbitration administered by JAMS under its Streamlined Arbitration Rules, in the
          English language, seated in Wilmington, Delaware. YOU WAIVE ANY RIGHT TO A JURY TRIAL AND TO PARTICIPATE
          IN A CLASS, COLLECTIVE, OR REPRESENTATIVE ACTION. Either party may seek injunctive relief in court for
          intellectual-property or unauthorized-access claims. You may opt out of arbitration within thirty (30)
          days of first accepting these Terms by writing to legal@wolfpit.invalid with subject “Arbitration opt-out.”
        </P>

        <H>13. Governing law</H>
        <P>
          These Terms are governed by the laws of the State of Delaware, excluding conflict-of-laws rules. The U.N.
          Convention on Contracts for the International Sale of Goods does not apply.
        </P>

        <H>14. Changes; termination</H>
        <P>
          We may modify these Terms by posting a new version. Material changes apply after notice (in-product or on
          this page). Continued use after the effective date is acceptance. We may suspend or terminate access at
          any time. Sections 6–13 survive termination.
        </P>

        <H>15. Miscellaneous</H>
        <P>
          These Terms are the entire agreement on their subject. If a provision is unenforceable, the remainder
          stays in force. You may not assign these Terms without our consent; we may assign them. No waiver is
          implied by delay. Headings are for convenience only. Notices to the Company: legal@wolfpit.invalid.
        </P>

        <p className="mt-10 text-xs text-subtle">
          Contact: legal@wolfpit.invalid · Not an offer to sell securities or commodity interests.
        </p>
      </article>
      <SiteFooter />
    </Shell>
  );
}

function H({ children }: { children: string }) {
  return <h2 className="mt-8 text-base font-medium text-fg">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mt-3">{children}</p>;
}
