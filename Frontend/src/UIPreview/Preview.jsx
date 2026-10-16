import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Input } from 'react-daisyui';
import { HashRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import StatusIcon from '../StatusPage/StatusIcon';
import ChestInventory from '../StatusPage/ChestInventory';
import ChestProgress from '../StatusPage/ChestProgress';
import PunishmentCounters from '../StatusPage/PunishmentCounters';
import ChampionRotation from '../StatusPage/ChampionRotation';
import placeholder from '../Champion_Placeholder.png';
import bronzeLogo from '../bronzeIcon150.png';
import { createPreviewGame } from './mockGame';
import '../index.css';
import '../StatusPage/status.css';
import './preview.css';

const themes = [
  { id: 'bronze', number: '01', name: 'Dark bronze', mood: 'Warm & grounded', description: 'Smoky charcoal, warm copper, soft ivory. A little grit, a lot more polish.', colors: ['#151310', '#28221c', '#dda568', '#f4ece0'] },
  { id: 'light', number: '02', name: 'Clean light', mood: 'Crisp & understated', description: 'Warm whites, quiet borders, toasted bronze. Clear and easy to read.', colors: ['#f3f2ee', '#ffffff', '#89572b', '#292720'] },
  { id: 'league', number: '03', name: 'League-inspired', mood: 'Rich & atmospheric', description: 'Midnight blue, antique gold, cool teal. A familiar fantasy-game feel.', colors: ['#071521', '#122c3d', '#d7bd7e', '#5dc9cc'] },
];
const sizes = [
  { label: 'Small phone', width: 320, height: 480 },
  { label: 'Phone', width: 360, height: 640 },
  { label: 'Large phone', width: 390, height: 844 },
  { label: 'Wide', width: 480, height: 800 },
];
const screens = [
  { id: 'home', name: 'Home', path: '/', hint: 'Try Join or Host to walk through the new entry flow.' },
  { id: 'join', name: 'Join', path: '/join', hint: 'A dedicated join page. Use the sample code and name to enter the game preview.' },
  { id: 'host', name: 'Host', path: '/host', hint: 'Game settings, invitations, and companion information live on the host page.' },
  { id: 'game', name: 'Game screen', path: '/status', hint: 'Softer surfaces, quieter borders. Try the counters and chests.' },
];
const params = new URLSearchParams(window.location.search);
const embedded = params.get('embed') === '1';
const requestedTheme = params.get('theme');
const startingTheme = themes.some(theme => theme.id === requestedTheme) ? requestedTheme : 'bronze';
const startingScreen = screens.some(screen => screen.id === params.get('screen')) ? params.get('screen') : 'home';
const previewGame = createPreviewGame();
api.defaults.adapter = previewGame.adapter;

function BronzeLogo({ compact = false, decorative = false, className = '' }) {
  return <span className={`preview-logo ${compact ? 'preview-logo-emblem' : 'preview-logo-full'} ${className}`}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'BronzeBrawl logo'} aria-hidden={decorative || undefined}>
    <img src={bronzeLogo} alt="" />
    {!compact && <img className="preview-logo-wordmark" src={bronzeLogo} alt="" />}
  </span>;
}

function GamePreview() {
  const [status, setStatus] = useState(previewGame.snapshot);
  const refresh = async () => setStatus(previewGame.snapshot());
  return <div className="game-status">
    <header className="status-header">
      <h1><BronzeLogo compact decorative />BronzeBrawl</h1>
      <p role="status" className="status-live">Live</p>
    </header>
    <div className="status-match">
      <div className="status-panel status-player">
        <img src="https://ddragon.leagueoflegends.com/cdn/13.24.1/img/champion/Yasuo.png"
          onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = placeholder; }} alt="Yasuo" />
        <div>
          <p>{status.player.playerName}</p><strong>Yasuo</strong>
          <p className="status-kda" aria-label="8 kills, 5 deaths, 12 assists">8/5/12</p>
          <p className="status-own-shield"><StatusIcon name="shield" />{status.player.shield}</p>
        </div>
      </div>
      <ChampionRotation rotationRemainingSeconds={138} rotationAvailable={false} ended={false} />
    </div>
    <PunishmentCounters punishments={status.punishments} onRefresh={refresh} />
    <ChestInventory rewards={status.rewards} recipients={status.recipients} onRefresh={refresh} />
    <ChestProgress progress={status.chestProgress} />
  </div>;
}

function HomePreview() {
  return <section className="preview-home">
    <h1 className="sr-only">BronzeBrawl</h1>
    <BronzeLogo />
    <nav className="preview-home-actions" aria-label="Get started">
      <Link className="btn btn-primary preview-entry-action" to="/join">Join</Link>
      <Link className="btn preview-entry-action preview-entry-secondary" to="/host">Host</Link>
    </nav>
  </section>;
}

function EntryPage({ children, host = false }) {
  return <div className={`preview-entry-shell${host ? ' preview-entry-shell-host' : ''}`}>
    <header className="preview-entry-header">
      <Link className="preview-back" to="/">← Back</Link>
      <BronzeLogo compact />
    </header>
    {children}
  </div>;
}

function JoinPreview() {
  const navigate = useNavigate();
  const [code, setCode] = useState('KFRW');
  const [name, setName] = useState('Alex');
  return <EntryPage>
    <section className="preview-form-panel preview-join-panel" aria-labelledby="join-title">
      <div className="preview-form-heading"><h1 id="join-title">Join a game</h1><p>Your team is waiting.</p></div>
      <form onSubmit={event => { event.preventDefault(); navigate('/status'); }}>
        <div className="form-control">
          <label htmlFor="game-code">Game code</label>
          <Input id="game-code" type="text" value={code} onChange={event => setCode(event.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="KFRW" maxLength={4} className="preview-game-code" />
          <p className="preview-field-help">Four letters from your host.</p>
        </div>
        <div className="form-control">
          <label htmlFor="name">What is your name?</label>
          <Input id="name" type="text" value={name} onChange={event => setName(event.target.value)} autoComplete="given-name" />
        </div>
        <Button disabled={!/^[a-z]{4}$/i.test(code) || !name.trim()} type="submit" color="primary" className="preview-entry-action">Join game</Button>
      </form>
    </section>
  </EntryPage>;
}

function HostPreview() {
  const [created, setCreated] = useState(false);
  const [punishment, setPunishment] = useState('2');
  const [reward, setReward] = useState('2');
  const valid = [punishment, reward].every(value => /^[1-9]\d*$/.test(value) && Number(value) <= 100);
  return <EntryPage host>
    <section className="preview-form-panel preview-host-panel" aria-labelledby="host-title">
      <div className="preview-form-heading"><h1 id="host-title">Host a game</h1><p>Set the rules. Bring your friends.</p></div>
      <details className={`preview-host-settings${created ? '' : ' preview-host-settings-new'}`} open={!created || undefined}>
        <summary>Game settings</summary>
      <form onSubmit={event => { event.preventDefault(); setCreated(true); }}>
        <div className="preview-host-amounts">
        <div className="form-control">
          <label htmlFor="punishmentAmount">Amount per Punishment</label>
          <Input id="punishmentAmount" type="text" inputMode="numeric" value={punishment} onChange={event => setPunishment(event.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div className="form-control">
          <label htmlFor="rewardAmount">Legacy reward amount</label>
          <Input id="rewardAmount" type="text" inputMode="numeric" value={reward} onChange={event => setReward(event.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        </div>
        <div className="form-control">
          <label htmlFor="difficulty">Reward difficulty</label>
          <select id="difficulty" className="select select-bordered" defaultValue="baseline">
            <option value="easy">Easy · 0.5×</option><option value="baseline">Baseline · 1×</option>
            <option value="hard">Hard · 1.5×</option><option value="terror">Terror · 2×</option>
          </select>
        </div>
        <details className="preview-field-help"><summary>How it works</summary><p>Each champion starts with 3 minutes. When time runs out, you must select a different free champion. Chest rewards use the configured catalogue and difficulty.</p></details>
        <Button disabled={!valid} type="submit" color="primary" className="preview-entry-action">Create game</Button>
      </form>
      </details>
      <div className="preview-invitation" role="status">
        {created ? <><p>Game code</p><strong>KFRW</strong><Link to="/join">Open sample invitation →</Link></>
          : <p>Create a game to receive a game code and invitation link.</p>}
      </div>
    </section>
    <details className="preview-companion">
      <summary>Companion verbinden</summary>
      <p>Companion auf dem LoL-PC starten und einmal mit dem Spiel verbinden. Er sendet Live-Daten direkt an den Server — auch wenn diese Seite geschlossen ist.</p>
    </details>
  </EntryPage>;
}

function PreviewRoutes() {
  const location = useLocation();
  useEffect(() => {
    const screen = screens.find(item => item.path === location.pathname);
    document.title = `${themes.find(theme => theme.id === startingTheme).name} · ${screen?.name || 'Preview'}`;
    window.scrollTo(0, 0);
    if (window.parent !== window && screen) {
      window.parent.postMessage({ type: 'bronzebrawl:preview-route', screen: screen.id }, window.location.origin);
    }
  }, [location.pathname]);
  return <Routes>
    <Route path="/" element={<HomePreview />} />
    <Route path="/join" element={<JoinPreview />} />
    <Route path="/host" element={<HostPreview />} />
    <Route path="/status" element={<main className="app-shell min-h-screen flex flex-col items-center justify-evenly m-4"><GamePreview /></main>} />
    <Route path="*" element={<HomePreview />} />
  </Routes>;
}

function EmbeddedPreview() {
  useEffect(() => {
    document.documentElement.dataset.previewTheme = requestedTheme === 'original' ? 'original' : startingTheme;
  }, []);
  return <HashRouter><PreviewRoutes /></HashRouter>;
}

function PreviewCard({ theme, screen, size, reset, original }) {
  const frame = useRef(null);
  const frameContainer = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / size.width)));
    observer.observe(frameContainer.current);
    return () => observer.disconnect();
  }, [size.width]);
  // Changing paint only keeps the iframe's sample state and scroll position.
  useEffect(() => {
    if (frame.current?.contentDocument?.documentElement) {
      frame.current.contentDocument.documentElement.dataset.previewTheme = original ? 'original' : theme.id;
    }
  }, [original, theme.id]);
  return <article className={`lab-card lab-card-${theme.id}`} style={{ '--frame-width': `${size.width}px` }}>
    <div className="lab-card-heading">
      <span className="lab-number">{theme.number}</span>
      <div><h2>{theme.name}</h2><p>{theme.mood}</p></div>
      <div className="lab-swatches" aria-label={`${theme.name} palette`}>
        {theme.colors.map(color => <span key={color} style={{ background: color }} title={color} />)}
      </div>
    </div>
    <div ref={frameContainer} className="lab-frame" style={{ height: `${size.height * scale + 2}px` }}>
      <iframe ref={frame} key={`${screen}-${reset}`} title={`${theme.name} ${screens.find(item => item.id === screen).name.toLowerCase()}`}
        src={`./ui-preview.html?embed=1&theme=${theme.id}&screen=${screen}#${screens.find(item => item.id === screen).path}`}
        style={{ width: `${size.width}px`, height: `${size.height}px`, transform: `scale(${scale})` }}
        onLoad={() => { frame.current.contentDocument.documentElement.dataset.previewTheme = original ? 'original' : theme.id; }} />
    </div>
    <p className="lab-card-description">{theme.description}</p>
  </article>;
}

function Gallery() {
  const [screen, setScreen] = useState(startingScreen);
  const [filter, setFilter] = useState(requestedTheme && themes.some(theme => theme.id === requestedTheme) ? requestedTheme : 'bronze');
  const [size, setSize] = useState(sizes[1]);
  const [reset, setReset] = useState(0);
  const [original, setOriginal] = useState(false);
  useEffect(() => {
    const onRoute = event => {
      if (event.origin !== window.location.origin || event.data?.type !== 'bronzebrawl:preview-route'
        || !screens.some(item => item.id === event.data.screen)) return;
      if ([...document.querySelectorAll('.lab-frame iframe')].some(frame => frame.contentWindow === event.source)) {
        setScreen(event.data.screen);
      }
    };
    window.addEventListener('message', onRoute);
    return () => window.removeEventListener('message', onRoute);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('screen', screen);
    if (filter === 'all') url.searchParams.delete('theme');
    else url.searchParams.set('theme', filter);
    window.history.replaceState(null, '', url);
  }, [screen, filter]);
  return <main className="style-lab">
    <header className="lab-header">
      <a className="lab-brand" href="./ui-preview.html"><BronzeLogo compact decorative className="lab-brand-mark" />BronzeBrawl<span className="lab-brand-divider" />Style lab</a>
      <span className="lab-preview-badge"><span />Interactive mockups</span>
    </header>
    <section className="lab-intro">
      <p className="lab-eyebrow">A simpler welcome. A softer game screen.</p>
      <h1>BronzeBrawl.<br className="lab-mobile-break" /> Refined.</h1>
      <p>The real bronze logo. A simple Join / Host entrance.<br className="lab-desktop-break" /> Explore the new flow and a more refined game screen.</p>
    </section>
    <div className="lab-toolbar">
      <div className="lab-segments" role="group" aria-label="Preview screen">
        {screens.map(item => <button key={item.id} aria-pressed={screen === item.id} onClick={() => setScreen(item.id)}>{item.name}</button>)}
      </div>
      <div className="lab-options">
        <label>View<select aria-label="Theme view" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">Compare all three</option>{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select></label>
        <label>Viewport<select aria-label="Preview viewport" value={size.width} onChange={event => setSize(sizes.find(item => item.width === Number(event.target.value)))}>
          {sizes.map(item => <option key={item.width} value={item.width}>{item.width} × {item.height} · {item.label}</option>)}
        </select></label>
      </div>
    </div>
    <div className="lab-stage-info">
      <p><code className="lab-route">{screens.find(item => item.id === screen).path}</code>{screens.find(item => item.id === screen).hint}</p>
      <div>{screen === 'game' && <label className="lab-original"><input type="checkbox" checked={original} onChange={event => setOriginal(event.target.checked)} />Original styling</label>}
        <button className="lab-reset" onClick={() => setReset(value => value + 1)}>Reset demos ↺</button></div>
    </div>
    <section className="lab-comparison" aria-label="Theme previews">
      {themes.filter(theme => filter === 'all' || filter === theme.id).map(theme => <PreviewCard key={theme.id} theme={theme} screen={screen} size={size} reset={reset} original={original && screen === 'game'} />)}
    </section>
    <footer className="lab-footer"><span className="lab-footer-mark">✦</span><p>Dark bronze is the selected design. <a href="/">Open the website →</a></p></footer>
  </main>;
}

if (embedded && !window.location.hash) {
  window.history.replaceState(null, '', `${window.location.href}#${screens.find(screen => screen.id === startingScreen).path}`);
}
createRoot(document.getElementById('root')).render(embedded ? <EmbeddedPreview /> : <Gallery />);
