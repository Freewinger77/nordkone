import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiGet, apiSend } from './lib/api.js';
import { Glyph, WhatsAppMark } from './lib/icons.jsx';
import {
  DESK_STATUSES,
  FLOW_FILTERS,
  QUEUE_KEY,
  bookedSpark,
  buildFlow,
  buildVerticalFlow,
  buildOutboundMessage,
  buildWeek,
  countFlow,
  cut,
  formatEuro,
  displayAskingPrice,
  formatHelsinkiTime,
  isOpenOpportunity,
  isSuspiciousPrice,
  listingStatusLabel,
  loadJson,
  parseEuroAmount,
  poly,
  reconcileLead,
  relativeAgo,
  saveJson,
  smooth,
  stageLabel,
  statusDot,
  statusWash,
  weekdayReplySeries,
} from './lib/desk.js';
import { Login } from './Login.jsx';
import { PriceSlider } from './lib/PriceSlider.jsx';
import { machineClassMeta } from '../../shared/machine-class.js';
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
  const [activitySort, setActivitySort] = useState('newest');
  const [weekOffset, setWeekOffset] = useState(0);
  const [modal, setModal] = useState(false);
  const [advOpen, setAdvOpen] = useState(true);
  const [leadTab, setLeadTab] = useState('chat');
  const [menuFor, setMenuFor] = useState(null);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selectedListingId, setSelectedListingId] = useState(null);
  const [capDraft, setCapDraft] = useState('20');
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [scrapeNote, setScrapeNote] = useState('');
  const [authed, setAuthed] = useState(null);

  const isDesktop = vw >= 1120;

  async function load({ boot = false } = {}) {
    const started = Date.now();
    if (boot) setBooting(true);
    else setRefreshing(true);
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
      if (boot) {
        const wait = Math.max(0, 680 - (Date.now() - started));
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        setBooting(false);
      }
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setAuthed(Boolean(data.ok));
      })
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authed) load({ boot: true });
  }, [authed]);

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
            derived_status: call.classification === 'ready_for_call' ? 'ready_for_call' : call.classification || 'interested',
          },
          calendarCalls,
        })
      );

    return [...fromConversations, ...extras];
  }, [calendarCalls, conversations, listingById, pendingCallbacks]);

  useEffect(() => {
    if (!leads.length) return;
    if (queue === null) {
      setQueue(leads.filter(isLiveQueueLead).map((lead) => lead.id));
      return;
    }
    const live = new Set(leads.filter(isLiveQueueLead).map((lead) => lead.id));
    const next = queue.filter((id) => live.has(id));
    if (next.length !== queue.length) setQueue(next);
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
      const result = await apiSend('/api/settings', { method: 'PUT', body: { settings: next } });
      const saved = result.settings || next;
      setSettings((current) => ({ ...(current || {}), ...saved }));
      if (saved.daily_cap != null) setCapDraft(String(saved.daily_cap));
      const candidateData = await apiGet('/api/outbound/candidates?limit=1').catch(() => ({ control: null }));
      if (candidateData.control) {
        setControl(candidateData.control);
      } else {
        setControl((current) => {
          const cap = Number(saved.daily_cap ?? current?.daily_cap ?? 0);
          const sent = current?.sent_today ?? 0;
          const on = saved.outbound_enabled ?? current?.outbound_enabled;
          return {
            ...(current || {}),
            outbound_enabled: on,
            daily_cap: cap,
            sent_today: sent,
            remaining_today: on ? Math.max(cap - sent, 0) : 0,
            reason: !on ? 'outbound_disabled' : cap - sent <= 0 ? 'daily_cap_reached' : 'ok',
          };
        });
      }
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
      const result = await apiSend('/api/scrape/run?targetNew=40&maxPages=40&maxListings=80', { method: 'POST' });
      const stats = result.stats || {};
      const extra =
        stats.stop_reason === 'time_budget'
          ? ' · stopped early, click again'
          : stats.stop_reason === 'no_results'
            ? ' · reached the last page'
            : '';
      setScrapeNote(`${stats.new_leads || 0} new leads · ${stats.pages_scanned || 0} pages${extra}`);
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
        body: { nettikone_id: lead.listingId, desk_status: deskStatus === 'Call Now' ? 'Callback' : deskStatus === 'Lost / Sold' ? 'Deal Lost' : deskStatus },
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
  const vFlow = useMemo(() => buildVerticalFlow(flowCounts, stage), [flowCounts, stage]);
  const replies = useMemo(() => weekdayReplySeries(conversations), [conversations]);
  const spark = useMemo(() => bookedSpark(calendarCalls), [calendarCalls]);
  const week = useMemo(
    () => buildWeek(weekOffset, calendarCalls, leads.filter((lead) => lead.callback && !lead.booked)),
    [calendarCalls, leads, weekOffset]
  );

  const pipelineLeads = leads.filter(isOpenOpportunity);
  const pipelineAsk = pipelineLeads.reduce((sum, lead) => sum + parseEuroAmount(lead.priceEur || lead.price), 0);
  const pipelineCut = Math.round(pipelineAsk * 0.05);
  const replyTotal = replies.office.reduce((a, b) => a + b, 0) + replies.after.reduce((a, b) => a + b, 0);
  const afterShare = replyTotal ? Math.round((replies.after.reduce((a, b) => a + b, 0) / replyTotal) * 100) : 0;
  const kpi = {
    booked: String(flowCounts.booked || 0),
    bookedDelta: flowCounts.booked ? `${flowCounts.booked} live` : '',
    opps: String(flowCounts.callback || flowCounts.interested || 0),
    won: String(flowCounts.won || 0),
    lost: String(flowCounts.lost || 0),
    oppPct: flowCounts.replied ? `${Math.round((flowCounts.interested / flowCounts.replied) * 100)}% of replies` : 'of replies',
    wonPct: flowCounts.replied ? `${Math.round((flowCounts.won / flowCounts.replied) * 100)}% of replies` : 'of replies',
    lostPct: flowCounts.replied ? `${Math.round((flowCounts.lost / flowCounts.replied) * 100)}% of replies` : 'of replies',
    commission: formatEuro(pipelineCut) || '0 €',
    commissionSub: pipelineAsk
      ? `Assumed 5% of seller price totalling ${formatEuro(pipelineAsk)}`
      : 'No asking prices on open opportunities yet',
  };

  const queueIds = queue || [];
  const outboundOn = Boolean(settings?.outbound_enabled);
  const sentToday = control?.sent_today ?? 0;
  const dailyCap = Number(settings?.daily_cap ?? control?.daily_cap ?? 0);
  const obPct = `${Math.min(100, Math.round((sentToday / Math.max(dailyCap, 1)) * 100))}%`;

  const bookedLeads = leads.filter((lead) => lead.booked);
  const waitLeads = leads.filter((lead) => lead.callback || lead.awaiting);
  const titles = { overview: 'Overview', queue: 'Work queue', calendar: 'Calendar', listings: 'Listings' };
  const baseView = view === 'lead' ? from || 'overview' : view;
  const nav = [
    { id: 'overview', label: 'Overview', short: 'Overview', count: '', icon: 'ChartLineWeightRegular' },
    { id: 'queue', label: 'Work queue', short: 'Queue', count: String(queueIds.length || ''), icon: 'TrayWeightRegular' },
    { id: 'calendar', label: 'Calendar', short: 'Calendar', count: String((calendarCalls.length || 0) + waitLeads.length), icon: 'ClockCounterClockwiseWeightRegular' },
    { id: 'listings', label: 'Listings', short: 'Listings', count: String(summary?.eligible || listings.length || ''), icon: 'NotebookWeightRegular' },
  ];

  const filter = stage ? FLOW_FILTERS[stage] : null;
  const filtered = filter ? leads.filter(filter.test) : leads;
  const pool = [...filtered].sort((a, b) => {
    const delta = (b.activityAt || 0) - (a.activityAt || 0);
    return activitySort === 'oldest' ? -delta : delta;
  });
  const pageCount = Math.max(1, Math.ceil(pool.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = pool.slice((safePage - 1) * pageSize, safePage * pageSize);
  const queueLeads = leads.filter((lead) => queueIds.includes(lead.id) && isLiveQueueLead(lead));

  const ctx = {
    activitySort,
    advOpen,
    baseView,
    bookedLeads,
    canUseControls,
    capDraft,
    dailyCap,
    error,
    filter,
    flow,
    vFlow,
    from,
    isDesktop,
    kpi,
    leadTab,
    leads,
    listings,
    loading,
    booting,
    refreshing,
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
      setStage(key);
      setPage(1);
      setView('overview');
      requestAnimationFrame(() => {
        document.getElementById('lead-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    remainingToday: control?.remaining_today ?? Math.max(dailyCap - sentToday, 0),
    runScrape,
    saveCap: () => updateSettings({ daily_cap: Math.max(Number(capDraft) || 0, 0) }),
    saveOutboundFilters: (outbound_filters) => updateSettings({ outbound_filters }),
    settings,
    toggleActivitySort: () => {
      setActivitySort((value) => (value === 'newest' ? 'oldest' : 'newest'));
      setPage(1);
    },
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
    signOut: async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      setAuthed(false);
    },
  };

  if (authed === null) return <div className="login-app" aria-busy="true" />;
  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

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
          {ctx.booting || ctx.refreshing ? <span className="boot-pulse" aria-hidden="true" /> : null}
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
        <button className="sign-out" onClick={ctx.signOut} type="button">Sign out</button>
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
            <span className="m-tab-icon">
              <Glyph name={item.icon} size={20} />
            </span>
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
            <span className="nav-count">{ctx.booting ? <span className="skel skel-count" /> : item.count}</span>
          </button>
        ))}
      </nav>
      <div className="grow" />
      <div className={`ob-card ${ctx.booting ? 'is-loading' : ''}`}>
        <div className="ob-head">
          <span className={`dot ${ctx.outboundOn && !ctx.booting ? 'live' : ''}`} />
          <span className="ob-title">{ctx.booting ? 'Loading desk' : ctx.outboundOn ? 'Outbound on' : 'Outbound off'}</span>
        </div>
        <div className="bar"><i style={{ width: ctx.booting ? '28%' : ctx.obPct }} /></div>
        {ctx.booting ? (
          <>
            <div className="skel skel-line" style={{ width: '70%', marginTop: 8 }} />
            <div className="skel skel-line" style={{ width: '48%', marginTop: 6 }} />
          </>
        ) : (
          <>
            <div className="muted">{ctx.sentToday} of {ctx.dailyCap} sent</div>
            <div className="muted">
              {!ctx.outboundOn ? 'WF-1 paused' : ctx.remainingToday <= 0 ? 'Daily cap reached' : `${ctx.remainingToday} left today`}
            </div>
          </>
        )}
        {ctx.canUseControls ? (
          <button className="ob-link" onClick={ctx.openModal} type="button">Open controls →</button>
        ) : null}
      </div>
      <button className="sign-out" onClick={ctx.signOut} type="button">Sign out</button>
    </aside>
  );
}

function Overview({ ctx }) {
  if (ctx.booting) return <OverviewSkeleton />;
  return (
    <div className="scroll page-in">
      <div className="kpis">
        <button className={`card card-btn rise-in ${ctx.stage === 'booked' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('booked')} type="button">
          <div className="kpi-head">
            <span className="card-title">Calls booked</span>
            {ctx.kpi.bookedDelta ? <span className="up">{ctx.kpi.bookedDelta}</span> : null}
          </div>
          <div className="kpi-row">
            <span className="kpi-num">{ctx.kpi.booked}</span>
            <svg className="kpi-spark" viewBox="0 0 260 36" preserveAspectRatio="none">
              <path className="line-draw" d={poly(ctx.spark.length ? ctx.spark : [0, 0, 0, 0, 0, 0, 0], 260, 36, 4)} fill="none" stroke="rgb(0,0,0)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="muted kpi-sub">Live calendar bookings</div>
        </button>
        <button className={`card card-btn rise-in ${ctx.stage === 'callback' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('callback')} type="button">
          <div className="kpi-head">
            <span className="dot live" />
            <span className="card-title">Opportunities</span>
          </div>
          <div className="kpi-num">{ctx.kpi.opps}</div>
          <div className="muted kpi-sub">{ctx.kpi.oppPct}</div>
        </button>
        <button className={`card card-btn rise-in ${ctx.stage === 'won' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('won')} type="button">
          <div className="kpi-head">
            <span className="dot" style={{ background: 'rgb(113, 221, 140)' }} />
            <span className="card-title">Deal won</span>
          </div>
          <div className="kpi-num">{ctx.kpi.won}</div>
          <div className="muted kpi-sub">{ctx.kpi.wonPct}</div>
        </button>
        <button className={`card card-btn rise-in ${ctx.stage === 'lost' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('lost')} type="button">
          <div className="kpi-head">
            <span className="dot" style={{ background: 'rgb(255,71,71)' }} />
            <span className="card-title">Lost / Sold</span>
          </div>
          <div className="kpi-num">{ctx.kpi.lost}</div>
          <div className="muted kpi-sub">{ctx.kpi.lostPct}</div>
        </button>
        <button className={`card card-btn rise-in ${ctx.stage === 'pipeline' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('pipeline')} type="button">
          <div className="kpi-head">
            <span className="card-title">Pipeline</span>
            <span className="kpi-chip">5%</span>
          </div>
          <div className="kpi-num">{ctx.kpi.commission}</div>
          <div className="muted kpi-sub">{ctx.kpi.commissionSub}</div>
        </button>
      </div>

      <div className="charts">
        <article className="card flow-card rise-in">
          <div className="wrap">
            <span className="card-title">Campaign flow</span>
            <span className="muted">{scrapedCount(ctx.summary)} scraped · {ctx.summary?.eligible || 0} not messaged</span>
            <span className="grow" />
            <span className="muted">Click a stage to filter</span>
          </div>
          <CampaignFlow flow={ctx.flow} onPick={ctx.pickStage} stage={ctx.stage} />
        </article>

        <article className="card reply-card rise-in">
          <div className="reply-head">
            <div className="wrap">
              <span className="card-title">Reply timing</span>
              <span className="muted">{ctx.replyTotal} this week · {ctx.afterShare}% after hours</span>
            </div>
            <div className="legend">
              <div className="legend-item"><span className="legend-line" style={{ background: 'rgb(0,0,0)' }} />Office {ctx.replies.office.reduce((a, b) => a + b, 0)}</div>
              <div className="legend-item"><span className="legend-line" style={{ background: 'rgb(184,153,235)' }} />After hours {ctx.replies.after.reduce((a, b) => a + b, 0)}</div>
            </div>
          </div>
          <svg className="reply-svg" viewBox="0 0 320 160" preserveAspectRatio="none">
            <path className="line-draw" d={smooth(ctx.replies.office, 320, 160, 10)} fill="none" stroke="rgb(0,0,0)" strokeWidth="2" />
            <path className="line-draw" d={smooth(ctx.replies.after, 320, 160, 10)} fill="none" stroke="rgb(184,153,235)" strokeWidth="2" />
          </svg>
          <div className="weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
        </article>
      </div>

      <div id="lead-table">
        <LeadTable ctx={ctx} rows={ctx.pageRows} showPager />
      </div>
    </div>
  );
}

function WorkQueue({ ctx }) {
  if (ctx.booting) return <QueueSkeleton />;
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
  if (ctx.booting) return <CalendarSkeleton />;
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
                <button className={`event ${event.kind === 'callback' ? 'event-callback' : ''}`} key={`${event.kind}-${event.leadId}-${event.at}`} onClick={() => openLeadById(ctx, event.leadId, 'calendar')} type="button">
                  <strong>{event.kind === 'callback' ? 'Call Now' : event.at}</strong>
                  <p>{event.machine}</p>
                  <small>{event.kind === 'callback' ? event.at : event.phone}</small>
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
  if (ctx.booting) return <ListingsSkeleton />;
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
          <div className={`listing-row ${listing?.id === row.id ? 'on' : ''}`} key={row.id} onClick={() => ctx.setSelectedListingId(row.id)} style={{ animationDelay: `${Math.min(ctx.listings.indexOf(row), 12) * 24}ms` }}>
            <div className="col-lead">
              <div className="machine">{row.machine_title}</div>
              <div className="muted">{row.nettikone_id} · {row.location || 'No location'}</div>
              <span className="type-pill">{machineClassMeta(row.machine_class).label}</span>
            </div>
            <div className="col-price">
              <div className={`price ${isSuspiciousPrice(row.price_text, row.price_eur) ? 'warn' : ''}`}>{displayAskingPrice(row.price_text, row.price_eur)}</div>
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
        {!ctx.listings.length && !ctx.booting ? <div className="muted" style={{ padding: '20px 33px' }}>No listings found.</div> : null}
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
                  ['Price', displayAskingPrice(listing.price_text, listing.price_eur)],
                  ['Model year', listing.model_year || '-'],
                  ['Location', listing.location || '-'],
                  ['Registration', listing.registration_number || 'Ei rekisterissä'],
                  ['Type', machineClassMeta(listing.machine_class).label],
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
                <button
                  className="btn-block"
                  disabled={ctx.sending || !listing.normalized_phone || !ctx.outboundOn || ctx.remainingToday <= 0}
                  onClick={() => ctx.sendListing(listing)}
                  type="button"
                >
                  {ctx.sending
                    ? 'Sending...'
                    : !ctx.outboundOn
                      ? 'Outbound is off'
                      : ctx.remainingToday <= 0
                        ? 'Daily cap reached'
                        : 'Send and open session'}
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  return (
    <>
      {!hideToolbar ? (
        <div className="toolbar">
          <div className="filter-pop">
            <button className={`btn btn-ring ${filtersOpen || ctx.filter ? 'is-on' : ''}`} onClick={() => setFiltersOpen((open) => !open)} type="button">
              <Glyph name="FunnelSimpleWeightRegular" size={17} />
              Filters
            </button>
            {filtersOpen ? (
              <>
                <button className="filter-scrim" onClick={() => setFiltersOpen(false)} type="button" aria-label="Close filters" />
                <div className="filter-menu" role="menu">
                  <button className={`filter-item ${ctx.stage ? '' : 'on'}`} onClick={() => { ctx.pickStage(null); setFiltersOpen(false); }} type="button">
                    All leads
                  </button>
                  {Object.entries(FLOW_FILTERS).map(([key, row]) => (
                    <button
                      className={`filter-item ${ctx.stage === key ? 'on' : ''}`}
                      key={key}
                      onClick={() => { ctx.pickStage(key); setFiltersOpen(false); }}
                      type="button"
                    >
                      {row.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          {ctx.filter ? (
            <button className="btn btn-soft" onClick={() => ctx.pickStage(null)} type="button">
              {`Filtered to ${ctx.filter.label}`} <span style={{ color: 'rgba(0,0,0,0.4)' }}>×</span>
            </button>
          ) : null}
          <span className="grow" />
          <span className="muted">{ctx.pool.length} leads</span>
          <button className="btn" onClick={ctx.toggleActivitySort} type="button">
            <Glyph name="ArrowsDownUpWeightRegular" size={17} />
            Last activity · {ctx.activitySort === 'oldest' ? 'Oldest' : 'Newest'}
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
                <WhatsAppMark size={13} />
                <span>{row.phone}</span>
              </div>
            </div>
            <div className={compact ? '' : 'col-status'} style={compact ? { width: 150, flexShrink: 0 } : undefined}>
              <div className="status-line">
                <span className="dot" style={{ background: statusDot(row.stage) }} />
                <span>{stageLabel(row.stage)}</span>
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
              <div className={compact ? 'muted' : 'ago'}>{row.ago}</div>
              {!compact ? <div className="snippet">{cut(row.snippet, 30)}</div> : null}
            </div>
            {!compact ? (
              <div className="col-chat">
                {!ctx.queue.includes(row.id) ? (
                  <button className="icon-btn" onClick={(event) => ctx.toggleQueue(row.id, event)} type="button">
                    <Glyph name="ArrowLineRightWeightBold" size={15} />
                  </button>
                ) : null}
                <a className="icon-btn dark" href={whatsAppHref(row.phone)} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">
                  <Glyph name="ChatTextWeightRegular" size={17} />
                </a>
              </div>
            ) : null}
          </div>
        ))}
        {ctx.booting ? <TableSkeleton compact={compact} /> : null}
        {!rows.length && !ctx.booting ? (
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
              <button className="btn btn-ring status-pill" onClick={() => ctx.setMenuFor(ctx.menuFor === 'lead' ? null : 'lead')} style={{ background: statusWash(lead.stage) }} type="button">
                <span className="dot" style={{ background: statusDot(lead.stage) }} />
                {stageLabel(lead.stage)} ▾
              </button>
              {ctx.menuFor === 'lead' ? (
                <div className="menu wide">
                  {DESK_STATUSES.map((option) => (
                    <button className="menu-item" key={option.label} onClick={() => ctx.setDeskStatus(lead, option.label)} type="button">
                      <span className="dot" style={{ background: option.dot }} />
                      <span style={{ fontWeight: option.label === stageLabel(lead.stage) ? 600 : 400 }}>{option.label}</span>
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
              <WhatsAppMark size={14} />
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
          <button className="sq sheet-nav" onClick={ctx.closeLead} type="button">‹</button>
          <span className="grow" />
          <span className="muted">{leadPos(ctx)}</span>
          <button className="sq sheet-nav" onClick={() => ctx.stepLead(-1)} type="button">↑</button>
          <button className="sq sheet-nav" onClick={() => ctx.stepLead(1)} type="button">↓</button>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>{lead.machine}</div>
          <div className="phone-row" style={{ marginTop: 3 }}>
            <WhatsAppMark size={14} />
            <span>{lead.phone}</span>
          </div>
        </div>
        <div className="rel" style={{ marginTop: 12 }}>
          <button className="btn btn-ring status-pill" onClick={() => ctx.setMenuFor(ctx.menuFor === 'lead' ? null : 'lead')} style={{ height: 40, background: statusWash(lead.stage) }} type="button">
            <span className="dot" style={{ background: statusDot(lead.stage), width: 8, height: 8 }} />
            {stageLabel(lead.stage)} ▾
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
        <div className="seg">
          <button className={ctx.leadTab === 'chat' ? 'on' : ''} onClick={() => ctx.setLeadTab('chat')} type="button">Chat</button>
          <button className={ctx.leadTab === 'advert' ? 'on' : ''} onClick={() => ctx.setLeadTab('advert')} type="button">Advert</button>
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
        {ctx.leadTab === 'chat' ? null : (
          <a className="btn btn-dark" href={whatsAppHref(lead.phone)} rel="noreferrer" style={{ flex: 1, height: 48 }} target="_blank">
            <WhatsAppMark size={18} />
            Open chat
          </a>
        )}
      </div>
    </div>
  );
}

function OutboundModal({ ctx, onClose }) {
  const sliderMax = 500000;
  const saved = ctx.settings?.outbound_filters || { machine_classes: [], price_min: 0, price_max: null };
  const [classes, setClasses] = useState(saved.machine_classes || []);
  const [priceMin, setPriceMin] = useState(saved.price_min || 0);
  const [priceMax, setPriceMax] = useState(saved.price_max == null ? sliderMax : saved.price_max);
  const [scope, setScope] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (classes.length) params.set('classes', classes.join(','));
    params.set('price_min', String(priceMin || 0));
    if (priceMax < sliderMax) params.set('price_max', String(priceMax));
    const timer = setTimeout(() => {
      apiGet(`/api/outbound/scope?${params}`)
        .then((data) => {
          if (!cancelled) setScope(data);
        })
        .catch(() => {
          if (!cancelled) setScope(null);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [classes, priceMin, priceMax]);

  const selected = new Set(classes);
  const catalog = scope?.classes || [];
  const matching = scope?.matching;

  function toggleClass(id) {
    setClasses((current) => {
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      if (next.length === catalog.length) return [];
      return next;
    });
  }

  function saveFilters() {
    ctx.saveOutboundFilters({
      machine_classes: classes,
      price_min: priceMin || 0,
      price_max: priceMax >= sliderMax ? null : priceMax,
    });
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600 }}>Outbound</div>
            <div className="muted" style={{ marginTop: 2 }}>Pick machine types and a price band. Sending stays off until you flip the switch.</div>
          </div>
          <button className="sq lg" onClick={onClose} type="button">×</button>
        </div>
        <div className="card" style={{ display: 'flex', gap: 16, marginTop: 20, padding: 16 }}>
          <span className={`dot ${ctx.outboundOn ? 'live' : ''}`} style={{ marginTop: 7 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600 }}>{ctx.outboundOn ? 'Outbound on' : 'Outbound off'}</div>
            <div className="muted">{ctx.outboundOn ? 'Leads are picked only while this is on, the daily cap has room, and they match the filters below.' : 'No candidates are being sent.'}</div>
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
        <div style={{ marginTop: 28 }}>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Machine types</div>
            <button className="link-clear" onClick={() => setClasses([])} type="button">All types</button>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>NordKone buys more than excavators. Combine any Nettikone classes.</div>
          <div className="class-grid">
            {catalog.map((row) => {
              const on = selected.has(row.id);
              return (
                <button
                  aria-checked={on}
                  className={`class-chip ${on ? 'on' : ''}`}
                  key={row.id}
                  onClick={() => toggleClass(row.id)}
                  role="checkbox"
                  type="button"
                >
                  <i className="class-check" />
                  <span className="class-name">{row.label}</span>
                  <span className="class-count">{row.count ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: 28 }}>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Price range</div>
            <span className="muted">{formatSliderBound(priceMin)} – {priceMax >= sliderMax ? 'No max' : formatSliderBound(priceMax)}</span>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>Airbnb-style band across every asking price, including cheap attachments and six-figure dealers.</div>
          <PriceSlider
            histogram={scope?.price?.histogram || []}
            max={sliderMax}
            onChange={(nextMin, nextMax) => {
              setPriceMin(nextMin);
              setPriceMax(nextMax);
            }}
            valueMax={priceMax}
            valueMin={priceMin}
          />
          <div className="air-labels">
            <span>0 €</span>
            <span>500k €</span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 22, alignItems: 'center' }}>
          <div className="muted" style={{ flex: 1 }}>
            {matching == null ? 'Counting matching leads…' : `${matching} eligible lead${matching === 1 ? '' : 's'} match this mix`}
          </div>
          <button className="btn btn-dark" disabled={ctx.saving || !ctx.canUseControls} onClick={saveFilters} type="button">
            Save filters
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSliderBound(value) {
  const amount = Number(value) || 0;
  if (amount >= 1000) return `${Math.round(amount / 1000)}k €`;
  return `${amount} €`;
}

function CampaignFlow({ flow, onPick, stage, vertical = false }) {
  if (!flow?.nodes?.length) return null;
  return (
    <div className={vertical ? 'flow-wrap v-flow' : 'flow-wrap'}>
      <svg
        className={vertical ? 'v-flow-svg' : 'flow-svg'}
        preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${flow.vw || 1100} / ${flow.vh || 340}` }}
        viewBox={`0 0 ${flow.vw || 1100} ${flow.vh || 340}`}
      >
        {flow.links.map((link) => (
          <path
            d={link.d}
            fill="rgba(0,0,0,0.09)"
            key={`${link.from}-${link.to}`}
            onClick={(event) => {
              event.stopPropagation();
              onPick(link.to);
            }}
            style={{ cursor: 'pointer' }}
          />
        ))}
        {flow.nodes.map((node) => (
          <g
            key={node.k}
            onClick={(event) => {
              event.stopPropagation();
              onPick(node.k);
            }}
            style={{ cursor: 'pointer' }}
          >
            <rect
              fill="transparent"
              height={node.h + (vertical ? 22 : 16)}
              width={node.w + (vertical ? 8 : 28)}
              x={node.x - (vertical ? 4 : 14)}
              y={node.y - (vertical ? 8 : 8)}
            />
            <rect
              fill={node.c}
              height={node.h}
              rx="5"
              stroke={stage === node.k ? 'rgb(0,0,0)' : 'none'}
              strokeWidth={stage === node.k ? 2 : 0}
              width={node.w}
              x={node.x}
              y={node.y}
            />
          </g>
        ))}
      </svg>
      {flow.nodes.map((node) => (
        <div
          className={`flow-label${vertical ? ' v-flow-label' : ''}${stage === node.k ? ' is-on' : ''}`}
          key={`${node.k}-label`}
          onClick={() => onPick(node.k)}
          style={{ left: node.left, maxWidth: vertical ? node.labelMax : undefined, top: node.top }}
        >
          <strong style={{ color: node.lfg }}>{node.label}</strong>
          <span>{node.count}</span>
        </div>
      ))}
    </div>
  );
}

function MobileOverview({ ctx }) {
  if (ctx.booting) return <OverviewSkeleton mobile />;
  return (
    <div className="page-in">
      <div className="m-kpis">
        <button className={`m-card card-btn ${ctx.stage === 'booked' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('booked')} type="button">
          <div className="muted">Calls booked</div>
          <div className="kpi-num">{ctx.kpi.booked}</div>
        </button>
        <button className={`m-card card-btn ${ctx.stage === 'callback' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('callback')} type="button">
          <div className="muted">Opportunities</div>
          <div className="kpi-num">{ctx.kpi.opps}</div>
        </button>
        <button className={`m-card card-btn ${ctx.stage === 'won' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('won')} type="button">
          <div className="muted">Deal won</div>
          <div className="kpi-num">{ctx.kpi.won}</div>
        </button>
        <button className={`m-card card-btn ${ctx.stage === 'lost' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('lost')} type="button">
          <div className="muted">Lost / Sold</div>
          <div className="kpi-num">{ctx.kpi.lost}</div>
        </button>
        <button className={`m-card m-pipe card-btn ${ctx.stage === 'pipeline' ? 'card-on' : ''}`} onClick={() => ctx.pickStage('pipeline')} type="button">
          <div className="kpi-head">
            <div className="muted">Pipeline</div>
            <span className="kpi-chip">5%</span>
          </div>
          <div className="kpi-num">{ctx.kpi.commission}</div>
          <div className="muted kpi-sub">{ctx.kpi.commissionSub}</div>
        </button>
      </div>
      <div className="v-flow-card">
        <div className="card-title">Campaign flow</div>
        <div className="muted" style={{ paddingBottom: 8 }}>Tap a stage to filter the list</div>
        <CampaignFlow flow={ctx.vFlow} onPick={ctx.pickStage} stage={ctx.stage} vertical />
      </div>
      <div className="row" style={{ margin: '24px 0 12px', gap: 10 }}>
        <span className="card-title" style={{ flex: 1 }}>{ctx.filter ? `Filtered to ${ctx.filter.label}` : 'All leads'}</span>
        {ctx.filter ? <button className="link-clear" onClick={() => ctx.pickStage(null)} type="button">Clear</button> : null}
        <button className="btn" onClick={ctx.toggleActivitySort} type="button">
          {ctx.activitySort === 'oldest' ? 'Oldest' : 'Newest'}
        </button>
        <span className="muted">{ctx.pool.length ? `${(ctx.page - 1) * ctx.pageSize + 1}–${Math.min(ctx.page * ctx.pageSize, ctx.pool.length)} of ${ctx.pool.length}` : '0 of 0'}</span>
      </div>
      <div id="lead-table" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ctx.pageRows.map((row) => <MobileLeadCard ctx={ctx} key={row.id} row={row} source="overview" />)}
      </div>
      {ctx.pageCount > 1 ? (
        <div className="m-pager">
          <button className="btn btn-ring" onClick={() => ctx.setPage(Math.max(1, ctx.page - 1))} type="button">Previous</button>
          <button className="btn btn-ring" onClick={() => ctx.setPage(Math.min(ctx.pageCount, ctx.page + 1))} type="button">Next</button>
        </div>
      ) : null}
    </div>
  );
}

function MobileQueue({ ctx }) {
  if (ctx.booting) return <MobileCardsSkeleton title />;
  return (
    <div className="page-in">
      <div style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600 }}>Work queue</div>
      <div className="muted" style={{ paddingBottom: 14 }}>{ctx.queueLeads.length} leads in the queue</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ctx.queueLeads.map((row) => <MobileLeadCard ctx={ctx} key={row.id} row={row} source="queue" />)}
      </div>
    </div>
  );
}

function MobileCalendar({ ctx }) {
  if (ctx.booting) return <MobileCardsSkeleton title lines={5} />;
  return (
    <div className="page-in">
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
                <button className={`event ${event.kind === 'callback' ? 'event-callback' : ''}`} key={`${event.kind}-${event.leadId}-${event.at}`} onClick={() => openLeadById(ctx, event.leadId, 'calendar')} type="button">
                  <strong>{event.kind === 'callback' ? 'Call Now' : event.at}</strong>
                  <p>{event.machine}</p>
                  <small>{event.kind === 'callback' ? event.at : event.phone}</small>
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
  if (ctx.booting) return <MobileCardsSkeleton title />;
  return (
    <div className="page-in">
      <div style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600 }}>Scraped listings</div>
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
              <span className={`price ${isSuspiciousPrice(listing.price_text, listing.price_eur) ? 'warn' : ''}`}>{displayAskingPrice(listing.price_text, listing.price_eur)}</span>
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
    <div className="m-lead" onClick={() => ctx.openLead(row, source)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') ctx.openLead(row, source); }}>
      <div className="m-lead-top">
        <div className="m-lead-copy">
          <h3>{row.machine}</h3>
          <div className="phone-row">
            <WhatsAppMark size={13} />
            <span>{row.phone}</span>
          </div>
        </div>
        <a className="icon-btn dark m-lead-chat" href={whatsAppHref(row.phone)} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">
          <Glyph name="ChatTextWeightRegular" size={18} />
        </a>
      </div>
      <div className="m-lead-foot">
        <span className="dot" style={{ background: statusDot(row.stage) }} />
        <span className="m-lead-stage">{stageLabel(row.stage)}</span>
        <span className="grow" />
        <span className={`price ${row.priceFlag ? 'warn' : ''}`}>{row.price}</span>
        <span className="m-lead-ago">{row.ago}</span>
      </div>
    </div>
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
    price: displayAskingPrice(listing.price_text, listing.price_eur),
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
    callback: reconciled.callback,
    awaiting: reconciled.awaiting,
    thinReply: reconciled.thinReply,
    opportunity: reconciled.opportunity,
    callbackAt: conversation.last_inbound_at || last?.at || null,
    bookedAt: conversation.calendar_booking?.start || listing.raw_data?.calendar_booking?.start || null,
    activityAt: Date.parse(last?.at || conversation.last_inbound_at || conversation.updated_at || listing.updated_at) || 0,
    ago: relativeAgo(last?.at || conversation.last_inbound_at || conversation.updated_at || listing.updated_at),
    snippet: last?.message || 'No messages yet',
    fields: [
      { k: 'Model year', v: listing.model_year || '-' },
      { k: 'Hours', v: hours },
      { k: 'Asking price', v: displayAskingPrice(listing.price_text, listing.price_eur) },
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

const QUEUE_MAX_AGE_MS = 40 * 24 * 60 * 60 * 1000;

function isLiveQueueLead(lead) {
  if (!lead?.booked && !lead?.callback) return false;
  const at = Date.parse(lead.bookedAt || lead.callbackAt || 0);
  if (!Number.isFinite(at) || !at) return true;
  return Date.now() - at <= QUEUE_MAX_AGE_MS;
}

function OverviewSkeleton({ mobile = false }) {
  if (mobile) {
    return (
      <div className="page-in">
        <div className="m-kpis">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="m-card skel-card" key={index} style={{ animationDelay: `${index * 70}ms` }}>
              <div className="skel skel-line" style={{ width: 72 }} />
              <div className="skel skel-num" />
            </div>
          ))}
          <div className="m-card m-pipe skel-card" style={{ animationDelay: '280ms' }}>
            <div className="skel skel-line" style={{ width: 88 }} />
            <div className="skel skel-num" />
            <div className="skel skel-line" style={{ width: '70%', marginTop: 8 }} />
          </div>
        </div>
        <div className="skel-block" style={{ marginTop: 20 }}>
          <div className="skel skel-line" style={{ width: 140, marginBottom: 16 }} />
          {Array.from({ length: 6 }, (_, index) => (
            <div className="skel-row" key={index} style={{ animationDelay: `${180 + index * 50}ms` }}>
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
        {['90', '110', '80', '80', '70'].map((width, index) => (
          <div className="card skel-card" key={width + index} style={{ animationDelay: `${40 + index * 70}ms` }}>
            <div className="skel skel-line" style={{ width: Number(width) }} />
            <div className="skel skel-num" style={{ marginTop: 10 }} />
            <div className="skel skel-line" style={{ width: 96, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="charts">
        <div className="card flow-card skel-card" style={{ animationDelay: '280ms' }}>
          <div className="skel skel-line" style={{ width: 140 }} />
          <div className="skel skel-flow" />
        </div>
        <div className="card reply-card skel-card" style={{ animationDelay: '340ms' }}>
          <div className="skel skel-line" style={{ width: 110 }} />
          <div className="skel skel-chart" style={{ height: 140, marginTop: 18 }} />
        </div>
      </div>
      <TableSkeleton />
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="scroll page-in">
      <div className="page-title">
        <div className="skel skel-line" style={{ width: 160, height: 28 }} />
        <div className="skel skel-line" style={{ width: 220 }} />
      </div>
      <TableSkeleton />
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="scroll page-in" style={{ paddingTop: 24 }}>
      <div className="cal-head">
        <div className="skel skel-line" style={{ width: 180, height: 28 }} />
        <div className="skel skel-line" style={{ width: 90, marginLeft: 12 }} />
      </div>
      <div className="week-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, index) => (
          <div className="day-col" key={day} style={{ animationDelay: `${index * 60}ms` }}>
            <div className="day-head">
              <div className="skel skel-line" style={{ width: 28 }} />
              <div className="skel skel-line" style={{ width: 22, marginTop: 8 }} />
            </div>
            <div className="day-body">
              <div className="skel" style={{ height: index === 1 || index === 3 ? 64 : 36, borderRadius: 12 }} />
            </div>
          </div>
        ))}
      </div>
      <TableSkeleton compact />
    </div>
  );
}

function ListingsSkeleton() {
  return (
    <div className="page page-in" style={{ overflow: 'hidden' }}>
      <div className="listings-pane">
        <div className="list-head">
          <div className="skel skel-line" style={{ width: 170, height: 24 }} />
        </div>
        <TableSkeleton />
      </div>
      <aside className="detail">
        <div className="skel skel-line" style={{ width: 80 }} />
        <div className="skel skel-line" style={{ width: '70%', height: 24, marginTop: 16 }} />
        <div className="skel" style={{ height: 180, borderRadius: 16, marginTop: 16 }} />
        <div className="skel skel-line" style={{ width: '90%', marginTop: 20 }} />
        <div className="skel skel-line" style={{ width: '60%', marginTop: 10 }} />
        <div className="skel skel-line" style={{ width: '75%', marginTop: 10 }} />
      </aside>
    </div>
  );
}

function MobileCardsSkeleton({ title = false, lines = 5 }) {
  return (
    <div className="page-in">
      {title ? <div className="skel skel-line" style={{ width: 150, height: 24, marginBottom: 16 }} /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: lines }, (_, index) => (
          <div className="m-card skel-card" key={index} style={{ animationDelay: `${index * 60}ms` }}>
            <div className="skel skel-line" style={{ width: '62%' }} />
            <div className="skel skel-line" style={{ width: '38%', marginTop: 10 }} />
            <div className="skel skel-line" style={{ width: '48%', marginTop: 14 }} />
          </div>
        ))}
      </div>
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
