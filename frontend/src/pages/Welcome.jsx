import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export default function Welcome() {
  const { user } = useAuth()
  const signedIn = !!user

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-line-subtle">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 h-[57px] flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-ink text-white flex items-center justify-center text-[15px] font-semibold">A</div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tightish">AVR Hospitality Management</div>
              <div className="text-[11px] text-ink-muted">Coastal Maine</div>
            </div>
          </a>
          <nav className="flex items-center gap-2 sm:gap-6 text-[14px]">
            <a href="#services" className="hidden sm:inline text-ink-body hover:text-ink">Services</a>
            <a href="#properties" className="hidden sm:inline text-ink-body hover:text-ink">Properties</a>
            <a href="#contact" className="hidden sm:inline text-ink-body hover:text-ink">Contact</a>
            {signedIn ? (
              <Link to="/app" className="btn-primary text-[14px] px-4 py-2 min-h-0">Open dashboard</Link>
            ) : (
              <Link to="/login" className="btn-primary text-[14px] px-4 py-2 min-h-0">Client sign in</Link>
            )}
          </nav>
        </div>
      </header>

      <section id="top" className="bg-white">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-24 sm:py-32">
          <div className="text-[13px] font-medium tracking-tightish text-brand mb-4">Coastal Maine · Hospitality</div>
          <h1 className="text-[44px] sm:text-[64px] font-semibold tracking-tighter leading-[1.05] max-w-3xl text-ink">
            Hospitality management<br />on the Maine coast.
          </h1>
          <p className="mt-6 text-[18px] sm:text-[21px] text-ink-body max-w-2xl leading-relaxed tracking-tightish">
            We run hotels along the southern Maine shoreline. Three properties today,
            more on the way. Front desk, housekeeping, breakfast, grounds. All of it
            runs through our team.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to={signedIn ? '/app' : '/login'} className="btn-primary text-[15px] px-6 py-3 min-h-0">
              {signedIn ? 'Open your dashboard' : 'Client sign in'}
            </Link>
            <a href="#services" className="btn-secondary text-[15px] px-6 py-3 min-h-0">What we do</a>
          </div>
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl">
            <Stat value="3" label="Properties" />
            <Stat value="200+" label="Guest rooms" />
            <Stat value="24/7" label="Operations" />
            <Stat value="2026" label="Founded" />
          </div>
        </div>
      </section>

      <section id="about" className="bg-surface-muted">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-24 grid lg:grid-cols-[1fr,2fr] gap-12">
          <div>
            <div className="eyebrow mb-2">About</div>
            <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight text-ink">Hands-on hospitality.</h2>
          </div>
          <div className="space-y-5 text-[16px] sm:text-[17px] text-ink-body leading-relaxed">
            <p>
              We run hotels. That means every shift, every room, every coffee pot.
              The team on the floor is local, present, and answerable to us. The
              decisions get made in the lobby, not in a corporate office two states
              away.
            </p>
            <p>
              Guests notice. So do hotel owners thinking about who should run their
              property.
            </p>
          </div>
        </div>
      </section>

      <section id="services" className="bg-white">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-24">
          <div className="eyebrow mb-2">Services</div>
          <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight mb-12 max-w-2xl text-ink">
            Everything a hotel needs, in one place.
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Service title="Front desk" body="Staffed every hour of every day. Real people on the phone, real people at check-in. The little things get handled before anyone has to ask." />
            <Service title="Housekeeping" body="Rooms cleaned to the standard we would want for our own family. Daily turnover. Weekly audits on every piece of furniture and every appliance in every room." />
            <Service title="Food and beverage" body="Continental breakfast every morning. Hot dinner service for our long-stay group guests. Strong coffee, no skimping." />
            <Service title="Revenue management" body="Rates that respond to the market. Channel management across Choice, Cloudbeds, and the OTAs. Daily eyes on occupancy." />
            <Service title="Park and Fly" body="Drive in. Leave the car. Catch the shuttle to Portland Jetport in under twenty minutes. The car is waiting when you land." />
            <Service title="Operations technology" body="We built our own software to run the business. Checklists on every phone. Inventory tracked to the bottle. No paper to lose." />
          </div>
        </div>
      </section>

      <section id="properties" className="bg-surface-muted">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-24">
          <div className="eyebrow mb-2">Properties</div>
          <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight mb-12 max-w-2xl text-ink">
            Three hotels. Two open. One on the way.
          </h2>
          <div className="grid lg:grid-cols-3 gap-4">
            <Property
              name="Casco Bay Hotel"
              location="South Portland, ME"
              brand="Choice Hotels · Ascend Collection"
              status="Operational"
              body="Boutique hotel three miles from Portland Jetport. Anchored by long-stay group contracts and our Park and Fly parking program."
            />
            <Property
              name="Saco Bay Hotel"
              location="Saco, ME"
              brand="Independent"
              status="Operational"
              body="Full-service hotel near Old Orchard Beach. Business travelers Monday through Thursday. Families through the summer."
            />
            <Property
              name="TownePlace Suites and Fairfield Inn"
              location="Saco, ME"
              brand="Marriott · Dual-brand"
              status="Under construction"
              body="Two Marriott brands under one roof. Extended-stay suites and select-service rooms. Opening in the next development cycle."
            />
          </div>
        </div>
      </section>

      <section id="contact" className="bg-white">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-24 grid lg:grid-cols-2 gap-12">
          <div>
            <div className="eyebrow mb-2">Contact</div>
            <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight text-ink">Talk to us.</h2>
            <p className="mt-5 text-[16px] sm:text-[17px] text-ink-body leading-relaxed max-w-md">
              If you own hotels, operate hotels, or are thinking about partnering
              with us, reach out anytime. If you are a guest, the front desk at the
              property can help you faster than we can.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <ContactCard label="General inquiries" value="info@avrhospitality.com" href="mailto:info@avrhospitality.com" />
            <ContactCard label="Existing clients" value={signedIn ? 'Open dashboard →' : 'Sign in →'} href={signedIn ? '/app' : '/login'} internal />
          </div>
        </div>
      </section>

      <footer className="border-t border-line-subtle bg-surface-muted">
        <div className="container mx-auto max-w-6xl px-5 sm:px-8 py-8 flex flex-wrap items-center justify-between gap-4 text-[12px] text-ink-muted">
          <div>© {new Date().getFullYear()} AVR Hospitality Management. All rights reserved.</div>
          <div className="flex gap-5">
            <a href="#top" className="hover:text-ink">Top</a>
            <Link to="/login" className="hover:text-ink">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Stat({ value, label }) {
  return (
    <div>
      <div className="text-[40px] sm:text-[48px] font-semibold tracking-tight text-ink leading-none tabular-nums">{value}</div>
      <div className="text-[13px] font-medium text-ink-muted mt-3">{label}</div>
    </div>
  )
}

function Service({ title, body }) {
  return (
    <div className="card hover:shadow-elevated transition-shadow">
      <h3 className="text-[17px] font-semibold tracking-tightish mb-2 text-ink">{title}</h3>
      <p className="text-[14px] text-ink-body leading-relaxed">{body}</p>
    </div>
  )
}

function Property({ name, location, brand, status, body }) {
  const statusBadge = status === 'Operational' ? 'badge-positive' : 'badge-warning'
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-[17px] font-semibold tracking-tightish text-ink">{name}</h3>
          <div className="text-[14px] text-ink-muted mt-0.5">{location}</div>
        </div>
        <span className={`${statusBadge} flex-shrink-0`}>{status}</span>
      </div>
      <div className="text-[12px] font-medium text-ink-muted mb-3">{brand}</div>
      <p className="text-[14px] text-ink-body leading-relaxed">{body}</p>
    </div>
  )
}

function ContactCard({ label, value, href, internal }) {
  const content = (
    <div className="card hover:shadow-elevated transition-shadow">
      <div className="text-[12px] font-medium text-ink-muted mb-1">{label}</div>
      <div className="text-ink font-medium text-[15px]">{value}</div>
    </div>
  )
  if (!href) return content
  if (internal) return <Link to={href}>{content}</Link>
  return <a href={href}>{content}</a>
}
