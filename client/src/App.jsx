import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiGet, apiSend } from './lib/api.js';
import './styles.css';

const DASHBOARD_MODE = import.meta.env.VITE_DASHBOARD_MODE || 'admin';
const isFinnishMode = DASHBOARD_MODE === 'client_fi';
const canUseControls = !isFinnishMode;

const STRINGS = {
  en: {
    title: 'NordKone Lead Desk',
    subtitle: 'Follow seller conversations, interested leads, and booked callback work from one calm workspace.',
    loadingTitle: 'Loading dashboard',
    loadingSubtitle: 'Fetching leads, chats, and calendar state.',
    refresh: 'Refresh desk',
    refreshing: 'Refreshing...',
    rowsLoaded: 'rows loaded',
    tabs: {
      listings: 'Listings',
      leads: 'Chats',
      calendar: 'Calendar',
    },
    cards: {
      ready: ['Ready to contact', 'Eligible seller phones waiting in queue'],
      contacted: ['Contacted', 'WhatsApp sessions opened'],
      replies: ['Replies', 'Inbound seller responses'],
      machineAvailable: ['Machine Available', 'Seller confirmed the machine is still for sale'],
      interested: ['Interested', 'Hand-off candidates'],
      readyForCall: ['Ready for call', 'Seller gave call permission or timing'],
      booked: ['Booked', 'Real calendar-backed calls'],
      needsReview: ['Needs review', 'Ambiguous or risky messages'],
      optOut: ['Opt out', 'Do-not-contact requests'],
    },
    controls: {
      eyebrow: 'WF-1 Control',
      active: 'Outbound active',
      paused: 'Outbound paused',
      helper: 'WF-1 only receives candidates when this is active and the daily cap still has room.',
      activate: 'Activate WF-1',
      pause: 'Pause WF-1',
      dailyCap: 'Daily cap',
      saveCap: 'Save cap',
      scraperEyebrow: 'Scraper',
      scraperTitle: 'Find new leads',
      scraperHelper: 'Scans Nettikone until it finds fresh eligible sellers or hits the safety caps.',
      scraperButton: 'Find new leads',
      scraperBusy: 'Searching...',
    },
    listings: {
      eyebrow: 'Listing queue',
      title: 'Scraped machinery listings',
      status: 'Status',
      search: 'Search listings',
      placeholder: 'Machine, phone, seller, Nettikone ID',
      visible: 'visible',
      machine: 'Machine',
      price: 'Price',
      phone: 'Phone',
      source: 'Source',
      noRows: 'No listings found.',
      open: 'Open',
      outboundPreview: 'Outbound preview',
      notes: 'Listing notes',
    },
    leads: {
      eyebrow: 'Lead inbox',
      title: 'Seller conversations',
      sessions: 'sessions',
      sellerMachine: 'Seller / Machine',
      status: 'Status',
      lastMessage: 'Last message',
      chat: 'Chat',
      viewChat: 'View chat',
      noRows: 'No conversations yet.',
      select: 'Select a lead to view chat.',
      session: 'Chat session',
      listing: 'Listing',
      noMessages: 'No stored messages for this session.',
    },
    calendar: {
      eyebrow: 'Call calendar',
      title: 'Booked calls',
      helper: 'Real calendar events for Roope and the NordKone team.',
      calls: 'calls',
      empty: 'No booked calls in the calendar yet.',
      pendingTitle: 'Waiting for call booking',
      pendingHelper: 'Interested leads that need a call but are not calendar events.',
      assigned: 'Assigned',
      requested: 'Requested',
      latest: 'Latest message',
      openChat: 'Open chat',
    },
  },
  fi: {
    title: 'NordKone liidipöytä',
    subtitle: 'Seuraa myyjien keskusteluja, kiinnostuneita liidejä ja sovittuja soittoja selkeästä näkymästä.',
    loadingTitle: 'Ladataan näkymää',
    loadingSubtitle: 'Haetaan liidit, keskustelut ja kalenteritiedot.',
    refresh: 'Päivitä näkymä',
    refreshing: 'Päivitetään...',
    rowsLoaded: 'riviä ladattu',
    tabs: {
      listings: 'Liidit',
      leads: 'Keskustelut',
      calendar: 'Kalenteri',
    },
    cards: {
      ready: ['Valmiit liidit', 'Kontaktoimattomat myyjät jonossa'],
      contacted: ['Kontaktoitu', 'Avatut WhatsApp-keskustelut'],
      replies: ['Vastaukset', 'Myyjien saapuneet viestit'],
      machineAvailable: ['Kone saatavilla', 'Myyjä vahvisti että kone on vielä myynnissä'],
      interested: ['Kiinnostuneet', 'Liidit jatkoon'],
      readyForCall: ['Valmis soittoon', 'Myyjä antoi soittoajan tai luvan soittaa'],
      booked: ['Varattu', 'Oikeat kalenterivaraukset'],
      needsReview: ['Tarkistettava', 'Epäselvät tai tärkeät viestit'],
      optOut: ['Ei yhteyttä', 'Älä kontaktoi -pyynnöt'],
    },
    controls: {},
    listings: {
      eyebrow: 'Liidijono',
      title: 'Nettikone-ilmoitukset',
      status: 'Tila',
      search: 'Hae liidejä',
      placeholder: 'Kone, puhelin, myyjä, Nettikone ID',
      visible: 'näkyvissä',
      machine: 'Kone',
      price: 'Hinta',
      phone: 'Puhelin',
      source: 'Lähde',
      noRows: 'Liidejä ei löytynyt.',
      open: 'Avaa',
      outboundPreview: 'Ensiviestin esikatselu',
      notes: 'Ilmoituksen tiedot',
    },
    leads: {
      eyebrow: 'Keskustelut',
      title: 'Myyjien keskustelut',
      sessions: 'keskustelua',
      sellerMachine: 'Myyjä / kone',
      status: 'Tila',
      lastMessage: 'Viimeisin viesti',
      chat: 'Keskustelu',
      viewChat: 'Näytä',
      noRows: 'Keskusteluja ei vielä ole.',
      select: 'Valitse keskustelu.',
      session: 'Keskustelu',
      listing: 'Ilmoitus',
      noMessages: 'Keskustelulle ei ole tallennettu viestejä.',
    },
    calendar: {
      eyebrow: 'Soittokalenteri',
      title: 'Varatut soitot',
      helper: 'Roopea ja NordKone-tiimiä varten luodut kalenteritapahtumat.',
      calls: 'soittoa',
      empty: 'Kalenterissa ei ole vielä varattuja soittoja.',
      pendingTitle: 'Odottaa soiton varausta',
      pendingHelper: 'Kiinnostuneet liidit, joille tarvitaan soitto mutta ei kalenteritapahtumaa.',
      assigned: 'Vastuuhenkilö',
      requested: 'Pyydetty',
      latest: 'Viimeisin viesti',
      openChat: 'Avaa keskustelu',
    },
  },
};

const STATUS_OPTIONS = [
  ['all', 'All', 'Kaikki'],
  ['eligible', 'Eligible', 'Valmis'],
  ['contacted', 'Contacted', 'Kontaktoitu'],
  ['replied', 'Replied', 'Vastannut'],
  ['interested', 'Interested', 'Kiinnostunut'],
  ['sold', 'Sold', 'Myyty'],
  ['not_interested', 'Not interested', 'Ei kiinnostunut'],
  ['opted_out', 'Opted out', 'Estetty'],
  ['needs_human', 'Needs human', 'Vaatii ihmisen'],
];

function App() {
  const t = isFinnishMode ? STRINGS.fi : STRINGS.en;
  const [summary, setSummary] = useState(null);
  const [listings, setListings] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [calendarCalls, setCalendarCalls] = useState([]);
  const [pendingCallbacks, setPendingCallbacks] = useState([]);
  const [activeTab, setActiveTab] = useState('calendar');
  const [conversationFilter, setConversationFilter] = useState('interested');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dailyCapDraft, setDailyCapDraft] = useState('20');
  const [scrapeResult, setScrapeResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [scraping, setScraping] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status, limit: '100' });
      if (q.trim()) params.set('q', q.trim());

      const [summaryData, listingData, settingsData, conversationData, callsData] = await Promise.all([
        apiGet('/api/summary'),
        apiGet(`/api/listings?${params.toString()}`),
        apiGet('/api/settings'),
        apiGet('/api/conversations?limit=75'),
        apiGet('/api/calendar-calls?limit=75'),
      ]);

      setSummary(summaryData);
      setListings(listingData.listings || []);
      setSelected((current) => current || listingData.listings?.[0] || null);
      setSettings(settingsData.settings || null);
      setDailyCapDraft(String(settingsData.settings?.daily_cap ?? 20));
      setConversations(conversationData.conversations || []);
      setCalendarCalls(
        callsData.booked_calls ||
          (callsData.calls || []).filter((call) => call.scheduled_start || call.calendar_event_id)
      );
      setPendingCallbacks(
        callsData.pending_callbacks ||
          (callsData.calls || []).filter((call) => !call.scheduled_start && !call.calendar_event_id)
      );
      setSelectedConversationId((current) => {
        const rows = conversationData.conversations || [];
        if (current && rows.some((conversation) => conversation.session_id === current)) return current;
        return rows[0]?.session_id || null;
      });
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  const cards = useMemo(
    () => {
      const derived = summary?.derived_status_counts || {};
      return [
        {
          label: t.cards.ready[0],
          value: derived.ready_to_contact ?? summary?.eligible_prospects ?? summary?.eligible ?? 0,
          hint: t.cards.ready[1],
          tone: 'primary',
        },
        {
          label: t.cards.contacted[0],
          value: summary?.contacted || summary?.contacted_listings || 0,
          hint: t.cards.contacted[1],
          tone: 'neutral',
        },
        {
          label: t.cards.replies[0],
          value: summary?.replied || 0,
          hint: t.cards.replies[1],
          tone: 'neutral',
        },
        {
          label: t.cards.machineAvailable[0],
          value: derived.machine_available || 0,
          hint: t.cards.machineAvailable[1],
          tone: 'source',
        },
        {
          label: t.cards.interested[0],
          value: derived.interested || 0,
          hint: t.cards.interested[1],
          tone: 'success',
        },
        {
          label: t.cards.readyForCall[0],
          value: derived.ready_for_call || 0,
          hint: t.cards.readyForCall[1],
          tone: 'warning',
        },
        {
          label: t.cards.booked[0],
          value: derived.booked || calendarCalls.length || 0,
          hint: t.cards.booked[1],
          tone: 'success',
        },
        {
          label: t.cards.needsReview[0],
          value: derived.needs_review || 0,
          hint: t.cards.needsReview[1],
          tone: 'warning',
        },
        {
          label: t.cards.optOut[0],
          value: derived.opt_out ?? summary?.opt_outs ?? 0,
          hint: t.cards.optOut[1],
          tone: 'neutral',
        },
      ];
    },
    [summary, calendarCalls.length, t]
  );

  const filteredConversations = useMemo(() => {
    if (conversationFilter === 'all') return conversations;
    return conversations.filter((conversation) => {
      const statusValue = conversation.derived_status || conversation.interest_status || conversation.status;
      if (conversationFilter === 'interested') return statusValue === 'interested';
      if (conversationFilter === 'replied') return Boolean(conversation.last_inbound_at);
      if (conversationFilter === 'contacted') return statusValue === 'contacted';
      if (conversationFilter === 'machine_available') return statusValue === 'machine_available';
      if (conversationFilter === 'ready_for_call') return statusValue === 'ready_for_call';
      if (conversationFilter === 'needs_review') return statusValue === 'needs_review';
      if (conversationFilter === 'opt_out') return statusValue === 'opt_out';
      if (conversationFilter === 'booked') {
        return calendarCalls.some(
          (call) => call.source_customer_id === conversation.listing?.nettikone_id || call.number === conversation.number
        );
      }
      return true;
    });
  }, [calendarCalls, conversationFilter, conversations]);

  const selectedConversation = useMemo(
    () =>
      filteredConversations.find((conversation) => conversation.session_id === selectedConversationId) ||
      filteredConversations[0] ||
      null,
    [filteredConversations, selectedConversationId]
  );

  const selectedMessage = selected
    ? `Moikka! Sulla oli Nettikoneessa ${selected.machine_title} myynnissä. Onko se edelleen kaupan?`
    : '';
  const initialLoading = loading && !summary && !listings.length && !conversations.length;

  async function updateOutboundSettings(nextSettings) {
    if (!canUseControls) return;
    setSavingSettings(true);
    setError('');
    try {
      await apiSend('/api/settings', {
        method: 'PUT',
        body: {
          settings: nextSettings,
        },
      });
      await load();
    } catch (settingsError) {
      setError(settingsError.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveDailyCap() {
    await updateOutboundSettings({
      daily_cap: Math.max(Number(dailyCapDraft) || 0, 0),
    });
  }

  async function runManualScrape() {
    if (!canUseControls) return;
    setScraping(true);
    setScrapeResult(null);
    setError('');
    try {
      const result = await apiSend('/api/scrape/run?targetNew=10&maxPages=20&maxListings=30', { method: 'POST' });
      setScrapeResult(result);
      await load();
    } catch (scrapeError) {
      setError(scrapeError.message);
    } finally {
      setScraping(false);
    }
  }

  function openConversationForCall(call) {
    const match = conversations.find(
      (conversation) =>
        conversation.listing?.nettikone_id === call.source_customer_id ||
        conversation.number === call.number ||
        conversation.number === call.callback_number
    );

    if (match) {
      setSelectedConversationId(match.session_id);
      setActiveTab('leads');
    }
  }

  return (
    <main className={`shell ${isFinnishMode ? 'client-mode' : 'admin-mode'}`}>
      <header className="hero">
        <div className="hero-copy">
          <div className="brand-row">
            <span className="brand-mark">NK</span>
          </div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {initialLoading ? (
        <DashboardLoading t={t} />
      ) : (
        <>
          {loading ? <div className="loading-strip">{t.loadingSubtitle}</div> : null}

          <section className="cards">
            {cards.map(({ label, value, hint, tone }) => (
              <article className={`card ${tone}`} key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{hint}</small>
              </article>
            ))}
          </section>

          {canUseControls ? (
            <AdminControls
              dailyCapDraft={dailyCapDraft}
              runManualScrape={runManualScrape}
              saveDailyCap={saveDailyCap}
              savingSettings={savingSettings}
              scrapeResult={scrapeResult}
              scraping={scraping}
              setDailyCapDraft={setDailyCapDraft}
              settings={settings}
              t={t}
              updateOutboundSettings={updateOutboundSettings}
            />
          ) : null}

          <section className="tabs">
            <button className={activeTab === 'calendar' ? 'active' : ''} onClick={() => setActiveTab('calendar')}>
              {t.tabs.calendar}
            </button>
            <button className={activeTab === 'leads' ? 'active' : ''} onClick={() => setActiveTab('leads')}>
              {t.tabs.leads}
            </button>
            <button className={activeTab === 'listings' ? 'active' : ''} onClick={() => setActiveTab('listings')}>
              {t.tabs.listings}
            </button>
          </section>

          {activeTab === 'listings' ? (
            <ListingsView
              isFinnishMode={isFinnishMode}
              listings={listings}
              load={load}
              loading={loading}
              q={q}
              selected={selected}
              selectedMessage={selectedMessage}
              setQ={setQ}
              setSelected={setSelected}
              setStatus={setStatus}
              status={status}
              t={t}
            />
          ) : null}

          {activeTab === 'leads' ? (
            <ConversationsView
              conversationFilter={conversationFilter}
              conversations={filteredConversations}
              isFinnishMode={isFinnishMode}
              loading={loading}
              rawCount={conversations.length}
              selectedConversation={selectedConversation}
              selectedConversationId={selectedConversationId}
              setConversationFilter={setConversationFilter}
              setSelectedConversationId={setSelectedConversationId}
              t={t}
            />
          ) : null}

          {activeTab === 'calendar' ? (
            <CalendarView
              calls={calendarCalls}
              isFinnishMode={isFinnishMode}
              onOpenChat={openConversationForCall}
              pendingCallbacks={pendingCallbacks}
              t={t}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

function DashboardLoading({ t }) {
  return (
    <section className="loading-state" aria-live="polite">
      <div className="panel loading-panel">
        <div>
          <p className="eyebrow">{t.loadingTitle}</p>
          <h2>{t.loadingSubtitle}</h2>
        </div>
        <div className="loader-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="cards loading-cards">
        {Array.from({ length: 6 }).map((_, index) => (
          <article className="card skeleton-card" key={index}>
            <span className="skeleton-line short" />
            <strong className="skeleton-line number" />
            <small className="skeleton-line" />
          </article>
        ))}
      </div>

      <section className="grid leads-grid">
        <div className="panel skeleton-panel" />
        <aside className="panel detail skeleton-detail" />
      </section>
    </section>
  );
}

function AdminControls({
  dailyCapDraft,
  runManualScrape,
  saveDailyCap,
  savingSettings,
  scrapeResult,
  scraping,
  setDailyCapDraft,
  settings,
  t,
  updateOutboundSettings,
}) {
  return (
    <section className="ops-grid">
      <article className={`panel control-panel ${settings?.outbound_enabled ? 'enabled' : ''}`}>
        <div>
          <p className="eyebrow">{t.controls.eyebrow}</p>
          <h2>{settings?.outbound_enabled ? t.controls.active : t.controls.paused}</h2>
          <p>{t.controls.helper}</p>
        </div>
        <div className="control-actions">
          <button
            className={settings?.outbound_enabled ? 'danger' : 'success'}
            disabled={savingSettings || !settings}
            onClick={() => updateOutboundSettings({ outbound_enabled: !settings?.outbound_enabled })}
          >
            {settings?.outbound_enabled ? t.controls.pause : t.controls.activate}
          </button>
          <label>
            <span>{t.controls.dailyCap}</span>
            <input
              min="0"
              type="number"
              value={dailyCapDraft}
              onChange={(event) => setDailyCapDraft(event.target.value)}
            />
          </label>
          <button disabled={savingSettings || !settings} onClick={saveDailyCap}>
            {t.controls.saveCap}
          </button>
        </div>
      </article>

      <article className="panel control-panel">
        <div>
          <p className="eyebrow">{t.controls.scraperEyebrow}</p>
          <h2>{t.controls.scraperTitle}</h2>
          <p>{t.controls.scraperHelper}</p>
          {scrapeResult ? <code className="scrape-result">{JSON.stringify(scrapeResult.stats || scrapeResult)}</code> : null}
        </div>
        <div className="control-actions compact">
          <button disabled={scraping} onClick={runManualScrape}>
            {scraping ? t.controls.scraperBusy : t.controls.scraperButton}
          </button>
        </div>
      </article>
    </section>
  );
}

function ListingsView({
  isFinnishMode,
  listings,
  load,
  loading,
  q,
  selected,
  selectedMessage,
  setQ,
  setSelected,
  setStatus,
  status,
  t,
}) {
  return (
    <>
      <section className="toolbar">
        <label>
          <span>{t.listings.status}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map(([value, enLabel, fiLabel]) => (
              <option key={value} value={value}>
                {isFinnishMode ? fiLabel : enLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>{t.listings.search}</span>
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && load()}
            placeholder={t.listings.placeholder}
          />
        </label>
        <button onClick={load}>{isFinnishMode ? 'Hae' : 'Search'}</button>
      </section>

      <section className="grid">
        <div className="panel table-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t.listings.eyebrow}</p>
              <h2>{t.listings.title}</h2>
            </div>
            <span>
              {listings.length} {t.listings.visible}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t.listings.machine}</th>
                <th>{t.listings.price}</th>
                <th>{t.listings.phone}</th>
                <th>{t.listings.source}</th>
                <th>{t.listings.status}</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.id} className={selected?.id === listing.id ? 'selected' : ''} onClick={() => setSelected(listing)}>
                  <td>
                    <strong>{listing.machine_title}</strong>
                    <small>
                      {listing.nettikone_id} · {listing.location || (isFinnishMode ? 'Ei sijaintia' : 'No location')}
                    </small>
                  </td>
                  <td>
                    <strong className="price">{listing.price_text || '-'}</strong>
                    <small>{listing.model_year || (isFinnishMode ? 'Vuosi puuttuu' : 'Year unknown')}</small>
                  </td>
                  <td>
                    <span>{listing.normalized_phone || '-'}</span>
                    <small>Seller {listing.prospect_id || '-'}</small>
                  </td>
                  <td>
                    <span className={`source-badge ${listing.phone_source || 'missing'}`}>
                      {phoneSourceLabel(listing.phone_source, isFinnishMode)}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${listing.status}`}>{statusLabel(listing.status, isFinnishMode)}</span>
                  </td>
                </tr>
              ))}
              {!listings.length && !loading ? (
                <tr>
                  <td colSpan="5" className="empty">
                    {t.listings.noRows}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <ListingDetail selected={selected} selectedMessage={selectedMessage} t={t} isFinnishMode={isFinnishMode} />
      </section>
    </>
  );
}

function ListingDetail({ isFinnishMode, selected, selectedMessage, t }) {
  return (
    <aside className="panel detail">
      {selected ? (
        <>
          <div className="detail-header">
            <div>
              <p className="eyebrow">Listing {selected.nettikone_id}</p>
              <h2>{selected.machine_title}</h2>
              <div className="detail-tags">
                <span>{selected.price_text || (isFinnishMode ? 'Ei hintaa' : 'No price')}</span>
                <span>{selected.location || (isFinnishMode ? 'Ei sijaintia' : 'No location')}</span>
                <span>{phoneSourceLabel(selected.phone_source, isFinnishMode)}</span>
              </div>
            </div>
            <a className="open-link" href={selected.listing_url} target="_blank" rel="noreferrer">
              {t.listings.open}
            </a>
          </div>
          <div className="lead-packet">
            <dl>
              <dt>{t.listings.phone}</dt>
              <dd>{selected.normalized_phone || (isFinnishMode ? 'Puuttuu' : 'Missing')}</dd>
              <dt>Seller prospect</dt>
              <dd>{selected.prospect_id || '-'}</dd>
              <dt>{isFinnishMode ? 'Vuosimalli' : 'Model year'}</dt>
              <dd>{selected.model_year || '-'}</dd>
              <dt>{isFinnishMode ? 'Rekisteri' : 'Registration'}</dt>
              <dd>{selected.registration_number || '-'}</dd>
            </dl>
          </div>
          <div className="message-card">
            <p className="eyebrow">{t.listings.outboundPreview}</p>
            <div className="message">{selectedMessage}</div>
          </div>
          <div className="description-card">
            <p className="eyebrow">{t.listings.notes}</p>
            <p className="description">{selected.description || (isFinnishMode ? 'Ei kuvausta tallessa.' : 'No description stored.')}</p>
          </div>
        </>
      ) : (
        <p className="empty">{isFinnishMode ? 'Valitse liidi.' : 'Select a listing.'}</p>
      )}
    </aside>
  );
}

function ConversationsView({
  conversationFilter,
  conversations,
  isFinnishMode,
  loading,
  rawCount,
  selectedConversation,
  selectedConversationId,
  setConversationFilter,
  setSelectedConversationId,
  t,
}) {
  return (
    <section className="grid leads-grid">
      <div className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t.leads.eyebrow}</p>
            <h2>{t.leads.title}</h2>
          </div>
          <span>
            {conversations.length} / {rawCount} {t.leads.sessions}
          </span>
        </div>
        <div className="chat-filter">
          {[
            ['interested', isFinnishMode ? 'Kiinnostuneet' : 'Interested'],
            ['all', isFinnishMode ? 'Kaikki' : 'All'],
            ['machine_available', isFinnishMode ? 'Kone saatavilla' : 'Machine Available'],
            ['ready_for_call', isFinnishMode ? 'Valmis soittoon' : 'Ready for call'],
            ['replied', isFinnishMode ? 'Vastanneet' : 'Replied'],
            ['booked', isFinnishMode ? 'Varatut soitot' : 'Booked calls'],
            ['needs_review', isFinnishMode ? 'Tarkistettava' : 'Needs review'],
            ['opt_out', isFinnishMode ? 'Ei yhteyttä' : 'Opt out'],
            ['contacted', isFinnishMode ? 'Kontaktoidut' : 'Contacted'],
          ].map(([value, label]) => (
            <button
              className={conversationFilter === value ? 'active' : ''}
              key={value}
              onClick={() => setConversationFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>{t.leads.sellerMachine}</th>
              <th>{t.leads.status}</th>
              <th>{t.leads.lastMessage}</th>
              <th>{t.leads.chat}</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((conversation) => (
              <tr
                key={conversation.session_id}
                className={selectedConversation?.session_id === conversation.session_id ? 'selected' : ''}
                onClick={() => setSelectedConversationId(conversation.session_id)}
              >
                <td>
                  <strong>{conversation.listing?.machine_title || conversation.number}</strong>
                  <small>
                    {conversation.number} · {conversation.listing?.nettikone_id || (isFinnishMode ? 'Ei ilmoitusta' : 'No listing')}
                  </small>
                </td>
                <td>
                  <span className={`pill ${conversation.derived_status || conversation.interest_status || conversation.status}`}>
                    {statusLabel(conversation.derived_status || conversation.interest_status || conversation.status, isFinnishMode)}
                  </span>
                </td>
                <td>
                  <span>{conversation.latest_message?.message || (isFinnishMode ? 'Ei viestejä' : 'No messages yet')}</span>
                  <small>{formatTime(conversation.latest_message?.at || conversation.updated_at)}</small>
                </td>
                <td>
                  <button className="small-action" type="button">
                    {t.leads.viewChat}
                  </button>
                </td>
              </tr>
            ))}
            {!conversations.length && !loading ? (
              <tr>
                <td colSpan="4" className="empty">
                  {t.leads.noRows}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <aside className="panel detail lead-detail">
        {selectedConversation ? (
          <>
            <div className="detail-header">
              <div>
                <p className="eyebrow">
                  {t.leads.session} {selectedConversation.session_id}
                </p>
                <h2>{selectedConversation.listing?.machine_title || selectedConversation.number}</h2>
                <div className="detail-tags">
                  <span>{selectedConversation.number}</span>
                  <span>
                    {statusLabel(
                      selectedConversation.derived_status || selectedConversation.interest_status || selectedConversation.status,
                      isFinnishMode
                    )}
                  </span>
                </div>
              </div>
              {selectedConversation.listing?.listing_url ? (
                <a className="open-link" href={selectedConversation.listing.listing_url} target="_blank" rel="noreferrer">
                  {t.leads.listing}
                </a>
              ) : null}
            </div>
            <div className="messages drawer-messages">
              {selectedConversation.messages.map((message) => (
                <article className={`bubble ${message.direction}`} key={message.id}>
                  <div className="bubble-meta">
                    <span>{message.sender}</span>
                    <time>{formatTime(message.at)}</time>
                  </div>
                  <p>{message.message}</p>
                  {message.classification ? <small>{statusLabel(message.classification, isFinnishMode)}</small> : null}
                </article>
              ))}
              {!selectedConversation.messages.length ? <p className="empty">{t.leads.noMessages}</p> : null}
            </div>
          </>
        ) : (
          <p className="empty">{t.leads.select}</p>
        )}
      </aside>
    </section>
  );
}

function CalendarView({ calls, isFinnishMode, onOpenChat, pendingCallbacks, t }) {
  const slots = buildCalendarSlots();

  return (
    <section className="calendar-shell">
      <div className="panel calendar-intro">
        <div>
          <p className="eyebrow">{t.calendar.eyebrow}</p>
          <h2>{t.calendar.title}</h2>
          <p>{t.calendar.helper}</p>
        </div>
        <span>
          {calls.length} {t.calendar.calls}
        </span>
      </div>

      <div className="calendar-layout">
        <div className="panel calendar-board">
          {slots.map((slot) => {
            const slotCalls = calls.filter((call) => sameHour(call.scheduled_start, slot.hour));
            return (
              <div className="calendar-row" key={slot.label}>
                <time>{slot.label}</time>
                <div className="calendar-slot">
                  {slotCalls.map((call) => (
                    <article className="calendar-event" key={call.id}>
                      <span>{formatCallTime(call.scheduled_start, isFinnishMode)}</span>
                      <strong>{call.listing?.machine_title || call.source_customer_id || call.number}</strong>
                      <small>{call.callback_number || call.number || '-'}</small>
                      <button type="button" onClick={() => onOpenChat(call)}>
                        {t.calendar.openChat}
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
          {!calls.length ? <p className="empty">{t.calendar.empty}</p> : null}
        </div>

        <aside className="panel pending-calls">
          <div className="panel-heading compact-heading">
            <div>
              <p className="eyebrow">{t.calendar.pendingTitle}</p>
              <h2>{pendingCallbacks.length}</h2>
            </div>
            <span>{t.calendar.pendingHelper}</span>
          </div>
          <div className="pending-list">
            {pendingCallbacks.slice(0, 8).map((call) => (
              <article className="pending-call" key={call.id}>
                <div>
                  <strong>{call.listing?.machine_title || call.source_customer_id || call.number}</strong>
                  <small>{call.callback_number || call.number || '-'}</small>
                </div>
                <p>{call.latest_message}</p>
                <button type="button" onClick={() => onOpenChat(call)}>
                  {t.calendar.openChat}
                </button>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function phoneSourceLabel(value, isFinnish = false) {
  if (value === 'description') return 'Lisätiedot';
  if (value === 'revealed_contact') return 'Näytä numero';
  return isFinnish ? 'Puuttuu' : 'Missing';
}

function statusLabel(value, isFinnish = false) {
  const labels = {
    eligible: ['Eligible', 'Valmis'],
    contacted: ['Contacted', 'Kontaktoitu'],
    replied: ['Replied', 'Vastannut'],
    interested: ['Interested', 'Kiinnostunut'],
    sold: ['Sold', 'Myyty'],
    not_interested: ['Not interested', 'Ei kiinnostunut'],
    opted_out: ['Opted out', 'Estetty'],
    needs_human: ['Needs human', 'Vaatii ihmisen'],
    machine_available: ['Machine Available', 'Kone saatavilla'],
    ready_for_call: ['Ready for call', 'Valmis soittoon'],
    booked: ['Booked', 'Varattu'],
    needs_review: ['Needs review', 'Tarkistettava'],
    opt_out: ['Opt out', 'Ei yhteyttä'],
    pending: ['Pending', 'Odottaa'],
  };
  const fallback = String(value || 'eligible').replace(/_/g, ' ');
  return labels[value]?.[isFinnish ? 1 : 0] || fallback;
}

function callStatusLabel(value, isFinnish = false) {
  const labels = {
    booked: ['Booked', 'Soitto varattu'],
    pending_call: ['Waiting call', 'Odottaa soittoa'],
    pending: ['Waiting call', 'Odottaa soittoa'],
  };
  return labels[value]?.[isFinnish ? 1 : 0] || (isFinnish ? 'Odottaa soittoa' : 'Waiting call');
}

function buildCalendarSlots() {
  return Array.from({ length: 11 }, (_, index) => {
    const hour = index + 8;
    return {
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
    };
  });
}

function sameHour(value, hour) {
  if (!value) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Europe/Helsinki',
  }).formatToParts(new Date(value));
  return Number(parts.find((part) => part.type === 'hour')?.value) === hour;
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Helsinki',
  }).format(new Date(value));
}

function formatCallTime(value, isFinnish = false) {
  if (!value) return isFinnish ? 'Ei aikaa' : 'No time';
  return new Intl.DateTimeFormat(isFinnish ? 'fi-FI' : 'en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'Europe/Helsinki',
  }).format(new Date(value));
}

createRoot(document.getElementById('root')).render(<App />);
