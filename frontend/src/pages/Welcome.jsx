import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export default function Welcome() {
  const { user } = useAuth()
  const signedIn = !!user

  return (
    <div className="min-h-screen bg-ink-950 text-text-primary">
      <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-950/85 backdrop-blur">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-teal flex items-center justify-center font-display text-lg font-semibold">A</div>
            <div>
              <div className="font-display font-semibold leading-none">AVR Hospitality Management</div>
              <div className="tag mt-0.5">Saish LLC</div>
            </div>
          </a>
          <nav className="flex items-center gap-2 sm:gap-5 text-sm">
            <a href="#services" className="hidden sm:inline text-text-secondary hover:text-text-primary">Services</a>
            <a href="#properties" className="hidden sm:inline text-text-secondary hover:text-text-primary">Properties</a>
            <a href="#contact" className="hidden sm:inline text-text-secondary hover:text-text-primary">Contact</a>
            {signedIn ? (
              <Link to="/app" className="btn-primary text-sm px-4 py-2 min-h-0">Open dashboard</Link>
            ) : (
              <Link to="/login" className="btn-primary text-sm px-4 py-2 min-h-0">Client sign in</Link>
            )}
          </nav>
        </div>
      </header>

      <section id="top" className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-30 [background-image:radial-gradient(ellipse_at_top,rgba(45,142,114,0.35),transparent_55%)]"></div>
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28 relative">
          <div className="tag text-accent-teal mb-4">Coastal Maine · Hospitality operations</div>
          <h1 className="font-display text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05] max-w-3xl">
            Modern hotel operations, end to end.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-text-body max-w-2xl leading-relaxed">
            AVR Hospitality Management runs guest-facing and back-of-house operations
            for select-service and extended-stay hotels along the Maine coast — front
            desk, housekeeping, revenue, food &amp; beverage, and the technology that
            ties it all together.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={signedIn ? '/app' : '/login'} className="btn-primary px-6 py-3 min-h-0 text-base">
              {signedIn ? 'Open your dashboard →' : 'Client sign in →'}
            </Link>
            <a href="#services" className="btn-secondary px-6 py-3 min-h-0 text-base">What we do</a>
          </div>
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl">
            <Stat value="3" label="Properties" />
            <Stat value="200+" label="Guest rooms" />
            <Stat value="24/7" label="Operations" />
            <Stat value="2014" label="Founded" />
          </div>
        </div>
      </section>

      <section id="about" className="border-t border-ink-700 bg-ink-900">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-16 sm:py-20 grid lg:grid-cols-[1fr,2fr] gap-10">
          <div>
            <div className="tag mb-2">About</div>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold">A family operator with an engineer's mindset.</h2>
          </div>
          <div className="space-y-5 text-text-body leading-relaxed">
            <p>
              AVR Hospitality Management is the operating arm of Saish LLC, founded by
              Rohit Srungavarapu, Abhijit Srungavarapu, and Vasu Danda. We own and
              operate hotels in southern Maine and are actively expanding our portfolio
              with new development.
            </p>
            <p>
              We treat operations as a system. Front desk, housekeeping, breakfast,
              maintenance, and grounds all run on shared digital tooling — checklists,
              inventory, room audits, shift handoffs — replacing the binders and paper
              sheets that hospitality has run on for decades.
            </p>
            <p>
              The result is a hotel that's easier to run on the worst days, more
              consistent on the best, and steadily improving in between.
            </p>
          </div>
        </div>
      </section>

      <section id="services" className="border-t border-ink-700">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-16 sm:py-20">
          <div className="tag mb-2">Services</div>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold mb-12 max-w-2xl">
            Full-service hotel management, with the technology to back it up.
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Service title="Front-of-house" body="24/7 staffed front desk, guest services, reservations, and brand-program coordination across Choice and Marriott." />
            <Service title="Housekeeping" body="Room turnover, linen and amenity management, weekly equipment audits, and maintenance ticketing." />
            <Service title="Food &amp; beverage" body="Continental breakfast and evening dinner programs, including specialty operations like the MEPS military lodging contract." />
            <Service title="Revenue management" body="Rate strategy, channel management, and PMS integration with Cloudbeds and Choice Advantage. Daily occupancy, ADR, and RevPAR reporting." />
            <Service title="Park &amp; Fly" body="Off-airport parking and shuttle programs for travelers flying out of Portland International Jetport (PWM)." />
            <Service title="Operations technology" body="Proprietary operations platform that replaces paper-and-pen processes — shift checklists, inventory, room audits, and shift handoff notes — across every property." />
          </div>
        </div>
      </section>

      <section id="properties" className="border-t border-ink-700 bg-ink-900">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-16 sm:py-20">
          <div className="tag mb-2">Properties</div>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold mb-12 max-w-2xl">
            Three hotels and growing, all in southern Maine.
          </h2>
          <div className="grid lg:grid-cols-3 gap-4">
            <Property
              name="Casco Bay Hotel"
              location="South Portland, ME"
              brand="Choice Hotels · Ascend Collection"
              status="Operational"
              accent="teal"
              body="Boutique-flagged hotel on Maine Mall Road, three miles from Portland Jetport. Home to our MEPS military lodging contract and Park &amp; Fly program."
            />
            <Property
              name="Saco Bay Hotel"
              location="Saco, ME"
              brand="Independent (formerly Ramada by Wyndham)"
              status="Operational"
              accent="amber"
              body="Recently rebranded full-service property serving Old Orchard Beach corridor business and leisure travel."
            />
            <Property
              name="TownePlace Suites &amp; Fairfield Inn"
              location="Saco, ME"
              brand="Marriott · Dual-brand"
              status="Under construction"
              accent="blue"
              body="Dual-branded extended-stay and select-service Marriott hotel scheduled to open in the next development cycle."
            />
          </div>
        </div>
      </section>

      <section id="contact" className="border-t border-ink-700">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-16 sm:py-20 grid lg:grid-cols-2 gap-10">
          <div>
            <div className="tag mb-2">Contact</div>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold">Talk to us.</h2>
            <p className="mt-5 text-text-body leading-relaxed max-w-md">
              Owners, operators, and prospective partners — reach out anytime. For
              guests, please contact the property directly.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <ContactCard label="Front desk · Casco Bay" value="(207) 772-3838" href="tel:+12077723838" />
            <ContactCard label="General inquiries" value="info@avrhospitality.com" href="mailto:info@avrhospitality.com" />
            <ContactCard label="Mailing address" value="South Portland, Maine" />
            <ContactCard label="Existing clients" value={signedIn ? 'Open dashboard' : 'Sign in →'} href={signedIn ? '/app' : '/login'} internal />
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-700 bg-ink-950">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-8 flex flex-wrap items-center justify-between gap-4 text-xs text-text-muted font-mono">
          <div>© {new Date().getFullYear()} Saish LLC, dba AVR Hospitality Management. All rights reserved.</div>
          <div className="flex gap-4">
            <a href="#top" className="hover:text-text-primary">Top</a>
            <Link to="/login" className="hover:text-text-primary">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Stat({ value, label }) {
  return (
    <div>
      <div className="font-display text-4xl sm:text-5xl font-semibold text-accent-teal leading-none">{value}</div>
      <div className="tag mt-2">{label}</div>
    </div>
  )
}

function Service({ title, body }) {
  return (
    <div className="card hover:border-ink-600 transition-colors">
      <h3 className="font-display text-lg font-semibold mb-2" dangerouslySetInnerHTML={{ __html: title }} />
      <p className="text-sm text-text-body leading-relaxed" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  )
}

function Property({ name, location, brand, status, accent, body }) {
  const statusColor = status === 'Operational'
    ? 'bg-accent-teal/15 text-accent-teal'
    : 'bg-accent-amber/15 text-accent-amber'
  const accentBar = {
    teal: 'bg-accent-teal',
    amber: 'bg-accent-amber',
    blue: 'bg-accent-blue',
  }[accent] || 'bg-accent-teal'
  return (
    <div className="card relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentBar}`}></div>
      <div className="pl-3">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-display text-lg font-semibold" dangerouslySetInnerHTML={{ __html: name }} />
            <div className="text-sm text-text-secondary">{location}</div>
          </div>
          <span className={`badge ${statusColor} flex-shrink-0`}>{status}</span>
        </div>
        <div className="tag mb-3">{brand}</div>
        <p className="text-sm text-text-body leading-relaxed" dangerouslySetInnerHTML={{ __html: body }} />
      </div>
    </div>
  )
}

function ContactCard({ label, value, href, internal }) {
  const content = (
    <div className="card hover:border-ink-600 transition-colors h-full">
      <div className="tag mb-1">{label}</div>
      <div className="text-text-primary font-medium">{value}</div>
    </div>
  )
  if (!href) return content
  if (internal) return <Link to={href}>{content}</Link>
  return <a href={href}>{content}</a>
}
