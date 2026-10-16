import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ChartNoAxesCombined, Check, ChevronDown, Factory, GraduationCap, Menu, Recycle, ShieldCheck, Smartphone, Users, X } from 'lucide-react';
import logo from '../assets/public/baliktelaph.png';
import hero from '../assets/public/circular-textiles-hero.jpg';
import dost from '../assets/public/dost.jpg';
import pchrd from '../assets/public/pchrd.png';
import university from '../assets/public/national-university.png';
import materialStudy from '../assets/auth/textile-study.jpg';
import { communities, pathways, publicFaqs } from '../data/publicContent';
import { mobileAppUrl } from '../lib/siteRoutes';
import { PublicDialog } from '../components/PublicDialog';
import '../styles/home.css';

const links = [['About', '#about'], ['How it works', '#how-it-works'], ['The community', '#community'], ['FAQs', '#faqs']] as const;
const communityIcons = { people: Users, producer: Factory, recycler: Recycle, research: GraduationCap };
const appUrl = mobileAppUrl(import.meta.env.VITE_MOBILE_APP_URL || 'https://baliktelaprogressive.vercel.app/');

export default function HomePage({ notFound = false }: { notFound?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'mobile' | 'privacy' | null>(null);
  const [pathway, setPathway] = useState(0);
  const [faq, setFaq] = useState<number | null>(0);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = pathways[pathway];

  useEffect(() => {
    document.title = notFound ? 'Page not found | BalikTelaPH' : 'BalikTelaPH | A new chapter for every thread';
    if (notFound || matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { entry.target.setAttribute('data-reveal', 'visible'); observer.unobserve(entry.target); } });
    }, { threshold: 0.12 });
    root.current?.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [notFound]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('public-menu-toggle')?.focus(); } };
    const media = matchMedia('(min-width: 960px)');
    const resize = () => { if (media.matches) setMenuOpen(false); };
    window.addEventListener('keydown', close);
    media.addEventListener('change', resize);
    return () => { window.removeEventListener('keydown', close); media.removeEventListener('change', resize); };
  }, [menuOpen]);

  const appButton = (label = 'Open the mobile app', secondary = false) => {
    const content = <><Smartphone size={17} aria-hidden="true" />{label}<ArrowUpRight size={17} aria-hidden="true" /></>;
    const className = `home-button${secondary ? ' home-button-outline' : ''}`;
    return appUrl ? <a className={className} href={appUrl} target="_blank" rel="noopener noreferrer">{content}<span className="sr-only"> (opens in a new tab)</span></a> : <button type="button" className={className} onClick={() => setDialog('mobile')}>{content}</button>;
  };
  const switchTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % pathways.length : event.key === 'ArrowLeft' ? (index + pathways.length - 1) % pathways.length : event.key === 'Home' ? 0 : event.key === 'End' ? pathways.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setPathway(next); tabs.current[next]?.focus();
  };

  return <div ref={root} className="home-page">
    <a className="home-skip" href="#main-content">Skip to content</a>
    <header className="home-header">
      <div className="home-container home-nav">
        <a href="/" className="home-brand" aria-label="BalikTelaPH home"><img src={logo} alt="" width={256} height={256} /><span>BalikTela<span className="home-brand-ph">PH</span><small>Circular Textile Network</small></span></a>
        <nav className="home-desktop-nav" aria-label="Main navigation">{links.map(([label, href]) => <a key={href} href={notFound ? `/${href}` : href}>{label}</a>)}</nav>
        <a className="home-dashboard-link" href="/login">Web dashboard<ArrowUpRight size={16} aria-hidden="true" /></a>
        <button type="button" id="public-menu-toggle" className="home-icon-button home-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="public-mobile-menu" onClick={() => setMenuOpen(open => !open)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
      {menuOpen ? <nav id="public-mobile-menu" className="home-mobile-nav" aria-label="Mobile navigation">{links.map(([label, href]) => <a key={href} href={notFound ? `/${href}` : href} onClick={() => setMenuOpen(false)}>{label}<ArrowUpRight size={16} /></a>)}<a href="/login">Web dashboard<ArrowUpRight size={16} /></a></nav> : null}
    </header>

    {notFound ? <main id="main-content" className="home-container home-not-found"><p className="home-eyebrow">404 / PAGE NOT FOUND</p><h1>This thread leads elsewhere.</h1><p>The page you are looking for could not be found.</p><a className="home-button" href="/">Back to BalikTelaPH<ArrowRight size={17} /></a></main> : <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <img className="home-hero-image" src={hero} alt="Denim, cotton offcuts, and a carefully repaired patchwork textile on a light work surface. Illustrative textile study." width={1672} height={941} fetchPriority="high" />
        <div className="home-container home-hero-inner">
          <div className="home-hero-copy"><p className="home-eyebrow"><span className="home-small-rule" />CIRCULAR TEXTILES. CONNECTED COMMUNITIES.</p><h1 id="home-title">BalikTela<span>PH</span></h1><p className="home-hero-line">A new chapter<br />for every thread.</p><p className="home-hero-description">Connecting people, producers, and recyclers to keep textiles in use, and possibilities open.</p><div className="home-actions">{appButton()}<a className="home-text-link" href="/login">Explore the web dashboard<ArrowUpRight size={17} aria-hidden="true" /></a></div><p className="home-hero-note">A research-led circular textile initiative in the Philippines.</p></div>
          <a className="home-explore" href="#about"><ArrowDown size={16} aria-hidden="true" />Follow the thread</a>
          <span className="home-photo-note">Illustrative material study</span>
        </div>
      </section>

      <section className="home-institutions" aria-label="Project institutions">
        <div className="home-container home-institutions-inner"><p>Research-led.<br /><strong>Community-minded.</strong></p><div className="home-institution-logos">
          <a href="https://www.dost.gov.ph/" target="_blank" rel="noopener noreferrer" className="home-institution-dost" aria-label="DOST - Department of Science and Technology (opens in a new tab)"><img src={dost} alt="DOST" width={140} height={140} /></a>
          <a href="https://www.pchrd.dost.gov.ph/" target="_blank" rel="noopener noreferrer" className="home-institution-pchrd" aria-label="DOST-PCHRD (opens in a new tab)"><img src={pchrd} alt="Philippine Council for Health Research and Development" width={540} height={270} /></a>
          <a href="https://www.nu.edu.ph/" target="_blank" rel="noopener noreferrer" className="home-institution-nu" aria-label="National University (opens in a new tab)"><img src={university} alt="National University" width={500} height={281} /></a>
        </div><span className="home-institutions-label">Project institutions</span></div>
      </section>

      <section id="about" className="home-container home-section home-about">
        <div className="home-section-intro" data-reveal><div><p className="home-eyebrow">01 / A SHARED PURPOSE</p><h2>Textiles have<br /><span className="home-serif">more to give.</span></h2></div><div className="home-about-copy"><p>A piece of fabric can outlive its first purpose. What it needs is a connection to its next one.</p><p>BalikTelaPH is a National University research initiative bringing textile producers, recyclers, and beneficiaries together. A mobile application makes participation accessible, while a web dashboard turns recorded activity into information for monitoring, research, and better decisions.</p><a className="home-text-link" href="#platforms">One network. Two ways to connect.<ArrowRight size={17} aria-hidden="true" /></a></div></div>
        <div className="home-principles" data-reveal>{[['Keep materials in use', 'Make room for reuse, redistribution, upcycling, and responsible recovery.'], ['Connect the right people', 'Bring households, businesses, recovery partners, and institutions into the same conversation.'], ['Make outcomes visible', 'Document material journeys so participation can become evidence, not just a promise.']].map(([title, description], index) => <article key={title}><span className="home-number">0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>

      <section id="how-it-works" className="home-pathways home-section">
        <div className="home-container">
          <div className="home-section-heading" data-reveal><div><p className="home-eyebrow">02 / HOW THE THREAD CONTINUES</p><h2>Not the end.<br /><span className="home-serif">A different beginning.</span></h2></div><p>Different materials need different pathways.<br />Start with what you have.</p></div>
          <div className="home-path-layout" data-reveal>
            <figure className="home-material-photo"><img src={materialStudy} alt="Illustrative material study of washed denim, cotton, and textile offcuts." width={1122} height={1402} loading="lazy" decoding="async" /><figcaption><span>MATERIALS WITH POSSIBILITIES</span><span>Illustrative textile study</span></figcaption></figure>
            <div className="home-path-content"><div className="home-path-tabs" role="tablist" aria-label="Textile pathways">{pathways.map((item, index) => <button ref={element => { tabs.current[index] = element; }} type="button" role="tab" key={item.id} id={`path-tab-${item.id}`} aria-controls={`path-panel-${item.id}`} aria-selected={pathway === index} tabIndex={pathway === index ? 0 : -1} onClick={() => setPathway(index)} onKeyDown={event => switchTab(event, index)}>{item.label}</button>)}</div>
              <div key={current.id} id={`path-panel-${current.id}`} role="tabpanel" aria-labelledby={`path-tab-${current.id}`} tabIndex={0} className="home-path-panel"><h3>{current.title}</h3><p>{current.description}</p><ol className="home-path-steps">{current.steps.map(([title, description], index) => <li key={title}><span>0{index + 1}</span><div><h4>{title}</h4><p>{description}</p></div>{index < 2 ? <ArrowDown size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}</li>)}</ol></div>
              {appUrl ? <a className="home-text-link" href={appUrl} target="_blank" rel="noopener noreferrer">Find your pathway in the app<ArrowUpRight size={17} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : <button type="button" className="home-text-link" onClick={() => setDialog('mobile')}>Find your pathway in the app<ArrowUpRight size={17} aria-hidden="true" /></button>}
            </div>
          </div>
        </div>
      </section>

      <section id="platforms" className="home-container home-section">
        <div className="home-section-heading" data-reveal><div><p className="home-eyebrow">03 / ONE CONNECTED NETWORK</p><h2>Take part.<br /><span className="home-serif">See the bigger picture.</span></h2></div><p>A place for everyday action.<br />A workspace for informed decisions.</p></div>
        <div className="home-platforms" data-reveal>
          <article className="home-platform"><div className="home-platform-label"><Smartphone size={21} aria-hidden="true" /><span>FOR PARTICIPATION</span></div><h3>The mobile app</h3><p>Put your textiles back into circulation. Connect with people and partners who can give them a new purpose.</p><ul>{['List textile items and explore suitable exchanges', 'Coordinate offers and communicate with participants', 'Keep track of handovers and your participation'].map(text => <li key={text}><Check size={16} aria-hidden="true" />{text}</li>)}</ul>{appButton('Mobile app access')}<span className="home-platform-footnote">For consumers, communities, and participating organizations.</span></article>
          <article className="home-platform"><div className="home-platform-label"><ChartNoAxesCombined size={21} aria-hidden="true" /><span>FOR INSTITUTIONAL INSIGHT</span></div><h3>The web dashboard</h3><p>Turn material-flow records into a clearer view of participation, recovery, and the decisions that come next.</p><ul>{['Monitor material flows and traceable transactions', 'Review regional activity and stakeholder participation', 'Support administration, governance, and research'].map(text => <li key={text}><Check size={16} aria-hidden="true" />{text}</li>)}</ul><a className="home-button home-button-outline" href="/login">Open web dashboard<ArrowUpRight size={17} aria-hidden="true" /></a><span className="home-platform-footnote"><ShieldCheck size={14} aria-hidden="true" />Approved institutional accounts. Role-based access.</span></article>
        </div>
      </section>

      <section id="community" className="home-community home-section"><div className="home-container">
        <div className="home-section-heading" data-reveal><div><p className="home-eyebrow">04 / CIRCULARITY IS A COLLECTIVE EFFORT</p><h2>Different roles.<br /><span className="home-serif">A common thread.</span></h2></div><p>From the fabric you no longer need<br />to the systems that help it find a future.</p></div>
        <div className="home-community-grid" data-reveal>{communities.map(item => { const Icon = communityIcons[item.icon]; return <article key={item.title}><Icon size={24} strokeWidth={1.4} aria-hidden="true" /><h3>{item.title}</h3><p>{item.description}</p><span>{item.channel}</span></article>; })}</div>
      </div></section>

      <section className="home-research"><div className="home-container home-research-inner" data-reveal><div><p className="home-eyebrow">BUILT ON PARTICIPATION. GROUNDED IN EVIDENCE.</p><h2>Good intentions matter.<br /><span className="home-serif">So does knowing what happens next.</span></h2><p>Documenting a textile's journey helps the project understand what is reused, what is recovered, and where support is still needed.</p><a className="home-text-link" href="https://www.ellenmacarthurfoundation.org/topics/fashion/overview" target="_blank" rel="noopener noreferrer">Explore circular textiles<ArrowUpRight size={17} aria-hidden="true" /><span className="sr-only"> (Ellen MacArthur Foundation, opens in a new tab)</span></a></div><div className="home-research-notes">{[['Trace the journey', 'Listing, transfer, receipt, and validated outcomes are different steps, not interchangeable totals.'], ['Understand the context', 'Participation and material flows are interpreted within their time period, geographic area, and authorized data scope.'], ['Measure responsibly', 'Environmental equivalents need approved methods. Synthetic development figures are not real-world impact claims.']].map(([title, text], index) => <article key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></div></section>

      <section id="faqs" className="home-container home-section home-faqs"><div data-reveal><p className="home-eyebrow">A FEW THINGS WORTH KNOWING</p><h2>Let's untangle<br /><span className="home-serif">the details.</span></h2><p className="home-faq-intro">The project, the platforms,<br />and where you fit in.</p></div><div className="home-faq-list" data-reveal>{publicFaqs.map(([question, answer], index) => <div key={question} className="home-faq-item"><h3><button type="button" aria-expanded={faq === index} aria-controls={`faq-answer-${index}`} id={`faq-question-${index}`} onClick={() => setFaq(faq === index ? null : index)}>{question}<ChevronDown size={18} aria-hidden="true" /></button></h3><div id={`faq-answer-${index}`} role="region" aria-labelledby={`faq-question-${index}`} hidden={faq !== index}><p>{answer}</p></div></div>)}</div></section>

      <section className="home-final"><div className="home-container home-final-inner" data-reveal><div><p className="home-eyebrow">THERE'S MORE TO THIS THREAD.</p><h2>Be part of<br /><span className="home-serif">what comes next.</span></h2></div><div><p>Bring your textiles, your expertise,<br />or your perspective. Start here.</p><div className="home-actions">{appButton()}<a className="home-text-link" href="/login">Web dashboard<ArrowUpRight size={17} aria-hidden="true" /></a></div></div></div></section>
    </main>}

    <footer className="home-footer"><div className="home-container"><div className="home-footer-top"><a href="/" className="home-brand" aria-label="BalikTelaPH home"><img src={logo} alt="" width={256} height={256} /><span>BalikTelaPH<small>Circular textiles. Connected communities.</small></span></a><nav aria-label="Footer navigation"><a href="/#about">The project</a><a href="/#platforms">The platforms</a><a href="/#faqs">FAQs</a><a href="/login">Dashboard<ArrowUpRight size={14} aria-hidden="true" /></a></nav></div><div className="home-footer-bottom"><p>© {new Date().getFullYear()} BalikTelaPH. A National University research initiative.</p><span>Research & pilot development</span><button type="button" onClick={() => setDialog('privacy')}>Privacy & access</button></div></div></footer>

    {dialog ? <PublicDialog title={dialog === 'mobile' ? 'Your next chapter starts here.' : 'Privacy & platform access'} onClose={() => setDialog(null)}>{dialog === 'mobile' ? <div className="home-mobile-access"><Smartphone size={28} strokeWidth={1.4} aria-hidden="true" /><p className="home-eyebrow">BALIKTELAPH MOBILE</p><h3>{appUrl ? 'Connect through the mobile app.' : 'Mobile app access'}</h3><p>{appUrl ? 'Continue to the project\'s distribution page for the current mobile release and installation details.' : 'The mobile app is being prepared for project participants. An approved public download link has not been published on this website yet.'}</p>{appUrl ? <a className="home-button" href={appUrl} target="_blank" rel="noopener noreferrer">Open app download page<ArrowUpRight size={17} /><span className="sr-only"> (opens in a new tab)</span></a> : <div className="home-pilot-note"><strong>Already part of the pilot?</strong><p>Ask your project coordinator for the current mobile build and onboarding instructions.</p></div>}<button type="button" className="home-text-link" onClick={() => { setDialog(null); document.getElementById('how-it-works')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}>Explore how it works<ArrowRight size={17} /></button></div> : <div className="home-privacy"><p>This public homepage introduces the project. It does not display private participant profiles, transaction records, or live dashboard statistics.</p><h3>Institutional access</h3><p>The dashboard requires an approved account. Access is limited by role and assigned scope. Invitations and password recovery are handled through the existing secure authentication process.</p><h3>Research participation</h3><p>Consent, data use, and pilot eligibility should be confirmed with the project team before participating. This summary is not a substitute for the project's participant information and consent documents.</p><h3>Illustrative imagery</h3><p>Textile photographs on this page are AI-generated material studies, not photographs of participants or partner facilities.</p></div>}</PublicDialog> : null}
  </div>;
}
