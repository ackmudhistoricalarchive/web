import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';

declare global {
  interface Window {
    mudClientInit?: () => void;
  }
}

type RefTab = 'help' | 'shelp' | 'lore';

function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="aha-shell">
      <header className="site-brand">
        <img src="/img/ackmud_logo_transparent.png" alt="ACKMUD logo" />
        <p>ACKmud Historical Archive - Preservation and interpretation of an enduring text-world tradition.</p>
      </header>

      <nav className="site-nav">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/acktng">ACK!TNG</NavLink>
        <NavLink to="/acktng/who">Who</NavLink>
        <NavLink to="/acktng/mud">MUD Client</NavLink>
        <NavLink to="/acktng/map">Map</NavLink>
        <NavLink to="/acktng/reference">Reference</NavLink>
        <a href="https://discord.gg/T24UQV8h" target="_blank" rel="noreferrer">Discord</a>
        <a href="https://github.com/ackmudhistoricalarchive" target="_blank" rel="noreferrer">GitHub</a>
      </nav>

      <main>{children}</main>
    </div>
  );
}

function HomePage() {
  useDocumentTitle('ACKmud Historical Archive');

  return (
    <>
      <h1>ACKmud Historical Archive</h1>
      <p>
        The ACKmud Historical Archive is a long-horizon preservation and interpretation effort for one of the enduring
        text-world traditions: the ACK code lineage and the living worlds that grew from it. This project is not just a file dump;
        it is a curated record of worldbuilding decisions, game-system evolution, social history, and technical craft spanning
        years of iterative development.
      </p>

      <div className="grid">
        <section className="card">
          <h2>Mission</h2>
          <p>
            Preserve game assets, system logic, and reference text in a format that remains readable and useful to future builders,
            maintainers, and players. The archive balances authenticity with accessibility: original content is retained while
            navigational surfaces make discovery practical.
          </p>
        </section>
        <section className="card">
          <h2>Scope</h2>
          <p>
            The collection spans areas, NPC definitions, help libraries, spell references, logs, and supporting data files that
            describe both gameplay and operational culture. Together these materials document how classes, encounters, and
            progression loops changed over time.
          </p>
        </section>
        <section className="card">
          <h2>Research Value</h2>
          <p>
            Beyond gameplay nostalgia, the archive is useful for software archaeology. It captures architecture decisions in
            long-lived C MUD codebases, balancing performance constraints, maintainability, and community-driven feature growth.
          </p>
        </section>
      </div>

      <h2>Historical Context</h2>
      <p>
        ACK-based MUDs embody a period where online worlds were built collaboratively and operated continuously, often by small teams
        with deep domain knowledge. Every command, help topic, and area file becomes part of a running chronicle: player behavior
        informs balance updates; builder style informs narrative texture; operational incidents inform infrastructure hardening.
      </p>

      <h2>ACK!TNG - Final Release</h2>
      <p>
        ACK!TNG (The Next Generation) has reached its final release and is now fully archived here. The servers remain
        accessible for play via the <NavLink to="/acktng/mud">MUD Client</NavLink> - ACK!TNG and the historical worlds are
        available.
      </p>

      <h2>What This Archive Provides</h2>
      <ul>
        <li><strong>Play:</strong> Connect to the ACK!TNG and historical servers directly from your browser via the <NavLink to="/acktng/mud">MUD Client</NavLink>.</li>
        <li><strong>Reference:</strong> Searchable indexes into game documentation, spell/skill references, and lore entries.</li>
        <li><strong>World Map:</strong> A visual overview of the game world and its geography.</li>
        <li><strong>Community / Source:</strong> Quick links to the Discord server and the canonical GitHub area-file tree.</li>
      </ul>

      <p className="muted footer-copy">
        This archive is intended to remain useful decades from now: to support restoration, scholarly study, emulator efforts,
        and renewed play.
      </p>
    </>
  );
}

function AcktngPage() {
  useDocumentTitle('ACK!TNG - ACKmud Historical Archive');

  return (
    <>
      <h1>ACK!TNG - The Next Generation</h1>
      <p>
        <strong>ACK!TNG</strong> is the final release of the TNG line - the latest chapter in a decades-long ACK! tradition.
        It is now fully archived here as part of the ACKmud Historical Archive. The servers remain live for play,
        and all reference documentation, lore, and world content is preserved below.
      </p>

      <div className="grid">
        <section className="card">
          <h2>Play</h2>
          <p>
            Connect to ACK!TNG and the historical worlds directly from your browser using the
            <NavLink to="/acktng/mud"> MUD Client</NavLink> - no downloads required.
          </p>
        </section>
        <section className="card">
          <h2>Who&apos;s Online</h2>
          <p>
            See who&apos;s currently connected on the <NavLink to="/acktng/who">Who</NavLink> page -
            a live snapshot of active players.
          </p>
        </section>
        <section className="card">
          <h2>Reference</h2>
          <p>
            Browse searchable indexes of <NavLink to="/acktng/reference/help">help topics</NavLink>,
            <NavLink to="/acktng/reference/shelp"> spell and skill references</NavLink>, and
            <NavLink to="/acktng/reference/lore"> lore entries</NavLink> from the game world.
          </p>
        </section>
        <section className="card">
          <h2>World Map</h2>
          <p>
            Explore the <NavLink to="/acktng/map">world map</NavLink> for a geographic overview of the game world
            and its regions.
          </p>
        </section>
        <section className="card">
          <h2>Source</h2>
          <p>
            The ACK!TNG codebase and area files are preserved on
            <a href="https://github.com/ackmudhistoricalarchive" target="_blank" rel="noreferrer"> GitHub</a>.
          </p>
        </section>
      </div>

      <p className="muted">
        ACK!TNG ran as a live service for years, continuously shaped by its builders and players.
        This archive treats it not only as software but as a cultural artifact - preserved in full
        for study, restoration, and renewed play.
      </p>
    </>
  );
}

function WhoPage() {
  useDocumentTitle("Who's Online - ACKmud Historical Archive");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [whoHtml, setWhoHtml] = useState('');
  const playerCount = useMemo(() => (whoHtml.match(/<li>/g) ?? []).length, [whoHtml]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/who');
        if (!response.ok) {
          throw new Error('who failed');
        }
        const body = await response.text();
        if (active) {
          setWhoHtml(body);
        }
      } catch {
        if (active) {
          setError(true);
          setWhoHtml('<h2>Players Online</h2><ul></ul>');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <h1>Who&apos;s Online</h1>
      <p className="muted">Live snapshot from in-game WHO output.</p>

      {loading ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <p>Players online: {error ? 0 : playerCount}</p>
          <div dangerouslySetInnerHTML={{ __html: whoHtml }} />
        </>
      )}
    </>
  );
}

function tabLabel(tab: RefTab) {
  return tab === 'shelp' ? 'Spell Help' : tab === 'lore' ? 'Lore' : 'Help';
}

function ReferencePage() {
  const params = useParams();
  const navigate = useNavigate();
  const activeTab = (params.tab?.toLowerCase() === 'shelp' || params.tab?.toLowerCase() === 'lore'
    ? params.tab.toLowerCase()
    : 'help') as RefTab;
  const topic = params.topic;

  useDocumentTitle('Reference - ACKmud Historical Archive');

  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const [topicContent, setTopicContent] = useState<string | null>(null);
  const [topicLoading, setTopicLoading] = useState(false);

  useEffect(() => {
    setQuery('');
    setQueryInput('');
  }, [activeTab]);

  useEffect(() => {
    let active = true;

    if (topic) {
      setTopicLoading(true);
      setTopicContent(null);
      void (async () => {
        try {
          const response = await fetch(`/api/reference/${activeTab}/${encodeURIComponent(topic)}`);
          if (response.ok && active) {
            setTopicContent(await response.text());
          }
        } finally {
          if (active) {
            setTopicLoading(false);
          }
        }
      })();

      return () => {
        active = false;
      };
    }

    setIndexLoading(true);
    void (async () => {
      try {
        const suffix = query ? `?q=${encodeURIComponent(query)}` : '';
        const response = await fetch(`/api/reference/${activeTab}${suffix}`);
        const body = await response.json() as string[];
        if (active) {
          setTopics(body);
        }
      } catch {
        if (active) {
          setTopics([]);
        }
      } finally {
        if (active) {
          setIndexLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [activeTab, topic, query]);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(`/acktng/reference/${activeTab}`);
    setQuery(queryInput.trim());
  }

  return (
    <>
      <nav className="sub-nav">
        <NavLink to="/acktng/reference/help" className={({ isActive }) => isActive ? 'active' : ''}>Help</NavLink>
        <NavLink to="/acktng/reference/shelp" className={({ isActive }) => isActive ? 'active' : ''}>Spell Help</NavLink>
        <NavLink to="/acktng/reference/lore" className={({ isActive }) => isActive ? 'active' : ''}>Lore</NavLink>
      </nav>

      {topic ? (
        topicLoading ? (
          <p className="muted">Loading...</p>
        ) : topicContent !== null ? (
          <>
            <h1>{tabLabel(activeTab)}: {topic}</h1>
            <p><NavLink to={`/acktng/reference/${activeTab}`}>Back to {tabLabel(activeTab)} index</NavLink></p>
            <pre>{topicContent}</pre>
          </>
        ) : (
          <p className="muted">Topic not found.</p>
        )
      ) : (
        <>
          <section className="help-forms">
            <form onSubmit={onSearch}>
              <label htmlFor="topic-query">{tabLabel(activeTab)}:</label>
              <input
                id="topic-query"
                value={queryInput}
                onChange={event => setQueryInput(event.target.value)}
                placeholder="topic"
              />
              <button type="submit">Search</button>
            </form>
          </section>

          <h1>{tabLabel(activeTab)} Topics</h1>

          {indexLoading ? (
            <p className="muted">Loading...</p>
          ) : topics.length === 0 ? (
            <p>{query ? `No topics match "${query}".` : 'No topics available.'}</p>
          ) : (
            <>
              {query ? <p>Filtered by <strong>{query}</strong>.</p> : null}
              <ul>
                {topics.map(item => (
                  <li key={item}>
                    <NavLink to={`/acktng/reference/${activeTab}/${item}`}>{item}</NavLink>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

function WorldMapPage() {
  useDocumentTitle('World Map - ACKmud Historical Archive');
  const [hover, setHover] = useState(false);

  return (
    <>
      <h1>World Map</h1>
      <p className="muted">A stylized rendering of the known world.</p>

      <div className="map-frame">
        <a href="/img/acktng.png" target="_blank" title="Open full-size map" rel="noreferrer">
          <img
            src="/img/acktng.png"
            alt="Stylized World Map"
            className={hover ? 'map-image hover' : 'map-image'}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          />
        </a>
      </div>
      <p className="muted map-note">Click the map to open the full-resolution image.</p>
    </>
  );
}

function MudClientPage() {
  useDocumentTitle('MUD Client - ACKmud Historical Archive');

  useEffect(() => {
    let mounted = true;
    const existing = document.querySelector<HTMLScriptElement>('script[data-mud-client="true"]');

    async function init() {
      if (existing) {
        window.mudClientInit?.();
        return;
      }

      const script = document.createElement('script');
      script.src = '/js/mud-client.js';
      script.dataset.mudClient = 'true';
      script.async = true;
      script.onload = () => {
        if (mounted) {
          window.mudClientInit?.();
        }
      };
      document.body.appendChild(script);
    }

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <h1>MUD Client</h1>
      <p className="muted">Browser-based client for ACK!TNG and related worlds.</p>

      <div id="mud-client-container">
        <div className="mud-controls">
          <label htmlFor="world-select">World</label>
          <select id="world-select" defaultValue="acktng">
            <option value="acktng" data-ws="/ws/acktng">ACK!TNG</option>
            <option value="ack431" data-ws="/ws/ack431">ACK! 4.3.1</option>
            <option value="ack42" data-ws="/ws/ack42">ACK! 4.2</option>
            <option value="ack41" data-ws="/ws/ack41">ACK! 4.1</option>
            <option value="assault" data-ws="/ws/assault">Assault 3.0</option>
            <option value="ackfuss" data-ws="/ws/ackfuss">ACK!FUSS</option>
          </select>
          <button id="connect-btn" type="button">Connect</button>
          <button id="disconnect-btn" type="button">Disconnect</button>
          <span id="mud-status" className="mud-status" />
          <button id="toggle-map-btn" type="button" style={{ display: 'none' }}>Map</button>
          <button id="toggle-room-btn" type="button" style={{ display: 'none' }}>Room</button>
          <button id="toggle-equip-btn" type="button" style={{ display: 'none' }}>Equip</button>
          <button id="toggle-inv-btn" type="button" style={{ display: 'none' }}>Inv</button>
          <button id="toggle-char-btn" type="button" style={{ display: 'none' }}>Char</button>
          <button id="fullscreen-btn" type="button" className="fullscreen-btn">Full Screen</button>
        </div>

        <div id="io-panel">
          <pre id="mud-output" className="mud-output" />
          <div className="mud-input-bar">
            <input id="mud-command" placeholder="Type a command and press Enter" autoComplete="off" spellCheck={false} />
            <button id="send-btn" type="button">Send</button>
          </div>
        </div>

        <div className="float-window" id="map-window">
          <div className="float-header" id="map-win-header">
            <span className="float-title">Map</span>
            <button className="float-close" id="map-close-btn" type="button">x</button>
          </div>
          <canvas id="map-canvas" />
          <div id="map-placeholder">Connect to a TNG world to view the map.</div>
        </div>

        <div className="float-window" id="room-window">
          <div className="float-header" id="room-win-header">
            <span className="float-title">Room</span>
            <button className="float-close" id="room-close-btn" type="button">x</button>
          </div>
          <div id="room-content" className="room-content" />
        </div>

        <div className="float-window" id="equip-window">
          <div className="float-header" id="equip-win-header">
            <span className="float-title">Equipment</span>
            <button className="float-close" id="equip-close-btn" type="button">x</button>
          </div>
          <div id="equip-content" className="equip-content" />
        </div>

        <div className="float-window" id="inv-window">
          <div className="float-header" id="inv-win-header">
            <span className="float-title">Inventory</span>
            <button className="float-close" id="inv-close-btn" type="button">x</button>
          </div>
          <div id="inv-content" className="inv-content" />
        </div>

        <div className="float-window" id="char-window">
          <div className="float-header" id="char-win-header">
            <span className="float-title">Character</span>
            <button className="float-close" id="char-close-btn" type="button">x</button>
          </div>
          <div id="char-content" className="char-content" />
        </div>

        <div id="appraise-popup" className="appraise-popup" style={{ display: 'none' }} />

        <div id="music-controls" className="mud-controls music-controls" style={{ display: 'none' }}>
          <span className="music-label">Music:</span>
          <button id="music-play-btn" type="button">Play</button>
          <button id="music-stop-btn" type="button">Stop</button>
          <label className="music-inline">
            Vol
            <input id="music-volume" type="range" min="0" max="1" step="0.05" defaultValue="0.5" />
          </label>
          <label className="music-inline checkbox">
            <input id="music-loop" type="checkbox" defaultChecked />
            Loop
          </label>
        </div>

        <audio id="mud-audio" />
        <audio id="mud-audio-next" />
      </div>
    </>
  );
}

function NotFoundPage() {
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/acktng" element={<AcktngPage />} />
          <Route path="/acktng/who" element={<WhoPage />} />
          <Route path="/acktng/reference" element={<ReferencePage />} />
          <Route path="/acktng/reference/:tab" element={<ReferencePage />} />
          <Route path="/acktng/reference/:tab/:topic" element={<ReferencePage />} />
          <Route path="/acktng/map" element={<WorldMapPage />} />
          <Route path="/acktng/mud" element={<MudClientPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
