import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiGet, apiSend } from './lib/api.js';
import { Glyph } from './lib/icons.jsx';
import {
  DESK_STATUSES,
  FLOW_FILTERS,
  QUEUE_KEY,
  bookedSpark,
  buildFlow,
  buildOutboundMessage,
  buildWeek,
  countFlow,
  cut,
  formatEuro,
  formatHelsinkiTime,
  isSuspiciousPrice,
  listingStatusLabel,
  loadJson,
  parseEuroAmount,
  poly,
  reconcileLead,
  relativeAgo,
  saveJson,
  smooth,
  statusDot,
  weekdayReplySeries,
} from './lib/desk.js';
import './styles.css';

const canUseControls = (import.meta.env.VITE_DASHBOARD_MODE || 'admin') !== 'client_fi';

function App() {
  const [view, setView] = useState('overview');
  const [from, setFrom] = useState('overview');
  const [vw, setVw] = useState(typeof window === 'undefined' ? 1440 : window.innerWidth);
  const [summary, setSummary] = useState(null);
  const [listings, setListings] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [calendarCalls, setCalendarCalls] = useState([]);
  const [pendingCallbacks, setPendingCallbacks] = useState([]);
  const [settings, setSettings] = useState(null);
  const [control, setControl] = useState(null);
  const [queue, setQueue] = useState(() => {
    const stored = loadJson(QUEUE_KEY, null);
    return Array.isArray(stored) ? stored : null;
  });
  const [stage, setStage] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [weekOffset, setWeekOffset] = useState(0);
  const [modal, setModal] = useState(false);
  const [advOpen, setAdvOpen] = useState(true);
  const [leadTab, setLeadTab] = useState('chat');
  const [menuFor, setMenuFor] = useState(null);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selectedListingId, setSelectedListingId] = useState(null);
  const [capDraft, setCapDraft] = useState('20');
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [scrapeNote, setScrapeNote] = useState('');

  const isDesktop = vw >= 1120;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [summaryData, listingData, conversationData, callsData, settingsData, candidateData] = await Promise.all([
        apiGet('/api/summary'),
        apiGet('/api/listings?status=all&limit=200'),
        apiGet('/api/conversations?limit=300'),
        apiGet('/api/calendar-calls?limit=150'),
        apiGet('/api/settings'),
        apiGet('/api/outbound/candidates?limit=1').catch(() => ({ control: null })),
      ]);
      setSummary(summaryData);
      setListings(listingData.listings || []);
      setConversations(conversationData.conversations || []);
      setCalendarCalls(callsData.booked_calls || []);
      setPendingCallbacks(callsData.pending_callbacks || []);
      setSettings(settingsData.settings || null);
      setCapDraft(String(settingsData.settings?.daily_cap ?? 20));
      setControl(candidateData.control || null);
      setSelectedListingId((current) => current || listingData.listings?.[0]?.id || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (queue !== null) saveJson(QUEUE_KEY, queue);
  }, [queue]);


  const listingById = useMemo(() => {
    const map = new Map();
    for (const listing of listings) {
      map.set(listing.nettikone_id, listing);
      map.set(String(listing.id), listing);
    }
    return map;
  }, [listings]);

  const leads = useMemo(() => {
    const fromConversations = conversations.map((conversation) => {
      const listing = conversation.listing || listingById.get(conversation.listing?.nettikone_id) || {};
      return toLead({ listing, conversation, calendarCalls });
    });

    const seen = new Set(fromConversations.map((lead) => lead.id));
    const extras = pendingCallbacks
      .filter((call) => call.source_customer_id && !seen.has(call.source_customer_id))
      .map((call) =>
        toLead({
          listing: call.listing || listingById.get(call.source_customer_id) || {},
          conversation: {
            number: call.number,
            messages: call.latest_message
              ? [{ id: call.id, direction: 'inbound', sender: 'Seller', message: call.latest_message, at: call.received_at }]
              : [],
            derived_status: 'ready_for_call',
          },
          calendarCalls,
        })
      );

    return [...fromConversations, ...extras];
  }, [calendarCalls, conversations, listingById, pendingCallbacks]);

  useEffect(() => {
    if (queue !== null || !leads.length) return;
    setQueue(
      leads
        .filter((lead) => lead.interestedSignal || lead.awaiting || lead.reviewSignal || lead.booked)
        .map((lead) => lead.id)
    );
  }, [leads, queue]);

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || leads[0] || null;
  const selectedListing = listings.find((listing) => listing.id === selectedListingId) || listings[0] || null;

  useEffect(() => {
    if (view !== 'lead') return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setView(from || 'overview');
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepLead(1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepLead(-1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [from, view, leads, selectedLeadId]);

  function stepLead(delta) {
    if (!leads.length) return;
    const ids = leads.map((lead) => lead.id);
    const index = Math.max(0, ids.indexOf(selectedLeadId));
    setSelectedLeadId(ids[(index + delta + ids.length) % ids.length]);
    setMenuFor(null);
  }

  function openLead(lead, source = view) {
    setFrom(source === 'lead' ? 'overview' : source);
    setSelectedLeadId(lead.id);
    setLeadTab('chat');
    setAdvOpen(true);
    setMenuFor(null);
    setView('lead');
  }

  function toggleQueue(id, event) {
    event?.stopPropagation?.();
    setQueue((current) => {
      const rows = current || [];
      return rows.includes(id) ? rows.filter((value) => value !== id) : [...rows, id];
    });
  }

  async function updateSettings(next) {
    if (!canUseControls) return;
    setSaving(true);
    setError('');
    try {
      await apiSend('/api/settings', { method: 'PUT', body: { settings: next } });
      await load();
    } catch (settingsError) {
      setError(settingsError.message);
    } finally {
      setSaving(false);
    }
  }

  async function runScrape() {
    if (!canUseControls) return;
    setScraping(true);
    setError('');
    setScrapeNote('');
    try {
      const result = await apiSend('/api/scrape/run?targetNew=10&maxPages=20&maxListings=30', { method: 'POST' });
      const stats = result.stats || {};
      setScrapeNote(`${stats.new_leads || 0} new leads · ${stats.pages_scanned || 0} pages`);
      await load();
    } catch (scrapeError) {
      setError(scrapeError.message);
    } finally {
      setScraping(false);
    }
  }

  async function setDeskStatus(lead, deskStatus) {
    if (!canUseControls || !lead?.listingId) return;
    setMenuFor(null);
    setError('');
    try {
      await apiSend('/api/leads/status', {
        method: 'PATCH',
        body: { nettikone_id: lead.listingId, desk_status: deskStatus },
      });
      await load();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function sendListing(listing) {
    if (!canUseControls || !listing?.normalized_phone) return;
    setSending(true);
    setError('');
    try {
      await apiSend('/api/outbound/sent', {
        method: 'POST',
        body: {
          nettikone_id: listing.nettikone_id,
          listing_id: listing.id,
          number: listing.normalized_phone,
          message: buildOutboundMessage(listing.machine_title),
        },
      });
      await load();
      const lead = {
        id: listing.nettikone_id,
        listingId: listing.nettikone_id,
      };
      setSelectedLeadId(lead.id);
      setFrom('listings');
      setView('lead');
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  const flowCounts = useMemo(() => countFlow(leads, summary), [leads, summary]);
  const flow = useMemo(() => buildFlow(flowCounts, stage), [flowCounts, stage]);
  const replies = useMemo(() => weekdayReplySeries(conversations), [conversations]);
  const spark = useMemo(() => bookedSpark(calendarCalls), [calendarCalls]);
  const week = useMemo(() => buildWeek(weekOffset, calendarCalls), [calendarCalls, weekOffset]);

  const pipelineLeads = leads.filter((lead) => lead.awaiting || lead.booked);
  const pipelineAsk = pipelineLeads.reduce((sum, lead) => sum + parseEuroAmount(lead.priceEur || lead.price), 0);
  const replyTotal = replies.office.reduce((a, b) => a + b, 0) + replies.after.reduce((a, b) => a + b, 0);
  const afterShare = replyTotal ? Math.round((replies.after.reduce((a, b) => a + b, 0) / replyTotal) * 100) : 0;
  const kpi = {
    booked: String(flowCounts.booked || 0),
    bookedDelta: flowCounts.booked ? `${flowCounts.booked} live` : '',
    opps: String(flowCounts.interested || 0),
    lost: String(flowCounts.lost || 0),
    oppPct: flowCounts.replied ? `${Math.round((flowCounts.interested / flowCounts.replied) * 100)}% of replies` : 'of replies',
    lostPct: flowCounts.replied ? `${Math.round((flowCounts.lost / flowCounts.replied) * 100)}% of replies` : 'of replies',
    commission: formatEuro(pipelineAsk) || '0 €',
    commissionSub: pipelineAsk
      ? `5% est. ${formatEuro(pipelineAsk * 0.05)} · ${pipelineLeads.length} open leads`
      : 'No open pipeline asking prices yet',
  };

  const queueIds = queue || [];
  const outboundOn = Boolean(settings?.outbound_enabled);
  const sentToday = control?.sent_today ?? 0;
  const dailyCap = Number(settings?.daily_cap ?? control?.daily_cap ?? 0);
  const obPct = `${Math.min(100, Math.round((sentToday / Math.max(dailyCap, 1)) * 100))}%`;

  const titles = { overview: 'Overview', queue: 'Work queue', calendar: 'Calendar', listings: 'Listings' };
  const baseView = view === 'lead' ? from || 'overview' : view;
  const nav = [
    { id: 'overview', label: 'Overview', short: 'Overview', count: '', icon: 'ChartLineWeightRegular' },
    { id: 'queue', label: 'Work queue', short: 'Queue', count: String(queueIds.length || ''), icon: 'TrayWeightRegular' },
    { id: 'calendar', label: 'Calendar', short: 'Calendar', count: String(calendarCalls.length || ''), icon: 'ClockCounterClockwiseWeightRegular' },
    { id: 'listings', label: 'Listings', short: 'Listings', count: String(summary?.eligible || listings.length || ''), icon: 'NotebookWeightRegular' },
  ];

  const filter = stage ? FLOW_FILTERS[stage] : null;
  const pool = filter ? leads.filter(filter.test) : leads;
  const pageCount = Math.max(1, Math.ceil(pool.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = pool.slice((safePage - 1) * pageSize, safePage * pageSize);
  const queueLeads = leads.filter((lead) => queueIds.includes(lead.id));
  const bookedLeads = leads.filter((lead) => lead.booked);
  const waitLeads = leads.filter((lead) => lead.awaiting);

  const ctx = {
    advOpen,
    baseView,
    bookedLeads,
    canUseControls,
    capDraft,
    dailyCap,
    error,
    filter,
    flow,
    from,
    isDesktop,
    kpi,
    leadTab,
    leads,
    listings,
    loading,
    menuFor,
    modal,
    nav,
    obPct,
    outboundOn,
    page: safePage,
    pageCount,
    pageRows,
    pageSize,
    pool,
    queue: queueIds,
    queueLeads,
    replies,
    replyTotal,
    afterShare,
    saving,
    scrapeNote,
    scraping,
    selectedLead,
    selectedListing,
    sending,
    sentToday,
    spark,
    stage,
    summary,
    titles,
    view,
    waitLeads,
    week,
    weekOffset,
    closeLead: () => setView(from || 'overview'),
    openLead,
    openModal: () => setModal(true),
    pickNav: (id) => {
      setView(id);
      setMenuFor(null);
    },
    pickStage: (key) => {
      setStage(key === stage ? null : key);
      setPage(1);
      setView('overview');
      requestAnimationFrame(() => {
        document.getElementById('lead-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    remainingToday: control?.remaining_today ?? Math.max(dailyCap - sentToday, 0),
    runScrape,
    saveCap: () => updateSettings({ daily_cap: Math.max(Number(capDraft) || 0, 0) }),
    sendListing,
    setCapDraft,
    setDeskStatus,
    setLeadTab,
    setMenuFor,
    setPage,
    setPageSize: (size) => {
      setPageSize(size);
      setPage(1);
    },
    setSelectedListingId,
    setWeekOffset,
    stepLead,
    toggleAdv: () => setAdvOpen((value) => !value),
    toggleOutbound: () => updateSettings({ outbound_enabled: !outboundOn }),
    toggleQueue,
    waitLeads,
  };

  return (
    <main className="desk">
      {isDesktop ? <DesktopDesk ctx={ctx} /> : <MobileDesk ctx={ctx} />}
      {view === 'lead' && selectedLead && isDesktop ? <LeadDrawer ctx={ctx} /> : null}
      {view === 'lead' && selectedLead && !isDesktop ? <LeadSheet ctx={ctx} /> : null}
      {modal ? <OutboundModal ctx={ctx} onClose={() => setModal(false)} /> : null}
    </main>
  );
}

function DesktopDesk({ ctx }) {
  return (
    <div className="desk-desktop">
      <Sidebar ctx={ctx} />
      <div className="main">
        <header className="topbar">
          <div className="crumb">
            Lead Desk&nbsp; /&nbsp; <strong>{ctx.view === 'lead' ? ctx.selectedLead?.machine : ctx.titles[ctx.baseView]}</strong>
          </div>
          <div className="grow" />
          {ctx.scrapeNote ? <span className="scrape-note">{ctx.scrapeNote}</span> : null}
          {ctx.canUseControls ? (
            <button className="btn btn-soft" disabled={ctx.scraping} onClick={ctx.runScrape} type="button">
              {ctx.scraping ? 'Searching...' : 'Find new leads'}
            </button>
          ) : null}
        </header>
        {ctx.error ? <div className="error">{ctx.error}</div> : null}
        <div className="page">
          {ctx.baseView === 'overview' ? <Overview ctx={ctx} /> : null}
          {ctx.baseView === 'queue' ? <WorkQueue ctx={ctx} /> : null}
          {ctx.baseView === 'calendar' ? <CalendarPage ctx={ctx} /> : null}
          {ctx.baseView === 'listings' ? <ListingsPage ctx={ctx} /> : null}
        </div>
      </div>
    </div>
  );
}

function MobileDesk({ ctx }) {
  return (
    <div className="desk-mobile">
      <div className="m-top">
        <img src="/nordkone-logo.png" alt="NordKone" />
        <span className="grow" />
        <button className="m-ob" onClick={ctx.openModal} type="button">
          <span className={`dot ${ctx.outboundOn ? 'live' : ''}`} />
          <span className="muted">{ctx.sentToday} of {ctx.dailyCap} sent</span>
        </button>
      </div>
      {ctx.error ? <div className="error">{ctx.error}</div> : null}
      <div className="m-body">
        {ctx.baseView === 'overview' ? <MobileOverview ctx={ctx} /> : null}
        {ctx.baseView === 'queue' ? <MobileQueue ctx={ctx} /> : null}
        {ctx.baseView === 'calendar' ? <MobileCalendar ctx={ctx} /> : null}
        {ctx.baseView === 'listings' ? <MobileListings ctx={ctx} /> : null}
      </div>
      <nav className="m-tabbar">
        {ctx.nav.map((item) => (
          <button className={`m-tab ${ctx.baseView === item.id ? 'on' : ''}`} key={item.id} onClick={() => ctx.pickNav(item.id)} type="button">
            <Glyph name={item.icon} size={20} />
            <span>{item.short}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Sidebar({ ctx }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/nordkone-logo.png" alt="NordKone" />
      </div>
      <nav className="nav">
        {ctx.nav.map((item) => (
          <button className={`nav-item ${ctx.baseView === item.id ? 'on' : ''}`} key={item.id} onClick={() => ctx.pickNav(item.id)} type="button">
            <span style={{ color: ctx.baseView === item.id ? 'rgb(0,0,0)' : 'rgba(0,0,0,0.4)' }}>
              <Glyph name={item.icon} size={18} />
            </span>
            <span className="nav-label">{item.label}</span>
            <span className="nav-count">{item.count}</span>
          </button>
        ))}
      </nav>
      <div className="grow" />
      <div className="ob-card">
        <div className="ob-head">
          <span className={`dot ${ctx.outboundOn ? 'live' : ''}`} />
          <span className="ob-title">{ctx.outboundOn ? 'Outbound on' : 'Outbound off'}</span>
        </div>
        <div className="bar"><i style={{ width: ctx.obPct }} /></div>
        <div className="muted">{ctx.sentToday} of {ctx.dailyCap} sent</div>
        <div className="muted">
          {!ctx.outboundOn ? 'WF-1 paused' : ctx.remainingToday <= 0 ? 'Daily cap reached' : `${ctx.remainingToday} left today`}
        </div>
        {ctx.canUseControls ? (
          <button className="ob-link" onClick={ctx.openModal} type="button">Open controls →</button>
        ) : null}
      </div>
    </aside>
  );
}

function Overview({ ctx }) {
  if (ctx.loading) return <OverviewSkeleton />;
  return (
    <div className="scroll page-in">
      <div className="kpis">
        <button className={`card card-wide card-btn ${ctx.stage === 'booked' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('booked')} type="button">
          <div className="card-title">Calls booked</div>
          <svg viewBox="0 0 260 90" width="100%" height="72" preserveAspectRatio="none" style={{ display: 'block', margin: '12px 0 8px' }}>
            <path className="line-draw" d={poly(ctx.spark.length ? ctx.spark : [0, 0, 0, 0, 0, 0, 0], 260, 90, 8)} fill="none" stroke="rgb(0,0,0)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="kpi-row">
            <span className="kpi-num">{ctx.kpi.booked}</span>
            {ctx.kpi.bookedDelta ? <span className="up">{ctx.kpi.bookedDelta}</span> : null}
            <span className="muted">active calendar bookings</span>
          </div>
        </button>
        <button className={`card card-mid card-btn ${ctx.stage === 'interested' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('interested')} type="button">
          <div className="row">
            <span className="dot live" />
            <span className="card-title">Opportunities</span>
          </div>
          <div className="kpi-num" style={{ marginTop: 12 }}>{ctx.kpi.opps}</div>
          <div className="muted" style={{ marginTop: 6 }}>{ctx.kpi.oppPct}</div>
        </button>
        <button className={`card card-mid card-btn ${ctx.stage === 'lost' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('lost')} type="button">
          <div className="row">
            <span className="dot" style={{ background: 'rgb(255,71,71)' }} />
            <span className="card-title">Deal lost</span>
          </div>
          <div className="kpi-num" style={{ marginTop: 12 }}>{ctx.kpi.lost}</div>
          <div className="muted" style={{ marginTop: 6 }}>{ctx.kpi.lostPct}</div>
        </button>
        <button className={`card card-wide card-btn ${ctx.stage === 'pipeline' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('pipeline')} type="button">
          <div className="card-title">Pipeline</div>
          <div className="kpi-num" style={{ marginTop: 12 }}>{ctx.kpi.commission}</div>
          <div className="muted" style={{ marginTop: 6 }}>{ctx.kpi.commissionSub}</div>
          <div className="muted">Open interested, callback and booked asking prices</div>
        </button>
      </div>

      <div className="charts">
        <article className="card flow-card">
          <div className="wrap">
            <span className="card-title">Campaign flow</span>
            <span className="muted" style={{ flex: 1 }}>{scrapedCount(ctx.summary)} listings scraped · {ctx.summary?.eligible || 0} not yet messaged</span>
            <span className="muted">Booked <strong style={{ color: 'rgb(0,0,0)' }}>{ctx.kpi.booked}</strong></span>
          </div>
          <div className="flow-wrap">
            <svg viewBox="0 0 1120 500" width="100%" height="300" preserveAspectRatio="none" style={{ display: 'block', height: 300 }}>
              {ctx.flow.links.map((link) => (
                <path d={link.d} fill="rgba(0,0,0,0.05)" key={link.d} />
              ))}
              {ctx.flow.nodes.map((node) => (
                <rect fill={node.c} height={node.h} key={node.k} onClick={() => ctx.pickStage(node.k)} rx="4" style={{ cursor: 'pointer' }} width={node.w} x={node.x} y={node.y} />
              ))}
            </svg>
            {ctx.flow.nodes.map((node) => (
              <div className="flow-label" key={`${node.k}-label`} onClick={() => ctx.pickStage(node.k)} style={{ left: node.left, top: node.top }}>
                <strong style={{ color: node.lfg }}>{node.label}</strong>
                <span>{node.count}</span>
              </div>
            ))}
          </div>
          <div className="muted" style={{ marginTop: 12 }}>Click a stage to filter the lead list to those exact signals.</div>
        </article>

        <article className="card reply-card">
          <div className="wrap">
            <span className="card-title">Reply timing</span>
            <span className="muted">{ctx.replyTotal} replies this week</span>
          </div>
          <div className="legend">
            <div className="legend-item"><span className="legend-line" style={{ background: 'rgb(0,0,0)' }} />Office hours {ctx.replies.office.reduce((a, b) => a + b, 0)}</div>
            <div className="legend-item"><span className="legend-line" style={{ background: 'rgb(184,153,235)' }} />After hours {ctx.replies.after.reduce((a, b) => a + b, 0)}</div>
          </div>
          <svg viewBox="0 0 420 190" width="100%" style={{ display: 'block', marginTop: 8, flex: 1 }}>
            <path className="line-draw" d={smooth(ctx.replies.office, 420, 190, 14)} fill="none" stroke="rgb(0,0,0)" strokeWidth="2" />
            <path className="line-draw" d={smooth(ctx.replies.after, 420, 190, 14)} fill="none" stroke="rgb(184,153,235)" strokeWidth="2" />
          </svg>
          <div className="weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="muted" style={{ marginTop: 12 }}>{ctx.afterShare}% of replies arrive outside office hours.</div>
        </article>
      </div>

      <div id="lead-table">
        <LeadTable ctx={ctx} rows={ctx.pageRows} showPager />
      </div>
    </div>
  );
}

function WorkQueue({ ctx }) {
  return (
    <div className="scroll page-in">
      <div className="page-title">
        <h1>Work queue</h1>
        <span className="muted">{ctx.queueLeads.length} · open the chat to see the advert</span>
      </div>
      <LeadTable ctx={ctx} hideToolbar rows={ctx.queueLeads} source="queue" />
    </div>
  );
}

function CalendarPage({ ctx }) {
  return (
    <div className="scroll page-in" style={{ paddingTop: 24 }}>
      <div className="cal-head">
        <h1>{ctx.week.label}</h1>
        <span className="muted" style={{ flex: 1 }}>{ctx.week.count}</span>
        <button className="btn btn-ring" onClick={() => ctx.setWeekOffset(0)} style={{ height: 32 }} type="button">Today</button>
        <button className="sq lg" onClick={() => ctx.setWeekOffset((value) => value - 1)} type="button">‹</button>
        <button className="sq lg" onClick={() => ctx.setWeekOffset((value) => value + 1)} type="button">›</button>
      </div>
      <div className="week-grid">
        {ctx.week.days.map((day) => (
          <div className={`day-col ${day.today ? 'today' : ''}`} key={day.name}>
            <div className="day-head">
              <span className="day-name">{day.name}</span>
              <span className="day-num">{day.num}</span>
            </div>
            <div className="day-body">
              {day.events.map((event) => (
                <button className="event" key={`${event.leadId}-${event.at}`} onClick={() => openLeadById(ctx, event.leadId, 'calendar')} type="button">
                  <strong>{event.at}</strong>
                  <p>{event.machine}</p>
                  <small>{event.phone}</small>
                </button>
              ))}
              {!day.events.length ? <span className="empty-soft">No calls</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="section-head">
        <h2>Booked calls</h2>
        <span className="muted">{ctx.bookedLeads.length} booked</span>
      </div>
      <LeadTable ctx={ctx} compact hideToolbar rows={ctx.bookedLeads} source="calendar" />
      <div className="section-head">
        <h2>Waiting for a booking</h2>
        <span className="muted">{ctx.waitLeads.length} waiting</span>
      </div>
      <LeadTable ctx={ctx} compact hideToolbar rows={ctx.waitLeads} source="calendar" />
    </div>
  );
}

function ListingsPage({ ctx }) {
  const listing = ctx.selectedListing;
  return (
    <div className="page" style={{ overflow: 'hidden' }}>
      <div className="listings-pane">
        <div className="list-head">
          <h1>Scraped listings</h1>
          <span className="muted" style={{ flex: 1 }}>{ctx.listings.length} visible · queue of {ctx.summary?.eligible || 0} eligible</span>
        </div>
        <div className="list-cols">
          <span className="h" style={{ flex: 1 }}>Machine</span>
          <span className="h" style={{ width: 110, textAlign: 'right' }}>Price</span>
          <span className="h" style={{ width: 150 }}>Phone</span>
          <span className="h" style={{ width: 96 }}>Status</span>
        </div>
        {ctx.listings.map((row) => (
          <div className={`listing-row ${listing?.id === row.id ? 'on' : ''}`} key={row.id} onClick={() => ctx.setSelectedListingId(row.id)}>
            <div className="col-lead">
              <div className="machine">{row.machine_title}</div>
              <div className="muted">{row.nettikone_id} · {row.location || 'No location'}</div>
            </div>
            <div className="col-price">
              <div className={`price ${isSuspiciousPrice(row.price_text, row.price_eur) ? 'warn' : ''}`}>{row.price_text || '-'}</div>
              <div className="muted">{row.model_year || 'Year unknown'}</div>
            </div>
            <div style={{ width: 150, flexShrink: 0 }}>
              <div style={{ fontSize: 14, lineHeight: '20px' }}>{row.normalized_phone || '-'}</div>
              <div className="muted">{row.seller_name || (row.prospect_id ? `Seller ${row.prospect_id}` : 'Seller')}</div>
            </div>
            <div style={{ width: 96, flexShrink: 0 }}>
              <span className="pill">{listingStatusLabel(row.status)}</span>
            </div>
          </div>
        ))}
        {ctx.loading && !ctx.listings.length ? <div style={{ padding: '0 33px' }}><TableSkeleton /></div> : null}
        {!ctx.listings.length && !ctx.loading ? <div className="muted" style={{ padding: '20px 33px' }}>No listings found.</div> : null}
      </div>
      <aside className="detail">
        {listing ? (
          <>
            <div>
              <div className="row" style={{ paddingBottom: 12 }}>
                <a href={listing.listing_url} rel="noreferrer" target="_blank">
                  <span className="row"><Glyph name="ArrowRight2" size={13} />Open ad</span>
                </a>
              </div>
              <h2>{listing.machine_title}</h2>
              <div className="photo">Advert photo</div>
              <dl className="fields">
                {[
                  ['Price', listing.price_text || '-'],
                  ['Model year', listing.model_year || '-'],
                  ['Location', listing.location || '-'],
                  ['Registration', listing.registration_number || 'Ei rekisterissä'],
                  ['Phone', listing.normalized_phone || '-'],
                  ['Seller prospect', listing.seller_name || listing.prospect_id || '-'],
                ].map(([k, v]) => (
                  <div className="field" key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </div>
            <div>
              <div className="eyebrow">Seller's own listing notes</div>
              <div className="notes">{listing.description || 'No description stored.'}</div>
            </div>
            <div>
              <div className="eyebrow">Outbound preview</div>
              <div className="outbound-preview">{buildOutboundMessage(listing.machine_title)}</div>
              {ctx.canUseControls ? (
                <button className="btn-block" disabled={ctx.sending || !listing.normalized_phone} onClick={() => ctx.sendListing(listing)} type="button">
                  {ctx.sending ? 'Sending...' : 'Send and open session'}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="muted">Select a listing.</p>
        )}
      </aside>
    </div>
  );
}

function LeadTable({ ctx, compact, hideToolbar, rows, showPager, source = 'overview' }) {
  const rangeFrom = ctx.pool.length === 0 ? 0 : (ctx.page - 1) * ctx.pageSize + 1;
  return (
    <>
      {!hideToolbar ? (
        <div className="toolbar">
          <button className="btn btn-ring" type="button">
            <Glyph name="FunnelSimpleWeightRegular" size={17} />
            Filters
          </button>
          {ctx.filter ? (
            <button className="btn btn-soft" onClick={() => ctx.pickStage(null)} type="button">
              {`Filtered to ${ctx.filter.label}`} <span style={{ color: 'rgba(0,0,0,0.4)' }}>×</span>
            </button>
          ) : null}
          <span className="grow" />
          <span className="muted">{ctx.pool.length} leads</span>
          <button className="btn" type="button">
            <Glyph name="ArrowsDownUpWeightRegular" size={17} />
            Last activity
          </button>
          <button className="btn btn-ring" onClick={() => window.location.reload()} type="button">Refresh</button>
        </div>
      ) : null}
      <div>
        <div className="h-cols">
          <span className="h" style={{ flex: 1 }}>Lead</span>
          <span className="h" style={{ width: compact ? 150 : 184 }}>Status</span>
          <span className="h" style={{ width: 110 }}>Location</span>
          <span className="h" style={{ width: 110, textAlign: 'right' }}>Asking price</span>
          <span className="h" style={{ width: compact ? 60 : 160, textAlign: compact ? 'right' : 'left' }}>{compact ? '' : 'Last activity'}</span>
          {!compact ? <span className="h" style={{ width: 84, textAlign: 'right' }}>Chat</span> : null}
        </div>
        {rows.map((row, index) => (
          <div className="lead-row" key={row.id} onClick={() => ctx.openLead(row, source)} style={{ animationDelay: `${Math.min(index, 12) * 26}ms` }}>
            <div className="col-lead">
              <div className="machine">{cut(row.machine)}</div>
              <div className="phone-row">
                <Glyph name="WhatsappLogoWeightFill" size={13} />
                <span>{row.phone}</span>
              </div>
            </div>
            <div className={compact ? '' : 'col-status'} style={compact ? { width: 150, flexShrink: 0 } : undefined}>
              <div className="status-line">
                <span className="dot" style={{ background: statusDot(row.stage) }} />
                <span>{row.stage}</span>
              </div>
              {!compact && ctx.queue.includes(row.id) ? (
                <button className="q-chip" onClick={(event) => ctx.toggleQueue(row.id, event)} type="button">
                  <Glyph name="ArrowLineRightWeightBold" size={11} />
                  In queue
                </button>
              ) : null}
            </div>
            <div className="col-loc"><span style={{ fontSize: 14, lineHeight: '20px' }}>{row.location}</span></div>
            <div className="col-price"><span className={`price ${row.priceFlag ? 'warn' : ''}`}>{row.price}</span></div>
            <div className={compact ? '' : 'col-act'} style={compact ? { width: 60, flexShrink: 0, textAlign: 'right' } : undefined}>
              <div style={{ fontSize: 14, lineHeight: '20px', color: compact ? 'rgba(0,0,0,0.4)' : 'rgb(0,0,0)' }}>{row.ago}</div>
              {!compact ? <div className="snippet">{row.snippet}</div> : null}
            </div>
            {!compact ? (
              <div className="col-chat">
                {!ctx.queue.includes(row.id) ? (
                  <button className="icon-btn" onClick={(event) => ctx.toggleQueue(row.id, event)} type="button">
                    <Glyph name="ArrowLineRightWeightBold" size={15} />
                  </button>
                ) : null}
                <button className="icon-btn dark" type="button">
                  <Glyph name="ChatTextWeightRegular" size={17} />
                </button>
              </div>
            ) : null}
          </div>
        ))}
        {ctx.loading ? <TableSkeleton compact={compact} /> : null}
        {!rows.length && !ctx.loading ? (
          <div className="muted" style={{ padding: '16px 0' }}>
            {ctx.filter ? `No ${ctx.filter.label.toLowerCase()} leads match the campaign signals.` : 'No leads in this view.'}
          </div>
        ) : null}
      </div>
      {showPager ? (
        <div className="pager">
          <span className="muted">Rows per page</span>
          <div className="page-sizes">
            {[25, 50, 100, 500].map((size) => (
              <button className={`size-btn ${ctx.pageSize === size ? 'on' : ''}`} key={size} onClick={() => ctx.setPageSize(size)} type="button">{size}</button>
            ))}
          </div>
          <span className="grow" />
          <span className="muted">{rangeFrom}–{Math.min(ctx.page * ctx.pageSize, ctx.pool.length)} of {ctx.pool.length}</span>
          <button className="sq" onClick={() => ctx.setPage(Math.max(1, ctx.page - 1))} type="button">‹</button>
          <button className="sq" onClick={() => ctx.setPage(Math.min(ctx.pageCount, ctx.page + 1))} type="button">›</button>
        </div>
      ) : null}
    </>
  );
}

function LeadDrawer({ ctx }) {
  const lead = ctx.selectedLead;
  const inQ = ctx.queue.includes(lead.id);
  return (
    <div className="drawer-scrim" onClick={ctx.closeLead}>
      <div className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <button className="btn btn-ring" onClick={ctx.closeLead} type="button">‹ Back</button>
          <div className="drawer-title">
            <h2>{lead.machine}</h2>
            <div className="muted">{lead.phone} · {lead.seller} · {lead.location}</div>
          </div>
          <div className="row" style={{ flexShrink: 0 }}>
            <div className="rel">
              <button className="btn btn-ring" onClick={() => ctx.setMenuFor(ctx.menuFor === 'lead' ? null : 'lead')} type="button">
                <span className="dot" style={{ background: statusDot(lead.stage) }} />
                {lead.stage} ▾
              </button>
              {ctx.menuFor === 'lead' ? (
                <div className="menu wide">
                  {DESK_STATUSES.map((option) => (
                    <button className="menu-item" key={option.label} onClick={() => ctx.setDeskStatus(lead, option.label)} type="button">
                      <span className="dot" style={{ background: option.dot }} />
                      <span style={{ fontWeight: option.label === lead.stage ? 600 : 400 }}>{option.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              className="btn"
              onClick={() => ctx.toggleQueue(lead.id)}
              style={{ background: inQ ? 'transparent' : 'rgb(28,28,30)', color: inQ ? 'rgb(0,0,0)' : 'rgb(255,255,255)', boxShadow: inQ ? 'inset 0 0 0 1px rgba(0,0,0,0.1)' : 'none' }}
              type="button"
            >
              <Glyph name="ArrowLineRightWeightBold" size={15} />
              {inQ ? 'In work queue' : 'Add to work queue'}
            </button>
            <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.1)' }} />
            <span className="muted">{leadPos(ctx)}</span>
            <button className="sq lg" onClick={() => ctx.stepLead(-1)} type="button">‹</button>
            <button className="sq lg" onClick={() => ctx.stepLead(1)} type="button">›</button>
          </div>
        </div>
        <div className="drawer-body">
          <div className="chat-col">
            <div className="row" style={{ padding: '16px 24px 10px 33px' }}>
              <span className="eyebrow" style={{ flex: 1, paddingBottom: 0 }}>Conversation</span>
              <Glyph name="WhatsappLogoWeightFill" size={14} />
              <span className="muted">{lead.phone}</span>
            </div>
            <div className="chat-scroll">
              {lead.msgs.map((message) => (
                <article className={`bubble ${message.out ? 'out' : 'in'}`} key={message.id}>
                  <div className="bubble-meta">
                    <span className="eyebrow" style={{ paddingBottom: 0 }}>{message.who}</span>
                    <span className="muted">{message.when}</span>
                  </div>
                  <p>{message.text}</p>
                </article>
              ))}
              {!lead.msgs.length ? <p className="muted">No stored messages for this session.</p> : null}
            </div>
          </div>
          {ctx.advOpen ? (
            <div className="adv-col">
              <div className="row" style={{ paddingBottom: 12 }}>
                {lead.url ? (
                  <a href={lead.url} rel="noreferrer" target="_blank">
                    <span className="row"><Glyph name="ArrowRight2" size={13} />Open ad</span>
                  </a>
                ) : null}
              </div>
              <div className="adv-card">
                <div className="adv-photo">Advert photo</div>
                <div style={{ padding: '6px 20px 20px' }}>
                  <div className="row" style={{ marginBottom: 18, alignItems: 'baseline' }}>
                    <span className="kpi-num">{lead.price}</span>
                    {lead.priceFlag ? <span className="flag">Check price</span> : null}
                    <span className="grow" />
                    <span className="muted">Nettikone {lead.listingId}</span>
                  </div>
                  <div className="adv-grid">
                    {lead.fields.map((field) => (
                      <div key={field.k}>
                        <div className="eyebrow">{field.k}</div>
                        <div style={{ fontSize: 14, lineHeight: '20px' }}>{field.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 20 }}>
                <div className="eyebrow">What the advert says</div>
                <div className="notes" style={{ padding: 14 }}>{lead.notes}</div>
                <div style={{ marginTop: 16 }}>
                  <div className="eyebrow">First message we sent</div>
                  <div className="outbound-preview" style={{ padding: 14 }}>{lead.outbound}</div>
                </div>
              </div>
            </div>
          ) : (
            <button className="adv-strip" onClick={ctx.toggleAdv} type="button">‹</button>
          )}
        </div>
      </div>
    </div>
  );
}

function LeadSheet({ ctx }) {
  const lead = ctx.selectedLead;
  return (
    <div className="sheet">
      <div style={{ flexShrink: 0, padding: '12px 16px 0' }}>
        <div className="row">
          <button className="sq lg" onClick={ctx.closeLead} type="button">‹</button>
          <span className="grow" />
          <span className="muted">{leadPos(ctx)}</span>
          <button className="sq lg" onClick={() => ctx.stepLead(-1)} type="button">↑</button>
          <button className="sq lg" onClick={() => ctx.stepLead(1)} type="button">↓</button>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>{lead.machine}</div>
          <div className="phone-row" style={{ marginTop: 3 }}>
            <Glyph name="WhatsappLogoWeightFill" size={14} />
            <span>{lead.phone}</span>
          </div>
        </div>
        <div className="rel" style={{ marginTop: 12 }}>
          <button className="btn btn-ring" onClick={() => ctx.setMenuFor(ctx.menuFor === 'lead' ? null : 'lead')} style={{ height: 40 }} type="button">
            <span className="dot" style={{ background: statusDot(lead.stage), width: 8, height: 8 }} />
            {lead.stage} ▾
          </button>
          {ctx.menuFor === 'lead' ? (
            <div className="menu narrow">
              {DESK_STATUSES.map((option) => (
                <button className="menu-item" key={option.label} onClick={() => ctx.setDeskStatus(lead, option.label)} type="button">
                  <span className="dot" style={{ background: option.dot, width: 8, height: 8 }} />
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="row" style={{ marginTop: 16, padding: 4, borderRadius: 12, background: 'rgb(249,249,250)' }}>
          <button className="btn" onClick={() => ctx.setLeadTab('chat')} style={{ flex: 1, background: ctx.leadTab === 'chat' ? 'rgb(255,255,255)' : 'transparent', fontWeight: ctx.leadTab === 'chat' ? 600 : 400 }} type="button">Chat</button>
          <button className="btn" onClick={() => ctx.setLeadTab('advert')} style={{ flex: 1, background: ctx.leadTab === 'advert' ? 'rgb(255,255,255)' : 'transparent', fontWeight: ctx.leadTab === 'advert' ? 600 : 400 }} type="button">Advert</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {ctx.leadTab === 'chat' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lead.msgs.map((message) => (
              <article className={`bubble ${message.out ? 'out' : 'in'}`} key={message.id} style={{ alignSelf: message.out ? 'flex-end' : 'flex-start' }}>
                <div className="bubble-meta">
                  <span className="eyebrow" style={{ paddingBottom: 0 }}>{message.who}</span>
                  <span className="muted">{message.when}</span>
                </div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
        ) : (
          <div>
            <div className="row" style={{ paddingBottom: 10 }}>
              <span className="eyebrow" style={{ flex: 1 }}>Nettikone {lead.listingId}</span>
              {lead.url ? <a href={lead.url} rel="noreferrer" target="_blank">Open ad</a> : null}
            </div>
            <div className="photo" style={{ height: 180, borderRadius: 16 }}>Advert photo</div>
            <div className="row" style={{ margin: '14px 0', alignItems: 'baseline' }}>
              <span style={{ fontSize: 28, lineHeight: '34px', fontWeight: 600 }}>{lead.price}</span>
              {lead.priceFlag ? <span className="flag">Check price</span> : null}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
              {lead.fields.map((field) => (
                <div key={field.k}>
                  <div className="eyebrow">{field.k}</div>
                  <div style={{ fontSize: 14, lineHeight: '20px' }}>{field.v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20 }}>
              <div className="eyebrow">Seller's own listing notes</div>
              <div className="notes">{lead.notes}</div>
            </div>
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, padding: '12px 16px 20px', borderTop: '1px solid rgba(0,0,0,0.04)', display: 'flex', gap: 10 }}>
        <button className="btn btn-ring" onClick={() => ctx.toggleQueue(lead.id)} style={{ flex: 1, height: 48 }} type="button">
          {ctx.queue.includes(lead.id) ? 'In work queue' : 'Add to work queue'}
        </button>
        <a className="btn btn-dark" href={whatsAppHref(lead.phone)} rel="noreferrer" style={{ flex: 1, height: 48 }} target="_blank">
          <Glyph name="WhatsappLogoWeightFill" size={18} />
          Open chat
        </a>
      </div>
    </div>
  );
}

function OutboundModal({ ctx, onClose }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600 }}>Outbound</div>
            <div className="muted" style={{ marginTop: 2 }}>First WhatsApp message, sent automatically.</div>
          </div>
          <button className="sq lg" onClick={onClose} type="button">×</button>
        </div>
        <div className="card" style={{ display: 'flex', gap: 16, marginTop: 20, padding: 16 }}>
          <span className={`dot ${ctx.outboundOn ? 'live' : ''}`} style={{ marginTop: 7 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600 }}>{ctx.outboundOn ? 'Outbound on' : 'Outbound off'}</div>
            <div className="muted">{ctx.outboundOn ? 'Leads are picked only while this is on and the daily cap has room.' : 'No candidates are being sent.'}</div>
          </div>
          <button className={`switch ${ctx.outboundOn ? 'on' : ''}`} disabled={ctx.saving || !ctx.canUseControls} onClick={ctx.toggleOutbound} type="button">
            <i />
          </button>
        </div>
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Daily cap</div>
          <div className="muted">WF-1 first messages today. Same cap the previous desk used.</div>
          <div className="row" style={{ marginTop: 12 }}>
            <input className="cap-input" min="0" onChange={(event) => ctx.setCapDraft(event.target.value)} type="number" value={ctx.capDraft} />
            <button className="btn btn-ring" disabled={ctx.saving} onClick={ctx.saveCap} style={{ height: 40, padding: '0 18px' }} type="button">Save cap</button>
            <div style={{ flex: 1 }}>
              <div className="muted">{ctx.sentToday} of {ctx.dailyCap} sent today{ctx.remainingToday <= 0 ? ' · cap reached' : ` · ${ctx.remainingToday} left`}</div>
              <div className="bar" style={{ marginTop: 6 }}><i style={{ width: ctx.obPct }} /></div>
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: 'rgba(0,0,0,0.04)', margin: '24px 0' }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Locked first message</div>
          <div className="muted">WF-1 always sends this copy. Machine title replaces the listing name.</div>
          <div className="outbound-preview" style={{ marginTop: 12 }}>{buildOutboundMessage('Hitachi ZX 225')}</div>
        </div>
        <div className="m-card" style={{ marginTop: 24, background: 'rgb(249,249,250)', boxShadow: 'none' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Consent and opt-out</div>
          <div style={{ fontSize: 14, lineHeight: '20px', color: 'rgba(0,0,0,0.8)', marginTop: 4 }}>
            Numbers come from public Nettikone listings. An opt-out reply stops all outbound to that number immediately.
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileOverview({ ctx }) {
  if (ctx.loading) return <OverviewSkeleton mobile />;
  return (
    <div className="page-in">
      <div className="m-kpis">
        <button className={`m-card card-btn ${ctx.stage === 'booked' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('booked')} type="button"><div className="muted">Calls booked</div><div className="kpi-num" style={{ fontSize: 28, lineHeight: '34px' }}>{ctx.kpi.booked}</div></button>
        <button className={`m-card card-btn ${ctx.stage === 'interested' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('interested')} type="button"><div className="muted">Opportunities</div><div className="kpi-num" style={{ fontSize: 28, lineHeight: '34px' }}>{ctx.kpi.opps}</div></button>
        <button className={`m-card card-btn ${ctx.stage === 'lost' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('lost')} type="button"><div className="muted">Deal lost</div><div className="kpi-num" style={{ fontSize: 28, lineHeight: '34px' }}>{ctx.kpi.lost}</div></button>
        <button className={`m-card card-btn ${ctx.stage === 'pipeline' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('pipeline')} type="button"><div className="muted">Pipeline</div><div className="kpi-num" style={{ fontSize: 22, lineHeight: '34px' }}>{ctx.kpi.commission}</div></button>
      </div>
      <div style={{ marginTop: 20 }}>
        <div className="card-title">Campaign flow</div>
        <div className="muted" style={{ paddingBottom: 8 }}>Tap a stage to filter the list</div>
        {ctx.flow.nodes.map((node) => (
          <button key={node.k} onClick={() => ctx.pickStage(node.k)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, padding: '11px 0', border: 0, borderTop: '1px solid rgba(0,0,0,0.04)', background: 'transparent', cursor: 'pointer' }} type="button">
            <span style={{ width: 4, height: 22, borderRadius: 4, background: node.c }} />
            <span style={{ flex: 1, textAlign: 'left', fontWeight: 600, color: node.lfg }}>{node.label}</span>
            <span className="muted">{node.count}</span>
          </button>
        ))}
      </div>
      <div className="row" style={{ margin: '24px 0 12px' }}>
        <span className="card-title" style={{ flex: 1 }}>{ctx.filter ? `Filtered to ${ctx.filter.label}` : 'All leads'}</span>
        {ctx.filter ? <button className="btn" onClick={() => ctx.pickStage(null)} type="button">Clear</button> : null}
      </div>
      <div id="lead-table" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ctx.pageRows.map((row) => <MobileLeadCard ctx={ctx} key={row.id} row={row} source="overview" />)}
      </div>
    </div>
  );
}

function MobileQueue({ ctx }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 600 }}>Work queue</div>
      <div className="muted" style={{ paddingBottom: 14 }}>{ctx.queueLeads.length} leads in the queue</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ctx.queueLeads.map((row) => <MobileLeadCard ctx={ctx} key={row.id} row={row} source="queue" />)}
      </div>
    </div>
  );
}

function MobileCalendar({ ctx }) {
  return (
    <div>
      <div className="row">
        <span style={{ flex: 1, fontSize: 18, fontWeight: 600 }}>{ctx.week.label}</span>
        <button className="sq lg" onClick={() => ctx.setWeekOffset((value) => value - 1)} type="button">‹</button>
        <button className="sq lg" onClick={() => ctx.setWeekOffset((value) => value + 1)} type="button">›</button>
      </div>
      <button className="btn btn-ring" onClick={() => ctx.setWeekOffset(0)} style={{ width: '100%', marginTop: 10 }} type="button">Today</button>
      <div style={{ marginTop: 20 }}>
        {ctx.week.days.map((day) => (
          <div key={day.name} style={{ paddingBottom: 14 }}>
            <div className="row" style={{ padding: '10px 0 8px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
              <span className="day-name">{day.name}</span>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{day.num}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {day.events.map((event) => (
                <button className="event" key={`${event.leadId}-${event.at}`} onClick={() => openLeadById(ctx, event.leadId, 'calendar')} type="button">
                  <strong>{event.at}</strong>
                  <p>{event.machine}</p>
                  <small>{event.phone}</small>
                </button>
              ))}
              {!day.events.length ? <span className="empty-soft">No calls</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="card-title" style={{ paddingBottom: 10 }}>Waiting for a booking</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ctx.waitLeads.map((row) => <MobileLeadCard ctx={ctx} key={row.id} row={row} source="calendar" />)}
        </div>
      </div>
    </div>
  );
}

function MobileListings({ ctx }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 600 }}>Scraped listings</div>
      <div className="muted" style={{ paddingBottom: 14 }}>{ctx.listings.length} visible · queue of {ctx.summary?.eligible || 0} eligible</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ctx.listings.map((listing) => (
          <button
            className="m-lead"
            key={listing.id}
            onClick={() => {
              const lead = ctx.leads.find((row) => row.listingId === listing.nettikone_id);
              if (lead) ctx.openLead(lead, 'listings');
              else if (listing.listing_url) window.open(listing.listing_url, '_blank', 'noopener');
              ctx.setSelectedListingId(listing.id);
            }}
            type="button"
          >
            <h3>{listing.machine_title}</h3>
            <div className="muted">{listing.nettikone_id} · {listing.location || 'No location'}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="pill">{listingStatusLabel(listing.status)}</span>
              <span className="muted">{listing.model_year || 'Year unknown'}</span>
              <span className="grow" />
              <span className={`price ${isSuspiciousPrice(listing.price_text, listing.price_eur) ? 'warn' : ''}`}>{listing.price_text || '-'}</span>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>{listing.normalized_phone || '-'}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MobileLeadCard({ ctx, row, source }) {
  return (
    <button className="m-lead" onClick={() => ctx.openLead(row, source)} type="button">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <h3>{row.machine}</h3>
          <div className="phone-row" style={{ marginTop: 3 }}>
            <Glyph name="WhatsappLogoWeightFill" size={13} />
            <span>{row.phone}</span>
          </div>
        </div>
        <span className="icon-btn dark" style={{ width: 40, height: 40 }}><Glyph name="ChatTextWeightRegular" size={18} /></span>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="dot" style={{ background: statusDot(row.stage) }} />
        <span>{row.stage}</span>
        <span className="grow" />
        <span className={`price ${row.priceFlag ? 'warn' : ''}`}>{row.price}</span>
        <span className="muted">{row.ago}</span>
      </div>
    </button>
  );
}

function toLead({ listing = {}, conversation = {}, calendarCalls = [] }) {
  const id = listing.nettikone_id || conversation.source_customer_id || conversation.session_id || conversation.number;
  const reconciled = reconcileLead({ listing, conversation, calendarCalls });
  const last = (conversation.messages || []).at(-1);
  const hours = listing.operating_hours ? `${String(listing.operating_hours).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} h` : '—';
  return {
    id,
    listingId: listing.nettikone_id || '',
    machine: listing.machine_title || conversation.number || 'Listing',
    phone: conversation.number || listing.normalized_phone || '-',
    seller: listing.seller_name || (listing.prospect_id ? `Seller ${listing.prospect_id}` : 'Seller'),
    location: (listing.location || 'No location').split(',')[0],
    price: listing.price_text || '-',
    priceFlag: isSuspiciousPrice(listing.price_text, listing.price_eur),
    year: listing.model_year || 'Year unknown',
    hours,
    reg: listing.registration_number || 'Ei rekisterissä',
    notes: listing.description || 'No description stored.',
    outbound: buildOutboundMessage(listing.machine_title),
    url: listing.listing_url,
    stage: reconciled.stage,
    priceEur: listing.price_eur,
    replied: reconciled.replied,
    noReply: reconciled.noReply,
    interestedSignal: reconciled.interestedSignal,
    notInterestedSignal: reconciled.notInterestedSignal,
    reviewSignal: reconciled.reviewSignal,
    won: reconciled.won,
    lost: reconciled.lost,
    booked: reconciled.booked,
    awaiting: reconciled.awaiting,
    ago: relativeAgo(last?.at || conversation.last_inbound_at || conversation.updated_at || listing.updated_at),
    snippet: last?.message || 'No messages yet',
    fields: [
      { k: 'Model year', v: listing.model_year || '-' },
      { k: 'Hours', v: hours },
      { k: 'Asking price', v: listing.price_text || '-' },
      { k: 'Registration', v: listing.registration_number || 'Ei rekisterissä' },
      { k: 'Location', v: listing.location || '-' },
      { k: 'Seller prospect', v: listing.seller_name || listing.prospect_id || '-' },
      { k: 'Phone', v: conversation.number || listing.normalized_phone || '-' },
      { k: 'Nettikone ID', v: listing.nettikone_id || '-' },
    ],
    msgs: (conversation.messages || []).map((message) => ({
      id: message.id,
      who: message.sender || (message.direction === 'outbound' ? 'NordKone' : 'Seller'),
      when: formatHelsinkiTime(message.at),
      text: message.message,
      out: message.direction === 'outbound',
    })),
  };
}

function scrapedCount(summary) {
  if (!summary) return 0;
  return (
    (summary.eligible || 0) +
    (summary.contacted_listings || 0) +
    (summary.interested_listings || 0) +
    (summary.sold_listings || 0) +
    (summary.not_interested_listings || 0) +
    (summary.opted_out_listings || 0)
  );
}

function leadPos(ctx) {
  const index = ctx.leads.findIndex((lead) => lead.id === ctx.selectedLead?.id);
  return `${Math.max(index, 0) + 1} of ${ctx.leads.length}`;
}

function openLeadById(ctx, id, source) {
  const lead = ctx.leads.find((row) => row.id === id || row.listingId === id || row.phone === id);
  if (lead) ctx.openLead(lead, source);
}

function whatsAppHref(phone) {
  return `https://wa.me/${String(phone || '').replace(/[^\d]/g, '')}`;
}

function OverviewSkeleton({ mobile = false }) {
  if (mobile) {
    return (
      <div className="page-in">
        <div className="m-kpis">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="m-card" key={index}>
              <div className="skel skel-line" style={{ width: 72 }} />
              <div className="skel skel-num" />
            </div>
          ))}
        </div>
        <div className="skel-block" style={{ marginTop: 20 }}>
          <div className="skel skel-line" style={{ width: 140, marginBottom: 16 }} />
          {Array.from({ length: 6 }, (_, index) => (
            <div className="skel-row" key={index}>
              <div className="skel" style={{ width: 4, height: 22, borderRadius: 4 }} />
              <div className="skel skel-line" style={{ flex: 1 }} />
              <div className="skel skel-line" style={{ width: 48 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="scroll page-in">
      <div className="kpis">
        <div className="card card-wide skel-card"><div className="skel skel-line" style={{ width: 90 }} /><div className="skel skel-chart" /><div className="skel skel-num" /></div>
        <div className="card card-mid skel-card"><div className="skel skel-line" style={{ width: 110 }} /><div className="skel skel-num" style={{ marginTop: 18 }} /><div className="skel skel-line" style={{ width: 80, marginTop: 10 }} /></div>
        <div className="card card-mid skel-card"><div className="skel skel-line" style={{ width: 80 }} /><div className="skel skel-num" style={{ marginTop: 18 }} /><div className="skel skel-line" style={{ width: 80, marginTop: 10 }} /></div>
        <div className="card card-wide skel-card"><div className="skel skel-line" style={{ width: 70 }} /><div className="skel skel-num" style={{ marginTop: 18 }} /><div className="skel skel-line" style={{ width: 180, marginTop: 10 }} /></div>
      </div>
      <div className="charts">
        <div className="card flow-card skel-card">
          <div className="skel skel-line" style={{ width: 140 }} />
          <div className="skel skel-flow" />
        </div>
        <div className="card reply-card skel-card">
          <div className="skel skel-line" style={{ width: 110 }} />
          <div className="skel skel-chart" style={{ height: 140, marginTop: 18 }} />
        </div>
      </div>
      <TableSkeleton />
    </div>
  );
}

function TableSkeleton({ compact = false }) {
  return (
    <div className="skel-table">
      {Array.from({ length: compact ? 4 : 7 }, (_, index) => (
        <div className="skel-lead" key={index} style={{ animationDelay: `${index * 50}ms` }}>
          <div style={{ flex: 1 }}>
            <div className="skel skel-line" style={{ width: '46%' }} />
            <div className="skel skel-line" style={{ width: '28%', marginTop: 8 }} />
          </div>
          <div className="skel skel-line" style={{ width: compact ? 90 : 120 }} />
          <div className="skel skel-line" style={{ width: 70 }} />
        </div>
      ))}
    </div>
  );
}

const rootEl = document.getElementById('root');
const root = window.__nordkoneRoot || createRoot(rootEl);
window.__nordkoneRoot = root;
root.render(<App />);
